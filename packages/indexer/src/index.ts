/**
 * @repohive/indexer — the hosted indexing job: a GitHub repository goes in, an
 * immutable published snapshot comes out.
 *
 * Every AWS and network touchpoint sits behind an interface with a local
 * implementation, so the whole job runs on a development machine.
 *
 * Ecosystem package: it imports the engine (`@repohive/engine`,
 * `@repohive/core`) and the view builders (`@repohive/views`); the engine
 * packages must not import it.
 */
export type { ArtifactStore, ObjectHeaders, StoredObject } from "./artifact-store.js";
export type { JobOutcome, JobProgress, JobReporter } from "./job-reporter.js";
export {
  JOB_STATE_ORDER,
  PROGRESS_WRITE_INTERVAL_MS,
  isForwardJobTransition,
  isTerminalJobState,
  jobStateIndex,
} from "./job-states.js";
export {
  REPORT_ATTEMPTS,
  REPORT_BACKOFF_MS,
  createHttpActiveSnapshotReader,
  createHttpJobReporter,
} from "./reporter-http.js";
export type { HttpActiveSnapshotReaderOptions, HttpJobReporterOptions } from "./reporter-http.js";
export { createMemoryJobReporter } from "./reporter-memory.js";
export type { MemoryJobReporter, ReportedCall } from "./reporter-memory.js";
export type { FailureClass, JobFailure, JobInput, JobState, Tier, Visibility } from "./job-types.js";
export type { FetchCaps, FetchedSource, FetchRequest, FetchResult, SourceFetcher } from "./source-fetcher.js";
// Snapshot identity, object keys and the manifest and history documents.
export { canonicalJson, compareBytewise, sha256Hex } from "./canonical-json.js";
export type { JsonValue } from "./canonical-json.js";
export {
  MANIFEST_VERSION,
  VIEW_FILES,
  architectureLevelKey,
  buildManifest,
  historyKey,
  indexObjectKey,
  indexPrefix,
  privateSnapshotPrefix,
  isValidRepoName,
  jsonBytes,
  manifestKey,
  recordPublish,
  regionDetailKey,
  repoKey,
  snapshotIdOf,
  snapshotPrefix,
  viewKey,
} from "./layout.js";
export type {
  History,
  HistoryEntry,
  Manifest,
  ManifestFields,
  ManifestFile,
  SnapshotInputs,
  SnapshotObject,
  ViewFile,
} from "./layout.js";
// Brotli at quality 9 and the headers each object is stored with.
export {
  BROTLI_QUALITY,
  IMMUTABLE_CACHE_CONTROL,
  JSON_CONTENT_TYPE,
  compressBrotli,
  headersForKey,
  prepareObject,
  prepareObjects,
} from "./compression.js";
export type { PreparedObject } from "./compression.js";
// Tier caps, the archive reader and its two fetchers, the pre-check.
export {
  MAX_JAVA_BYTES,
  TIER_MAX_FILES,
  TIER_ORDER,
  TIER_TIMEOUT_MS,
  smallestTierFor,
  smallestTierForCount,
} from "./tiers.js";
export { DEFAULT_FETCH_CAPS, readTarGz } from "./tarball.js";
export { createLocalSourceFetcher } from "./source-fetcher-local.js";
export { createGithubSourceFetcher } from "./source-fetcher-github.js";
export type { GithubSourceFetcherOptions } from "./source-fetcher-github.js";
export { githubHeaders, isCommitSha, repoApiUrl, tarballUrl } from "./github.js";
export type { FetchFunction } from "./github.js";
export { hostedConfigDigest, hostedEngineOptions } from "./hosted-options.js";
export { parseRepositoryReference, precheck } from "./precheck.js";
export type { PrecheckAccepted, PrecheckDeps, PrecheckReason, PrecheckRejection, PrecheckResult } from "./precheck.js";
// Local artifact stores.
export { createMemoryArtifactStore } from "./artifact-store-memory.js";
export { createLocalArtifactStore } from "./artifact-store-local.js";
// The job, its entry points' shared pieces, publishing and telemetry (9 and 11).
export { runJob, ABORT_MARGIN_MS } from "./run-job.js";
export type { RunJobDeps } from "./run-job.js";
export type { JobCounts, JobDurations, JobResult } from "./job-result.js";
export { parseJobInput } from "./job-input.js";
export { ConfigError, createStore, loadConfig } from "./config.js";
export type { IndexerConfig, StoreConfig } from "./config.js";
export { executeJob } from "./entry.js";
export { resolveGithubToken, resolveInternalSecret, resolveSecret } from "./github-token.js";
export { createS3ArtifactStore } from "./artifact-store-s3.js";
export type { S3ArtifactStoreOptions } from "./artifact-store-s3.js";
export { indexObjects, viewObjects } from "./snapshot-objects.js";
export { KEEP_RECENT_SNAPSHOTS, RETIRED_GRACE_MS, publishSnapshot, snapshotsToPrune } from "./publish.js";
export type { PublishDeps, PublishInput, PublishResult } from "./publish.js";
export {
  METRIC_NAMESPACE,
  STAGE_NAMES,
  createLogger,
  createTelemetry,
  silentLogger,
  stdoutWriter,
} from "./telemetry.js";
export type { LineWriter, LogLevel, Logger, LoggerOptions, Runtime, StageName, Telemetry, TelemetryOptions } from "./telemetry.js";
// The local end-to-end run.
export { runLocal } from "./local-run.js";
export type { LocalRunOptions, LocalRunOutcome } from "./local-run.js";
// Local fixtures: tarballs and a GitHub stand-in (the pre-check CLI and the local job use them).
export {
  LOCAL_REPO_TO_FIXTURE,
  createLocalPrecheckFetch,
  ensureFixtureTarball,
  fixtureForLocalRepo,
  fixtureSource,
  repoRoot,
  resetLocalFixtureCacheForTests,
  tarballForRepoKey,
  warmLocalFixtureCache,
} from "./local-fixtures.js";
