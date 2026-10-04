/**
 * The hosted indexing job: one function for
 * both runtimes. A Lambda handler and a Fargate entry point call `runJob` and
 * differ only in how they receive the input and report the result.
 *
 * Stages: validate, fetch, engine run, views, publish. The job knows its time
 * limit: 30 s before it, the job aborts, reports failure with class `system`,
 * and publishes nothing. The server starts an L or XL job only when the large
 * slot is free, so the job holds no slot. Progress and the final outcome go to
 * the server through a {@link JobReporter}.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INDEX_FORMAT_VERSION,
  describeEngineFailure,
  engineVersion as defaultEngineVersion,
  indexProject as defaultIndexProject,
  type EngineProgressEvent,
} from "@repohive/engine";
import { buildSnapshotViews, getViewsVersion } from "@repohive/views";
import type { ArtifactStore } from "./artifact-store.js";
import { hostedConfigDigest, hostedEngineOptions } from "./hosted-options.js";
import type { JobResult } from "./job-result.js";
import type { JobOutcome, JobReporter } from "./job-reporter.js";
import type { JobInput, JobState } from "./job-types.js";
import { isValidRepoName, snapshotIdOf } from "./layout.js";
import { isCommitSha } from "./github.js";
import type { PrecheckResult } from "./precheck.js";
import { publishSnapshot } from "./publish.js";
import { indexObjects, viewObjects } from "./snapshot-objects.js";
import type { FetchCaps, SourceFetcher } from "./source-fetcher.js";
import { DEFAULT_FETCH_CAPS } from "./tarball.js";
import type { Logger, Runtime, Telemetry } from "./telemetry.js";

/** The job aborts this long before its time limit. */
export const ABORT_MARGIN_MS = 30_000;

export interface RunJobDeps {
  readonly fetcher: SourceFetcher;
  readonly store: ArtifactStore;
  readonly reporter: JobReporter;
  /** The snapshot the server serves for a repo key; publish never prunes it. Absent: no exclusion. */
  readonly activeSnapshotId?: (repo: string) => Promise<string | undefined>;
  readonly runtime: Runtime;
  readonly log: Logger;
  readonly telemetry: Telemetry;
  /** Milliseconds left before the platform ends the job: Lambda remaining time, or the configured Fargate limit minus elapsed. */
  readonly remainingMs: () => number;
  /** Re-runs the pre-check as validation. Absent for a local run with no GitHub. */
  readonly validate?: (input: JobInput) => Promise<PrecheckResult>;
  readonly fetchCaps?: Partial<FetchCaps>;
  /** Defaults below are the engine's and the views package's; tests inject. */
  readonly engineVersion?: string;
  readonly configDigest?: string;
  readonly viewsVersion?: string;
  readonly indexProject?: typeof defaultIndexProject;
  readonly now?: () => Date;
  /** Parent of the job's temporary output directory. Default: the OS temp directory. */
  readonly tmpRoot?: string;
}

/** Thrown to unwind a job that reached its abort point. */
class TimeLimit extends Error {
  constructor() {
    super("job time limit reached");
  }
}

/** A stage's outcome the job returns as is. */
class Stop extends Error {
  constructor(readonly result: JobResult) {
    super("job stopped");
  }
}

const failed = (failureClass: "user" | "system", code: string, message: string): JobResult => ({
  status: "failed",
  failureClass,
  code,
  message,
});

/** `github.com/<owner>/<repo>` to its parts, or `undefined`. */
function splitRepo(repo: string): { owner: string; name: string } | undefined {
  const match = /^github\.com\/([^/]+)\/([^/]+)$/.exec(repo);
  if (match?.[1] === undefined || match[2] === undefined || !isValidRepoName(match[1], match[2])) {
    return undefined;
  }
  return { owner: match[1], name: match[2] };
}

