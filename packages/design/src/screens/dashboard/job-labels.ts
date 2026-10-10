import { isTerminalJobState, type JobListItem, type JobState } from "../../contracts";
import type { StatusTone } from "../../components/status";

/** How a state reads in a progress line. The stage names are the artifact's. */
export const JOB_STATE_LABEL: Readonly<Record<JobState, string>> = {
  queued: "Queued",
  "waiting-for-slot": "Waiting for a slot",
  fetching: "Fetching the repository",
  parsing: "Parsing source files",
  grouping: "Building the hierarchy",
  "building-views": "Building views",
  publishing: "Publishing",
  succeeded: "Succeeded",
  failed: "Failed",
};

/** The short word for a state column; the stage names are for the progress line. */
export function jobStateWord(state: JobState): string {
  if (state === "queued") return "Queued";
  if (state === "waiting-for-slot") return "Waiting for a slot";
  if (state === "succeeded") return "Succeeded";
  if (state === "failed") return "Failed";
  return "Running";
}

export function jobTone(state: JobState): StatusTone {
  if (state === "succeeded") return "ok";
  if (state === "failed") return "err";
  if (state === "queued" || state === "waiting-for-slot") return "idle";
  return "run";
}

export const isInProgress = (job: Pick<JobListItem, "state">): boolean => !isTerminalJobState(job.state);

/** Names a recorded engine or job stage; one it does not know is shown as it was recorded. */
export function stageLabel(stage: string): string {
  const known = (JOB_STATE_LABEL as Readonly<Record<string, string>>)[stage];
  return known ?? stage;
}
