/**
 * The local end-to-end run: `runJob` with the local
 * fetcher, store and ledger, and the pre-check's GitHub calls stubbed from the
 * tarball itself (the stub's repository is public with default branch `main`,
 * head commit the given SHA, and a tree listing the tarball's selected files).
 * Nothing touches the network or AWS.
 */
import { engineVersion } from "@repohive/engine";
import { getViewsVersion } from "@repohive/views";
import type { ArtifactStore } from "./artifact-store.js";
import type { FetchFunction } from "./github.js";
import { hostedConfigDigest } from "./hosted-options.js";
import type { JobLedger } from "./job-ledger.js";
import type { JobResult } from "./job-result.js";
import type { JobInput, Tier } from "./job-types.js";
import { precheck } from "./precheck.js";
import { runJob } from "./run-job.js";
import { createLocalSourceFetcher } from "./source-fetcher-local.js";
import { DEFAULT_FETCH_CAPS } from "./tarball.js";
import { createLogger, createTelemetry, type LineWriter } from "./telemetry.js";

export interface LocalRunOptions {
  /** A `.tar.gz` of the repository with one top-level directory (`git archive`). */
  readonly tarballPath: string;
  /** `<owner>/<repo>`. */
  readonly repo: string;
  /** The 40-character commit the tarball was made from. */
  readonly commitSha: string;
  readonly store: ArtifactStore;
  readonly ledger: JobLedger;
  /** Overrides the tier the pre-check picks. */
  readonly tier?: Tier;
  readonly timeLimitMs?: number;
  readonly tmpRoot?: string;
  /** Where metric and log lines go; default: stdout. */
  readonly write?: LineWriter;
}

export type LocalRunOutcome =
  | { readonly kind: "rejected"; readonly reason: string; readonly message: string }
  | { readonly kind: "cache-hit"; readonly snapshotId: string }
  | { readonly kind: "ran"; readonly snapshotId: string; readonly tier: Tier; readonly result: JobResult };

/** A GitHub API stand-in answering from the tarball's selected files. */
function stubGithub(entries: readonly { path: string; bytes: Uint8Array }[], commitSha: string): FetchFunction {
  return async (url) => {
    const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });
    if (url.includes("/git/trees/")) {
      return json({
        sha: commitSha,
        truncated: false,
        tree: entries.map((entry) => ({ path: entry.path, type: "blob", size: entry.bytes.byteLength })),
      });
    }
    if (url.includes("/commits/")) {
      return json({ sha: commitSha });
    }
    return json({ private: false, archived: false, default_branch: "main" });
  };
}

export async function runLocal(options: LocalRunOptions): Promise<LocalRunOutcome> {
  const [owner, name, ...rest] = options.repo.split("/");
  if (owner === undefined || name === undefined || rest.length > 0) {
    throw new RangeError("repo must be <owner>/<repo>");
  }
  const fetcher = createLocalSourceFetcher(options.tarballPath);

  // The pre-check needs a tree listing: read the archive once, at the largest tier, to stand in for GitHub's.
  const listing = await fetcher.fetch({ owner, repo: name, commitSha: options.commitSha, tier: "XL" }, DEFAULT_FETCH_CAPS);
  if (!listing.ok) {
    if ("failure" in listing) {
      return { kind: "rejected", reason: listing.failure.code, message: listing.failure.message };
    }
    return { kind: "rejected", reason: "RETIER", message: "the archive needs a larger tier than XL" };
  }
  const stub = stubGithub(listing.source.entries, options.commitSha);
  const viewsVersion = getViewsVersion();
  const check = (input: string) => precheck(input, { token: "local-stub", store: options.store, viewsVersion, fetch: stub });

  const accepted = await check(options.repo);
  if (!accepted.ok) {
    return { kind: "rejected", reason: accepted.reason, message: accepted.message };
  }
  if (accepted.cacheHit) {
    return { kind: "cache-hit", snapshotId: accepted.snapshotId };
  }

  const tier = options.tier ?? accepted.tier;
  const input: JobInput = {
    jobId: `local-${accepted.snapshotId.slice(0, 8)}-${Date.now().toString(36)}`,
    accountId: "local",
    repo: accepted.repo,
    commitSha: options.commitSha,
    tier,
    snapshotId: accepted.snapshotId,
    visibility: "public",
  };
  const claim = await options.ledger.claim(input);
  if (!claim.claimed) {
    return { kind: "rejected", reason: claim.reason, message: "the repository already has a job in flight" };
  }

  const started = Date.now();
  const limit = options.timeLimitMs ?? 15 * 60_000;
  const write = options.write;
  const result = await runJob(input, {
    fetcher,
    store: options.store,
    ledger: options.ledger,
    runtime: "local",
    log: createLogger({ jobId: input.jobId, ...(write === undefined ? {} : { write }) }),
    telemetry: createTelemetry({ tier, runtime: "local", ...(write === undefined ? {} : { write }) }),
    remainingMs: () => limit - (Date.now() - started),
    validate: (job) => check(job.repo.replace(/^github\.com\//, "")),
    engineVersion,
    configDigest: hostedConfigDigest(),
    viewsVersion,
    ...(options.tmpRoot === undefined ? {} : { tmpRoot: options.tmpRoot }),
  });
  return { kind: "ran", snapshotId: input.snapshotId, tier, result };
}
