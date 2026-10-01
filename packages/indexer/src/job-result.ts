/**
 * What a job returns (hosting-2 Requirement 3.2): one of three results.
 */
import type { FailureClass, Tier } from "./job-types.js";

/** Milliseconds per stage, measured with a monotonic clock. */
export interface JobDurations {
  readonly fetchMs: number;
  readonly parseMs: number;
  readonly groupMs: number;
  readonly viewsMs: number;
  readonly publishMs: number;
  readonly totalMs: number;
}

export interface JobCounts {
  /** Selected Java files handed to the engine. */
  readonly files: number;
  readonly nodes: number;
  readonly edges: number;
  readonly regions: number;
  /** Objects written under `s/` and `idx/`, including the manifest. */
  readonly objects: number;
  /** Stored (compressed) bytes of those objects. */
  readonly storedBytes: number;
}

export type JobResult =
  | {
      readonly status: "succeeded";
      readonly snapshotId: string;
      readonly counts: JobCounts;
      readonly durations: JobDurations;
    }
  | {
      readonly status: "failed";
      readonly failureClass: FailureClass;
      readonly code: string;
      /** Safe to show the user. */
      readonly message: string;
    }
  /** The post-fetch file count needs a larger tier; nothing was published. */
  | { readonly status: "retier"; readonly tier: Tier };
