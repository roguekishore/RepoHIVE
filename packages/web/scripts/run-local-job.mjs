/**
 * Local orchestrator child: runs one `runJob` with the app configuration.
 * Input: `REPOHIVE_JOB_INPUT` JSON (same shape as Fargate).
 *
 * In local mode the source is the fixture tarball. Set
 * `REPOHIVE_LOCAL_JOB_INJECT_FAILURE=system` to end the job as a system failure
 * (for the HTTP e2e refund check).
 */
import {
  createFileJobLedger,
  createLocalSourceFetcher,
  createLocalArtifactStore,
  createLogger,
  createTelemetry,
  parseJobInput,
  runJob,
} from "@repohive/indexer";
import { getViewsVersion } from "@repohive/views";
import { parseAppConfig } from "../src/lib/hosting/config.ts";
import { fixtureForLocalRepo, tarballForRepoKey, warmLocalFixtureCache } from "../src/lib/hosting/local-fixtures.ts";

const raw = process.env.REPOHIVE_JOB_INPUT;
if (raw === undefined || raw === "") {
  throw new Error("REPOHIVE_JOB_INPUT is not set");
}
const input = parseJobInput(JSON.parse(raw));
const config = parseAppConfig(process.env);
if (config.mode !== "local" || config.store.kind !== "local" || config.ledger.kind !== "file") {
  throw new Error("run-local-job requires local store and file ledger");
}

const store = createLocalArtifactStore(config.store.directory);
const ledger = createFileJobLedger({ path: config.ledger.path });
const tarballCache = `${config.dataDirectory}/tarballs`;
const localMatch = /^github\.com\/local\/([^/]+)$/.exec(input.repo);
const fixture =
  localMatch === null ? undefined : fixtureForLocalRepo(localMatch[1]);
if (fixture !== undefined) {
  await warmLocalFixtureCache([fixture], tarballCache);
}
const tarballPath = tarballForRepoKey(input.repo, tarballCache);
const fetcher = createLocalSourceFetcher(tarballPath);

if (process.env.REPOHIVE_LOCAL_JOB_INJECT_FAILURE === "system") {
  await ledger.finish(input.jobId, {
    state: "failed",
    failureClass: "system",
    failureCode: "E2E_INJECT",
  });
  process.exitCode = 1;
  process.exit(1);
}

const started = Date.now();
const limit = 15 * 60_000;
const log = createLogger({ jobId: input.jobId });
const telemetry = createTelemetry({ tier: input.tier, runtime: "local" });

const result = await runJob(input, {
  fetcher,
  store,
  ledger,
  runtime: "local",
  log,
  telemetry,
  remainingMs: () => limit - (Date.now() - started),
  viewsVersion: getViewsVersion(),
});

process.exitCode = result.status === "failed" ? 1 : 0;
