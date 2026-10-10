import type { ActionResult, Credentials, Session } from "./session";
import type { IndexRequestResult } from "./index-request";
import type { Job, JobEvent, JobList } from "./job";
import type { Quota } from "./quota";
import type { RepositoryPage, RepositorySummary } from "./repository";
import type { SnapshotManifest, SnapshotPointer } from "./snapshot";
import type { ArchitectureLevelView, RegionDetailIndex, RegionDetailView, ViewBodies, ViewName } from "./views";

/**
 * The client a screen is given for actions and lazy reads. Each host implements it once, in its translation layer, by
 * mapping its real endpoints onto these shapes; a screen never knows which host it runs on.
 *
 * A read that finds nothing answers `undefined` (a 404). A network failure or an unreadable body rejects. Actions
 * answer an {@link ActionResult}.
 */
export interface ContractClient {
  session(): Promise<Session>;
  signIn(credentials: Credentials): Promise<ActionResult>;
  signUp(credentials: Credentials): Promise<ActionResult>;
  signOut(): Promise<ActionResult>;

  /** `undefined` when signed out. */
  quota(): Promise<Quota | undefined>;
  requestIndex(repo: string): Promise<IndexRequestResult>;

  job(jobId: string): Promise<Job | undefined>;
  /** Follows a job's events until `done`; returns a function that stops it. */
  watchJob(jobId: string, onEvent: (event: JobEvent) => void, onError: (error: Error) => void): () => void;

  /** The signed-in account's jobs, newest first; `undefined` when signed out. */
  jobs(): Promise<JobList | undefined>;

  listRepositories(page?: number): Promise<RepositoryPage>;
  /** `undefined` when the repository has never been indexed. */
  repository(owner: string, name: string): Promise<RepositorySummary | undefined>;

  /** `undefined` when the repository has never been indexed. */
  snapshotPointer(owner: string, name: string): Promise<SnapshotPointer | undefined>;
  /** `undefined` when the snapshot is no longer published. */
  manifest(snapshotId: string): Promise<SnapshotManifest | undefined>;
  view<K extends ViewName>(snapshotId: string, name: K): Promise<ViewBodies[K]>;
  architectureLevel(snapshotId: string, position: number): Promise<ArchitectureLevelView>;
  regionDetailIndex(snapshotId: string): Promise<RegionDetailIndex>;
  regionDetail(snapshotId: string, position: number): Promise<RegionDetailView>;
}
