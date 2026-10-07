/**
 * The answer to `POST /api/index`. Every status is a normal outcome the screen explains; only a network failure is an
 * error.
 */
export type IndexRequestResult =
  /** The repository is already indexed at this commit. */
  | { readonly status: "cached"; readonly repo: string; readonly snapshotId: string }
  /** A job for this repository is already running; follow it. */
  | { readonly status: "joined"; readonly jobId: string }
  | { readonly status: "accepted"; readonly jobId: string }
  /** The service is at capacity; ask again later. */
  | { readonly status: "busy"; readonly retryAfterSeconds: number }
  | { readonly status: "rejected"; readonly code: string; readonly message: string };
