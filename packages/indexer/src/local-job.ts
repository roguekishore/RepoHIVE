// The thread pool is sized before anything else loads (see thread-pool.ts).
import "./thread-pool.js";
import { getViewsVersion } from "@repohive/views";
import { createLocalArtifactStore } from "./artifact-store-local.js";
import { parseJobInput } from "./job-input.js";
import { createHttpActiveSnapshotReader, createHttpJobReporter } from "./reporter-http.js";
import { fixtureForLocalRepo, tarballForRepoKey, warmLocalFixtureCache } from "./local-fixtures.js";
import { runJob } from "./run-job.js";
import { createLocalSourceFetcher } from "./source-fetcher-local.js";
import { createLogger, createTelemetry } from "./telemetry.js";

/**
 * The local dispatcher's child: one `runJob` for `github.com/local/<name>`,
 * sourced from the fixture tarball and reporting to the server over HTTP.
 *
 * Environment: `REPOHIVE_JOB_INPUT` (JSON `JobInput`), `REPOHIVE_STORE` (`local:<dir>`), `REPOHIVE_SERVER_URL`,
 * `REPOHIVE_INTERNAL_SECRET`, `REPOHIVE_TARBALL_DIR`. `REPOHIVE_LOCAL_JOB_INJECT_FAILURE=system` reports a
 * `system` failure with code `E2E_INJECT` and exits 1. Exit code 0 for success or retier, 1 for a failure.
 */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is not set`);
  }
  return value.trim();
}

async function main(): Promise<number> {
  const input = parseJobInput(JSON.parse(required("REPOHIVE_JOB_INPUT")) as unknown);
  const storeText = required("REPOHIVE_STORE");
  if (!storeText.startsWith("local:") || storeText.length === "local:".length) {
    throw new Error("REPOHIVE_STORE must be local:<dir>");
  }
  const serverUrl = required("REPOHIVE_SERVER_URL");
  const secret = required("REPOHIVE_INTERNAL_SECRET");
  const tarballDir = required("REPOHIVE_TARBALL_DIR");

  const reporter = createHttpJobReporter({ serverUrl, secret });

  if (process.env.REPOHIVE_LOCAL_JOB_INJECT_FAILURE === "system") {
    await reporter.complete(input.jobId, {
      status: "failed",
      failureClass: "system",
      failureCode: "E2E_INJECT",
      message: "Injected failure.",
    });
    return 1;
  }

  const localMatch = /^github\.com\/local\/([^/]+)$/.exec(input.repo);
  const fixture = localMatch?.[1] === undefined ? undefined : fixtureForLocalRepo(localMatch[1]);
  if (fixture !== undefined) {
    await warmLocalFixtureCache([fixture], tarballDir);
  }
  const fetcher = createLocalSourceFetcher(tarballForRepoKey(input.repo, tarballDir));

  const started = Date.now();
  const limit = 15 * 60_000;
  const result = await runJob(input, {
    fetcher,
    store: createLocalArtifactStore(storeText.slice("local:".length)),
    reporter,
    activeSnapshotId: createHttpActiveSnapshotReader({ serverUrl, secret }),
    runtime: "local",
    log: createLogger({ jobId: input.jobId, secrets: [secret] }),
    telemetry: createTelemetry({ tier: input.tier, runtime: "local" }),
    remainingMs: () => limit - (Date.now() - started),
    viewsVersion: getViewsVersion(),
  });
  return result.status === "failed" ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
