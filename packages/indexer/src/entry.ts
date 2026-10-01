/**
 * What the Lambda and Fargate entry points share: build the job's collaborators
 * from the configuration and call `runJob`. They differ only in how the input
 * arrives, where the time limit comes from, and how the result is reported.
 */
import { getViewsVersion } from "@repohive/views";
import type { ArtifactStore } from "./artifact-store.js";
import { createLedger, createStore, loadConfig, type IndexerConfig } from "./config.js";
import type { JobLedger } from "./job-ledger.js";
import type { JobResult } from "./job-result.js";
import type { JobInput } from "./job-types.js";
import { precheck } from "./precheck.js";
import { runJob } from "./run-job.js";
import { createGithubSourceFetcher } from "./source-fetcher-github.js";
import { createLogger, createTelemetry, type Logger } from "./telemetry.js";

/** Clients are built once per process (a warm Lambda container reuses them). */
interface Shared {
  readonly config: IndexerConfig;
  readonly store: ArtifactStore;
  readonly ledger: JobLedger;
}
let shared: Shared | undefined;

function sharedDeps(env: NodeJS.ProcessEnv): Shared {
  if (shared === undefined) {
    const config = loadConfig(env);
    shared = { config, store: createStore(config), ledger: createLedger(config) };
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
  const { config, store, ledger } = sharedDeps(env);
  const token = config.githubToken;
  const logger = log ?? createLogger({ jobId: input.jobId, secrets: token === undefined ? [] : [token] });
  return runJob(input, {
    fetcher: createGithubSourceFetcher({ token: token ?? "" }),
    store,
    ledger,
    runtime: config.runtime,
    log: logger,
    telemetry: createTelemetry({ tier: input.tier, runtime: config.runtime }),
    remainingMs,
    ...(token === undefined
      ? {}
      : {
          validate: (job: JobInput) =>
            precheck(job.repo.replace(/^github\.com\//, ""), { token, store, viewsVersion: getViewsVersion() }),
        }),
  });
}