export async function runJob(input: JobInput, deps: RunJobDeps): Promise<JobResult> {
  const { reporter, log, telemetry } = deps;
  const now = deps.now ?? ((): Date => new Date());
  const started = performance.now();
  const durations = { fetchMs: 0, parseMs: 0, groupMs: 0, viewsMs: 0, publishMs: 0 };

  // --- the time limit -------------------------------------------------------------
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), Math.max(0, deps.remainingMs() - ABORT_MARGIN_MS));
  timer.unref();
  const deadline = new Promise<never>((_, reject) => {
    abort.signal.addEventListener("abort", () => reject(new TimeLimit()), { once: true });
  });
  deadline.catch(() => undefined);
  /** Races a stage against the deadline; the stage's own work may keep running, but the job moves on. */
  const guard = <T>(stage: Promise<T>): Promise<T> => {
    stage.catch(() => undefined);
    return Promise.race([stage, deadline]);
  };
  const checkDeadline = (): void => {
    if (abort.signal.aborted) {
      throw new TimeLimit();
    }
  };

  // --- reports, kept in order ----------------------------------------------------------
  let queue: Promise<void> = Promise.resolve();
  let state: JobState = "queued";
  const enqueue = (write: () => Promise<void>): void => {
    queue = queue.then(write).catch((error: unknown) => {
      log.log("warn", "progress report failed", { error: String(error) });
    });
  };
  const moveTo = (to: JobState): void => {
    if (state !== to) {
      state = to;
      enqueue(() => reporter.progress(input.jobId, { state: to }));
    }
  };

  let outputRoot: string | undefined;
  let result: JobResult;

  try {
    result = await execute();
  } catch (error) {
    if (error instanceof Stop) {
      result = error.result;
    } else if (error instanceof TimeLimit) {
      log.log("error", "time limit reached; aborting the job");
      result = failed("system", "TIME_LIMIT", "Indexing took too long and was stopped.");
    } else {
      log.log("error", "job failed unexpectedly", { error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
      result = failed("system", "INTERNAL_ERROR", "Indexing failed because of an internal error.");
    }
  } finally {
    clearTimeout(timer);
    if (outputRoot !== undefined) {
      await rm(outputRoot, { recursive: true, force: true }).catch((error: unknown) => {
        log.log("warn", "could not remove the temporary output", { error: String(error) });
      });
    }
  }

  // --- report: the outcome is always sent ---------------------------------------------
  await queue;
  const totalMs = performance.now() - started;
  try {
    await reporter.complete(input.jobId, outcomeOf(result));
  } catch (error) {
    log.log("error", "could not report the job outcome", { error: String(error) });
  }

  if (result.status === "succeeded") {
    telemetry.jobSucceeded();
    telemetry.stageMs("fetch", durations.fetchMs);
    telemetry.stageMs("parse", durations.parseMs);
    telemetry.stageMs("group", durations.groupMs);
    telemetry.stageMs("views", durations.viewsMs);
    telemetry.stageMs("publish", durations.publishMs);
  } else if (result.status === "failed") {
    telemetry.jobFailed(result.failureClass);
  }
  telemetry.endToEndMs(totalMs);
  telemetry.peakRssMb(process.resourceUsage().maxRSS / 1024);
  log.log("info", "job ended", { status: result.status, totalMs: Math.round(totalMs) });
  return result.status === "succeeded" ? { ...result, durations: { ...durations, totalMs } } : result;

  // ------------------------------------------------------------------------------------
  function outcomeOf(final: JobResult): JobOutcome {
    if (final.status === "retier") {
      return { status: "retier", tier: final.tier };
    }
    if (final.status === "failed") {
      return { status: "failed", failureClass: final.failureClass, failureCode: final.code, message: final.message };
    }
    return {
      status: "succeeded",
      snapshotId: final.snapshotId,
      commitSha: input.commitSha,
      engineVersion: deps.engineVersion ?? defaultEngineVersion,
      viewsVersion: deps.viewsVersion ?? getViewsVersion(),
      nodeCount: final.counts.hierarchyNodes,
      edgeCount: final.counts.edges,
    };
  }

  async function execute(): Promise<JobResult> {
    const engineVersion = deps.engineVersion ?? defaultEngineVersion;
    const viewsVersion = deps.viewsVersion ?? getViewsVersion();
    const digest = deps.configDigest ?? hostedConfigDigest();
    const indexProject = deps.indexProject ?? defaultIndexProject;

    const parts = splitRepo(input.repo);
    if (parts === undefined || !isCommitSha(input.commitSha)) {
      return failed("user", "INVALID_REPOSITORY", "The repository or commit is not valid.");
    }
    // The intake computed this id from its own build; a different image would publish under the wrong id.
    const expectedId = snapshotIdOf({ repo: input.repo, commitSha: input.commitSha, engineVersion, viewsVersion, configDigest: digest });
    if (expectedId !== input.snapshotId) {
      log.log("error", "snapshot id does not match this build", { expected: expectedId, given: input.snapshotId });
      return failed("system", "SNAPSHOT_ID_MISMATCH", "The indexer build does not match the request. Try again shortly.");
    }

    if (deps.validate !== undefined) {
      const check = await guard(deps.validate(input));
      if (!check.ok) {
        return failed(
          check.reason === "github-unavailable" ? "system" : "user",
          `PRECHECK_${check.reason.toUpperCase().replaceAll("-", "_")}`,
          check.message,
        );
      }
    }

    // --- fetch ----------------------------------------------------------------------
    moveTo("fetching");
    const fetchStart = performance.now();
    const fetched = await guard(
      deps.fetcher.fetch(
        { owner: parts.owner, repo: parts.name, commitSha: input.commitSha, tier: input.tier },
        { ...DEFAULT_FETCH_CAPS, ...deps.fetchCaps },
        abort.signal,
      ),
    );
    durations.fetchMs = performance.now() - fetchStart;
    if (!fetched.ok) {
      if ("retier" in fetched) {
        log.log("info", "the repository needs a larger tier", { from: input.tier, to: fetched.retier });
        return { status: "retier", tier: fetched.retier };
      }
      log.log("warn", "fetch failed", { code: fetched.failure.code });
      return failed(fetched.failure.failureClass, fetched.failure.code, fetched.failure.message);
    }
    const entries = fetched.source.entries;
    checkDeadline();

    // --- engine run ----------------------------------------------------------------------
    outputRoot = await mkdtemp(join(deps.tmpRoot ?? tmpdir(), "repohive-job-"));
    const onProgress = (event: EngineProgressEvent): void => {
      if (event.kind === "start") {
        moveTo(event.stage === "parse" ? "parsing" : "grouping");
      }
      if (event.kind === "progress") {
        const progress = {
          stage: event.substage === undefined ? event.stage : `${event.stage}:${event.substage}`,
          ...(event.completed === undefined ? {} : { completed: event.completed }),
          ...(event.total === undefined ? {} : { total: event.total }),
        };
        enqueue(() => reporter.progress(input.jobId, { progress }));
      }
    };
    const run = await guard(indexProject({ ...hostedEngineOptions(entries, join(outputRoot, "out")), onProgress }));
    if (!run.ok) {
      const stage = run.stage.toUpperCase();
      log.log("error", "engine run failed", { stage: run.stage, detail: describeEngineFailure(run) });
      return failed("system", `ENGINE_${stage}_FAILED`, "Indexing the repository failed.");
    }
    durations.parseMs = run.value.durationMs.parse;
    durations.groupMs = run.value.durationMs.group;
    checkDeadline();

    // --- views ----------------------------------------------------------------------------
    moveTo("building-views");
    const viewsStart = performance.now();
    const views = buildSnapshotViews(run.value.groupingOutput, { id: `${parts.owner}/${parts.name}`, name: parts.name });
    const objects = [...viewObjects(input.repo, input.snapshotId, views), ...(await indexObjects(input.repo, input.snapshotId, run.value.indexDirectory))];
    durations.viewsMs = performance.now() - viewsStart;
    checkDeadline();

    // --- publish --------------------------------------------------------------------------
    // Not raced against the deadline: the manifest is written last, so an abort before this point publishes
    // nothing, and past it the 30 s margin is what publishing has.
    moveTo("publishing");
    const publishStart = performance.now();
    const published = await publishSnapshot(
      {
        repo: input.repo,
        snapshotId: input.snapshotId,
        commitSha: input.commitSha,
        engineVersion,
        viewsVersion,
        indexFormatVersion: INDEX_FORMAT_VERSION,
        objects,
      },
      {
        store: deps.store,
        now,
        log,
        ...(deps.activeSnapshotId === undefined
          ? {}
          : { activeSnapshotId: () => deps.activeSnapshotId!(input.repo) }),
      },
    );
    durations.publishMs = performance.now() - publishStart;

    return {
      status: "succeeded",
      snapshotId: input.snapshotId,
      counts: {
        files: entries.length,
        nodes: run.value.nodeCount,
        edges: run.value.edgeCount,
        hierarchyNodes: views.hierarchyScale.totalNodes,
        regions: run.value.regionCount,
        objects: published.objectCount,
        storedBytes: published.storedBytes,
      },
      durations: { ...durations, totalMs: 0 },
    };
  }
}
