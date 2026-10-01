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
export type { ClaimResult, JobEnd, JobLedger, JobProgress, JobRecord } from "./job-ledger.js";
export type { FailureClass, JobFailure, JobInput, JobState, Tier, Visibility } from "./job-types.js";
export type { FetchCaps, FetchedSource, FetchRequest, FetchResult, SourceFetcher } from "./source-fetcher.js";
