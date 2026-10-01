/**
 * The job vocabulary the interfaces share.
 * Types only: the behaviour lands with the ledger, the fetcher and `runJob`.
 */

/** Size tiers, smallest first. S and M run on Lambda; L and XL share the large slot on Fargate. */
export type Tier = "S" | "M" | "L" | "XL";

/** `user`: the repository or its archive is at fault. `system`: everything else. */
export type FailureClass = "user" | "system";

/** Who may read a snapshot. v1 publishes public snapshots only. */
export type Visibility = "public";

/** One request to index one repository at one commit. */
export interface JobInput {
  readonly jobId: string;
  readonly accountId: string;
  /** `github.com/<owner>/<repo>`, lowercase. */
  readonly repo: string;
  readonly commitSha: string;
  readonly tier: Tier;
  readonly snapshotId: string;
  readonly visibility: Visibility;
}

/** Job states in forward order. */
export type JobState =
  | "queued"
  | "waiting-for-slot"
  | "fetching"
  | "parsing"
  | "grouping"
  | "building-views"
  | "publishing"
  | "succeeded"
  | "failed";

/** A typed failure: its class, a stable machine code, and a message safe to show the user. */
export interface JobFailure {
  readonly failureClass: FailureClass;
  readonly code: string;
  readonly message: string;
}
