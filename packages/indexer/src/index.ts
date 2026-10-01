/**
 * @repohive/indexer — the hosted indexing job: a GitHub repository goes in, an
 * immutable published snapshot comes out (hosting-2).
 *
 * Every AWS and network touchpoint sits behind an interface with a local
 * implementation, so the whole job runs on a development machine.
 *
 * Ecosystem package: it imports the engine (`@repohive/engine`,
 * `@repohive/core`) and the view builders (`@repohive/views`); the engine
 * packages must not import it.
 */
export type { ArtifactStore, ObjectHeaders, StoredObject } from "./artifact-store.js";
export type { ClaimResult, JobEnd, JobLedger, JobProgress, JobRecord } from "./job-ledger.js";
export { createDynamoDbJobLedger } from "./job-ledger-dynamodb.js";
export type { DynamoDbJobLedgerOptions } from "./job-ledger-dynamodb.js";
export { createFileJobLedger } from "./job-ledger-file.js";
export type { FileJobLedgerOptions } from "./job-ledger-file.js";
export { createMemoryJobLedger } from "./job-ledger-memory.js";
export type { MemoryJobLedger, MemoryJobLedgerOptions } from "./job-ledger-memory.js";
export {
  DEFAULT_INFLIGHT_CAP,
  JOB_STATE_ORDER,
  PROGRESS_WRITE_INTERVAL_MS,
  isForwardJobTransition,
  isTerminalJobState,
  jobStateIndex,
} from "./job-ledger-states.js";
export type { FailureClass, JobFailure, JobInput, JobState, Tier, Visibility } from "./job-types.js";
export type { FetchCaps, FetchedSource, FetchRequest, FetchResult, SourceFetcher } from "./source-fetcher.js";
// Snapshot identity, object keys and the manifest, latest and history documents (Requirement 7).
export { canonicalJson, compareBytewise, sha256Hex } from "./canonical-json.js";
export type { JsonValue } from "./canonical-json.js";
export {
  MANIFEST_VERSION,
  POINTER_VERSION,
  VIEW_FILES,
  architectureLevelKey,
  buildLatest,
  buildManifest,
  historyKey,
  indexObjectKey,
  indexPrefix,
  isValidRepoName,
  jsonBytes,
  latestKey,
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
  LatestFields,
  LatestPointer,
  Manifest,
  ManifestFields,
  ManifestFile,
  SnapshotInputs,
  SnapshotObject,
  ViewFile,
} from "./layout.js";
// Brotli at quality 9 and the headers each object is stored with (Requirement 8).
export {
  BROTLI_QUALITY,
  IMMUTABLE_CACHE_CONTROL,
  JSON_CONTENT_TYPE,
  LATEST_CACHE_CONTROL,
  compressBrotli,
  headersForKey,
  prepareObject,
  prepareObjects,
} from "./compression.js";
export type { PreparedObject } from "./compression.js";
