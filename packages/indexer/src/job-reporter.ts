/**
 * How a job tells the server what it is doing and how it ended. The job reports
 * stage changes and engine progress while it runs, and exactly one outcome at the end.
 */
import type { FailureClass, JobState, Tier } from "./job-types.js";

/** The job's latest progress, from the engine's events and the job's own stages. */
export interface JobProgress {
  /** The engine stage or job stage the numbers belong to. */
  readonly stage: string;
  readonly completed?: number;
  readonly total?: number;
}

export type JobOutcome =
  | {
      readonly status: "succeeded";
      readonly snapshotId: string;
      readonly commitSha: string;
      readonly engineVersion: string;
      readonly viewsVersion: string;
      readonly nodeCount: number;
      readonly edgeCount: number;
    }
  | { readonly status: "failed"; readonly failureClass: FailureClass; readonly failureCode: string; readonly message: string }
  | { readonly status: "retier"; readonly tier: Tier };

export interface JobReporter {
  /** A state change and/or new progress. Progress-only updates may be throttled or dropped. */
  progress(jobId: string, update: { state?: JobState; progress?: JobProgress }): Promise<void>;
  /** The job's one outcome. */
  complete(jobId: string, outcome: JobOutcome): Promise<void>;
}
