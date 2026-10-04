/**
 * A {@link JobReporter} that records every call: tests and the offline local run.
 */
import type { JobOutcome, JobProgress, JobReporter } from "./job-reporter.js";
import type { JobState } from "./job-types.js";

export type ReportedCall =
  | { readonly kind: "progress"; readonly jobId: string; readonly state?: JobState; readonly progress?: JobProgress }
  | { readonly kind: "complete"; readonly jobId: string; readonly outcome: JobOutcome };

export interface MemoryJobReporter extends JobReporter {
  /** Every call, in order. */
  readonly calls: readonly ReportedCall[];
  /** The states reported through `progress`, in order. */
  states(): JobState[];
  /** The last outcome reported, if any. */
  outcome(): JobOutcome | undefined;
}

export function createMemoryJobReporter(): MemoryJobReporter {
  const calls: ReportedCall[] = [];
  return {
    calls,
    async progress(jobId, update): Promise<void> {
      calls.push({
        kind: "progress",
        jobId,
        ...(update.state === undefined ? {} : { state: update.state }),
        ...(update.progress === undefined ? {} : { progress: update.progress }),
      });
    },
    async complete(jobId, outcome): Promise<void> {
      calls.push({ kind: "complete", jobId, outcome });
    },
    states(): JobState[] {
      return calls.flatMap((call) => (call.kind === "progress" && call.state !== undefined ? [call.state] : []));
    },
    outcome(): JobOutcome | undefined {
      for (let i = calls.length - 1; i >= 0; i -= 1) {
        const call = calls[i];
        if (call?.kind === "complete") return call.outcome;
      }
      return undefined;
    },
  };
}
