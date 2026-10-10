/** Where an indexing job is, in order. `succeeded` and `failed` are the two end states. */
export const JOB_STATES = [
  "queued",
  "waiting-for-slot",
  "fetching",
  "parsing",
  "grouping",
  "building-views",
  "publishing",
  "succeeded",
  "failed",
] as const;

export type JobState = (typeof JOB_STATES)[number];

export function isTerminalJobState(state: JobState): state is "succeeded" | "failed" {
  return state === "succeeded" || state === "failed";
}

/** The latest numbers for the stage the job is in. `completed` and `total` are absent while a stage has no count. */
export interface JobProgress {
  readonly stage: string;
  readonly completed?: number;
  readonly total?: number;
}

export interface JobFailure {
  readonly code: string;
  /** Absent in the event stream, which carries the code only. */
  readonly message?: string;
}

/** `GET /api/jobs/<id>`. */
export interface Job {
  readonly repo: string;
  readonly state: JobState;
  readonly progress?: JobProgress;
  readonly result?: { readonly snapshotId: string };
  readonly failure?: JobFailure;
}

/** The payload of one event on `GET /api/jobs/<id>/events`: the job plus its id. */
export interface JobEventData extends Job {
  readonly jobId: string;
}

/** `progress` events repeat until the job ends; `done` is the last one. */
export interface JobEvent {
  readonly event: "progress" | "done";
  readonly data: JobEventData;
}

/** The size classes a job runs under, smallest first (the indexer's tiers). */
export const SIZE_TIERS = ["S", "M", "L", "XL"] as const;

export type SizeTier = (typeof SIZE_TIERS)[number];

/** One job in the signed-in account's list: the ledger's record of it, in the shapes the other job types use. */
export interface JobListItem {
  readonly jobId: string;
  /** `github.com/<owner>/<repo>`, lowercase, as in {@link Job.repo}. */
  readonly repo: string;
  readonly state: JobState;
  /** The size class the request was admitted under. */
  readonly tier: SizeTier;
  /** ISO-8601 UTC: when the job was recorded. */
  readonly requestedAt: string;
  /** ISO-8601 UTC: present once the job has ended. */
  readonly endedAt?: string;
  readonly progress?: JobProgress;
  readonly result?: { readonly snapshotId: string };
  readonly failure?: JobFailure;
}

/** `GET /api/account/jobs`: the signed-in account's jobs, newest first. Signed out answers 401, and the client `undefined`. */
export interface JobList {
  readonly items: readonly JobListItem[];
}
