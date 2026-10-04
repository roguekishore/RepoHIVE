/**
 * What the Lambda and Fargate entry points share: build the job's collaborators
 * from the configuration and call `runJob`. They differ only in how the input
 * arrives, where the time limit comes from, and how the result is reported.
 */
import { getViewsVersion } from "@repohive/views";
import type { ArtifactStore } from "./artifact-store.js";
import { createStore, loadConfig, type IndexerConfig } from "./config.js";
import { resolveGithubToken, resolveInternalSecret } from "./github-token.js";
import type { JobReporter } from "./job-reporter.js";
import type { JobResult } from "./job-result.js";
import type { JobInput } from "./job-types.js";
import { precheck } from "./precheck.js";
import { createHttpActiveSnapshotReader, createHttpJobReporter } from "./reporter-http.js";
import { runJob } from "./run-job.js";
import { createGithubSourceFetcher } from "./source-fetcher-github.js";
import { createLogger, createTelemetry, type Logger } from "./telemetry.js";

/** Clients are built once per process (a warm Lambda container reuses them). */
interface Shared {
  readonly config: IndexerConfig;
  /** The token, from the environment or read once from SSM. */
  readonly githubToken: string | undefined;
  readonly internalSecret: string | undefined;
  readonly store: ArtifactStore;
  readonly reporter: JobReporter | undefined;
  readonly activeSnapshotId: ((repo: string) => Promise<string | undefined>) | undefined;
}
let shared: Promise<Shared> | undefined;

function sharedDeps(env: NodeJS.ProcessEnv): Promise<Shared> {
  if (shared === undefined) {
    const config = loadConfig(env);
    const pending = Promise.all([resolveGithubToken(config), resolveInternalSecret(config)]).then(
      ([githubToken, internalSecret]) => {
        const http =
          config.serverUrl !== undefined && internalSecret !== undefined
            ? { serverUrl: config.serverUrl, secret: internalSecret }
            : undefined;
        return {
          config,
          githubToken,
          internalSecret,
          store: createStore(config),
          reporter: http === undefined ? undefined : createHttpJobReporter(http),
          activeSnapshotId: http === undefined ? undefined : createHttpActiveSnapshotReader(http),
        };
      },
    );
    // A failed read is not kept: the next invocation tries again.
    pending.catch(() => {
      if (shared === pending) {
        shared = undefined;
      }
    });
    shared = pending;
  }
  return shared;
}

/** Runs one job with the environment's configuration. `remainingMs` is the runtime's own clock. */
export async function executeJob(
  input: JobInput,
  remainingMs: () => number,
  env: NodeJS.ProcessEnv = process.env,
  log?: Logger,
): Promise<JobResult> {
  const { config, githubToken: token, internalSecret, store, reporter, activeSnapshotId } = await sharedDeps(env);
  if (reporter === undefined) {
    // loadConfig requires both outside a local run; this entry point has no local mode.
    throw new Error("REPOHIVE_SERVER_URL and REPOHIVE_INTERNAL_SECRET are required to report a job");
  }
  const secrets = [token, internalSecret].filter((value): value is string => value !== undefined);
  const logger = log ?? createLogger({ jobId: input.jobId, secrets });
  return runJob(input, {
    fetcher: createGithubSourceFetcher({ token: token ?? "" }),
    store,
    reporter,
    ...(activeSnapshotId === undefined ? {} : { activeSnapshotId }),
    runtime: config.runtime,
    log: logger,
    telemetry: createTelemetry({ tier: input.tier, runtime: config.runtime }),
    remainingMs,
    ...(token === undefined
      ? {}
      : {
          validate: (job: JobInput) =>
            precheck(job.repo.replace(/^github\.com\//, ""), { token, viewsVersion: getViewsVersion() }),
        }),
  });
}
