/**
 * Job state shared between the app box and the indexers. Local implementations: in-process or a JSON file.
 * AWS implementation: one DynamoDB table.
 *
 * Implementations: memory, file and DynamoDB (`createMemoryJobLedger`, `createFileJobLedger`,
 * `createDynamoDbJobLedger`). The shared contract suite is in `job-ledger-contract.test.ts`.
 */
import type { FailureClass, JobInput, JobState, Tier } from "./job-types.js";

/** The job's latest progress, from the engine's events and the job's own stages. */
export interface JobProgress {
  /** The engine stage or job stage the numbers belong to. */
  readonly stage: string;
  readonly completed?: number;
  readonly total?: number;
}

/** Everything the ledger keeps per job. Times are ISO-8601 UTC strings. */
export interface JobRecord {
  readonly input: JobInput;
  readonly state: JobState;
  readonly failureClass?: FailureClass;
  readonly failureCode?: string;
  readonly progress?: JobProgress;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly endedAt?: string;
  /** Epoch seconds, 30 days after the job ends. */
  readonly expiresAt?: number;
}

/** The outcome of claiming a job for a repository. */
export type ClaimResult =
  | { readonly claimed: true; readonly jobId: string }
  /** The repository already has a job in flight; this is its id. */
  | { readonly claimed: false; readonly reason: "repo-in-flight"; readonly jobId: string }
  /** The global in-flight cap is reached. */
  | { readonly claimed: false; readonly reason: "inflight-cap" };

/** How a job ended. */
export type JobEnd =
  | { readonly state: "succeeded" }
  | { readonly state: "failed"; readonly failureClass: FailureClass; readonly failureCode: string };

export interface JobLedger {
  /** Records a `queued` job, taking the repository lock and an in-flight unit. */
  claim(input: JobInput): Promise<ClaimResult>;
  get(jobId: string): Promise<JobRecord | undefined>;
  /** Moves a job forward; a backward or repeated transition is rejected. */
  transition(jobId: string, to: JobState): Promise<void>;
  /** Writes the job's progress without changing its state. */
  writeProgress(jobId: string, progress: JobProgress): Promise<void>;
  /** The one backward move: a `retier` result returns the job to `queued` on its new tier. */
  requeue(jobId: string, tier: Tier): Promise<void>;
  /** Ends a job: final state, repository lock and in-flight unit released, expiry set. */
  finish(jobId: string, end: JobEnd): Promise<void>;
  /** Takes the large slot for `jobId` until `leaseUntilMs`, if it is free or expired. */
  acquireLargeSlot(jobId: string, leaseUntilMs: number): Promise<boolean>;
  /** Releases the large slot if `jobId` holds it. */
  releaseLargeSlot(jobId: string): Promise<void>;
}
