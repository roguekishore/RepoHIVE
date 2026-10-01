/**
 * Shared helpers for ledger implementations.
 */
import type { JobInput, JobState } from "./job-types.js";
import type { JobEnd, JobProgress, JobRecord } from "./job-ledger.js";
import { JOB_TTL_SECONDS } from "./job-ledger-states.js";

export function jobPk(jobId: string): string {
  return `JOB#${jobId}`;
}

export function repoPk(repo: string): string {
  return `REPO#${repo}`;
}

export const INFLIGHT_PK = "INFLIGHT";
export const LARGE_SLOT_PK = "SLOT#large";

export function utcNowIso(): string {
  return new Date().toISOString();
}

export function epochSecondsFromIso(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

export function expiresAtAfterEnd(endedAtIso: string): number {
  return epochSecondsFromIso(endedAtIso) + JOB_TTL_SECONDS;
}

export function newJobRecord(input: JobInput, now = utcNowIso()): JobRecord {
  return {
    input,
    state: "queued",
    createdAt: now,
    updatedAt: now,
  };
}

export function applyJobEnd(record: JobRecord, end: JobEnd, now = utcNowIso()): JobRecord {
  if (end.state === "succeeded") {
    return {
      ...record,
      state: "succeeded",
      failureClass: undefined,
      failureCode: undefined,
      updatedAt: now,
      endedAt: now,
      expiresAt: expiresAtAfterEnd(now),
    };
  }
  return {
    ...record,
    state: "failed",
    failureClass: end.failureClass,
    failureCode: end.failureCode,
    updatedAt: now,
    endedAt: now,
    expiresAt: expiresAtAfterEnd(now),
  };
}

export function withRequeueTier(record: JobRecord, tier: JobInput["tier"], now = utcNowIso()): JobRecord {
  return {
    ...record,
    input: { ...record.input, tier },
    state: "queued",
    failureClass: undefined,
    failureCode: undefined,
    updatedAt: now,
    endedAt: undefined,
    expiresAt: undefined,
  };
}

export function withTransition(record: JobRecord, to: JobState, now = utcNowIso()): JobRecord {
  return { ...record, state: to, updatedAt: now };
}

export function withProgress(record: JobRecord, progress: JobProgress, now = utcNowIso()): JobRecord {
  return { ...record, progress, updatedAt: now };
}

/** Internal field persisted with the job in memory and file stores. */
export interface StoredJob extends JobRecord {
  readonly lastProgressWriteMs?: number;
}

export function toJobRecord(stored: StoredJob): JobRecord {
  const { lastProgressWriteMs: _ignored, ...record } = stored;
  return record;
}

export function listJobsEndedSinceFromRecords(
  records: Iterable<StoredJob>,
  sinceIso: string,
): readonly JobRecord[] {
  const sinceMs = Date.parse(sinceIso);
  if (!Number.isFinite(sinceMs)) {
    throw new RangeError(`listJobsEndedSince: invalid since timestamp: ${JSON.stringify(sinceIso)}`);
  }
  const ended: JobRecord[] = [];
  for (const stored of records) {
    const endedAt = stored.endedAt;
    if (endedAt === undefined) {
      continue;
    }
    const endedMs = Date.parse(endedAt);
    if (!Number.isFinite(endedMs) || endedMs <= sinceMs) {
      continue;
    }
    ended.push(toJobRecord(stored));
  }
  ended.sort((a, b) => Date.parse(a.endedAt!) - Date.parse(b.endedAt!));
  return ended;
}
