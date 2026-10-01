/**
 * Job-state ordering for the ledger.
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

/** Whether `transition` may move from `from` to `to` (terminal states use `finish`). */
export function isForwardJobTransition(from: JobState, to: JobState): boolean {
  if (from === to || TERMINAL.has(from) || TERMINAL.has(to)) {
    return false;
  }
  return jobStateIndex(to) > jobStateIndex(from);
}

/** Seconds from `endedAt` until the ledger TTL. */
export const JOB_TTL_SECONDS = 30 * 24 * 60 * 60;

export const DEFAULT_INFLIGHT_CAP = 5;

/** Minimum interval between throttled progress writes. */
export const PROGRESS_WRITE_INTERVAL_MS = 2000;
