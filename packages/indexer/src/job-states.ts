/**
 * Job-state ordering. The server applies a reported state only if it moves forward;
 * the worker uses the same order to avoid reporting a state twice.
 */
import type { JobState } from "./job-types.js";

/** Pipeline states in forward order; terminal states follow for indexing only. */
export const JOB_STATE_ORDER: readonly JobState[] = [
  "queued",
  "waiting-for-slot",
  "fetching",
  "parsing",
  "grouping",
  "building-views",
  "publishing",
  "succeeded",
  "failed",
];

const TERMINAL = new Set<JobState>(["succeeded", "failed"]);

export function isTerminalJobState(state: JobState): boolean {
  return TERMINAL.has(state);
}

export function jobStateIndex(state: JobState): number {
  const index = JOB_STATE_ORDER.indexOf(state);
  if (index < 0) {
    throw new RangeError(`unknown job state: ${state}`);
  }
  return index;
}

/** Whether a report may move from `from` to `to` (terminal states are reported through `complete`). */
export function isForwardJobTransition(from: JobState, to: JobState): boolean {
  if (from === to || TERMINAL.has(from) || TERMINAL.has(to)) {
    return false;
  }
  return jobStateIndex(to) > jobStateIndex(from);
}

/** Minimum interval between progress-only reports. */
export const PROGRESS_WRITE_INTERVAL_MS = 2000;
