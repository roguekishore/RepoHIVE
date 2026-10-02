/**
 * What the Lambda and Fargate entry points share: build the job's collaborators
 * from the configuration and call `runJob`. They differ only in how the input
 * arrives, where the time limit comes from, and how the result is reported.
 */
import { getViewsVersion } from "@repohive/views";
import type { ArtifactStore } from "./artifact-store.js";
import { createLedger, createStore, loadConfig, type IndexerConfig } from "./config.js";
import { resolveGithubToken } from "./github-token.js";
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
  /** The token, from the environment or read once from SSM. */
  readonly githubToken: string | undefined;
  readonly store: ArtifactStore;
  readonly ledger: JobLedger;
}
let shared: Promise<Shared> | undefined;

function sharedDeps(env: NodeJS.ProcessEnv): Promise<Shared> {
  if (shared === undefined) {
    const config = loadConfig(env);
    const pending = resolveGithubToken(config).then((githubToken) => ({
      config,
      githubToken,
      store: createStore(config),
      ledger: createLedger(config),
    }));
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
  const { config, githubToken: token, store, ledger } = await sharedDeps(env);
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
