/**
 * In-process {@link JobLedger} (local `memory` config).
 */
import type { JobLedger, JobProgress, JobRecord } from "./job-ledger.js";
import type { ClaimResult, JobEnd } from "./job-ledger.js";
import type { JobInput, JobState, Tier } from "./job-types.js";
import {
  DEFAULT_INFLIGHT_CAP,
  PROGRESS_WRITE_INTERVAL_MS,
  isForwardJobTransition,
} from "./job-ledger-states.js";
import {
  INFLIGHT_PK,
  LARGE_SLOT_PK,
  applyJobEnd,
  jobPk,
  listJobsEndedSinceFromRecords,
  newJobRecord,
  repoPk,
  toJobRecord,
  utcNowIso,
  withProgress,
  withRequeueTier,
  withTransition,
  type StoredJob,
} from "./job-ledger-util.js";

export interface MemoryJobLedgerOptions {
  readonly inflightCap?: number;
  /** Injectable clock for tests. */
  readonly nowMs?: () => number;
}

export type Row =
  | { readonly kind: "job"; readonly data: StoredJob }
  | { readonly kind: "repo"; readonly jobId: string }
  | { readonly kind: "inflight"; readonly count: number }
  | { readonly kind: "slot"; readonly jobId: string; readonly leaseUntilMs: number };

export type MemoryJobLedger = JobLedger & { readonly rows: Map<string, Row> };

export function createMemoryJobLedger(options: MemoryJobLedgerOptions = {}): MemoryJobLedger {
  const inflightCap = options.inflightCap ?? DEFAULT_INFLIGHT_CAP;
  const nowMs = options.nowMs ?? (() => Date.now());
  const rows = new Map<string, Row>();

  function getJobRow(jobId: string): StoredJob | undefined {
    const row = rows.get(jobPk(jobId));
    return row?.kind === "job" ? row.data : undefined;
  }

  function putJob(stored: StoredJob): void {
    rows.set(jobPk(stored.input.jobId), { kind: "job", data: stored });
  }

  function inflightCount(): number {
    const row = rows.get(INFLIGHT_PK);
    return row?.kind === "inflight" ? row.count : 0;
  }

  const ledger: JobLedger = {
    async claim(input: JobInput): Promise<ClaimResult> {
      const existing = rows.get(repoPk(input.repo));
      if (existing?.kind === "repo") {
        return { claimed: false, reason: "repo-in-flight", jobId: existing.jobId };
      }
      if (inflightCount() >= inflightCap) {
        return { claimed: false, reason: "inflight-cap" };
      }
      const now = utcNowIso();
      rows.set(repoPk(input.repo), { kind: "repo", jobId: input.jobId });
      rows.set(INFLIGHT_PK, { kind: "inflight", count: inflightCount() + 1 });
      putJob(newJobRecord(input, now));
      return { claimed: true, jobId: input.jobId };
    },

    async get(jobId: string): Promise<JobRecord | undefined> {
      const stored = getJobRow(jobId);
      return stored ? toJobRecord(stored) : undefined;
    },

    async transition(jobId: string, to: JobState): Promise<void> {
      const stored = getJobRow(jobId);
      if (!stored) {
        throw new Error(`unknown job: ${jobId}`);
      }
      if (!isForwardJobTransition(stored.state, to)) {
        throw new Error(`invalid transition from ${stored.state} to ${to}`);
      }
      putJob(withTransition(stored, to));
    },

    async writeProgress(jobId: string, progress: JobProgress): Promise<void> {
      const stored = getJobRow(jobId);
      if (!stored) {
        throw new Error(`unknown job: ${jobId}`);
      }
      const t = nowMs();
      if (
        stored.lastProgressWriteMs !== undefined &&
        t - stored.lastProgressWriteMs < PROGRESS_WRITE_INTERVAL_MS
      ) {
        return;
      }
      putJob({ ...withProgress(stored, progress), lastProgressWriteMs: t });
    },

    async requeue(jobId: string, tier: Tier): Promise<void> {
      const stored = getJobRow(jobId);
      if (!stored) {
        throw new Error(`unknown job: ${jobId}`);
      }
      putJob(withRequeueTier(stored, tier));
    },

    async finish(jobId: string, end: JobEnd): Promise<void> {
      const stored = getJobRow(jobId);
      if (!stored) {
        throw new Error(`unknown job: ${jobId}`);
      }
      const now = utcNowIso();
      putJob(applyJobEnd(stored, end, now));
      const repoLock = rows.get(repoPk(stored.input.repo));
      if (repoLock?.kind === "repo" && repoLock.jobId === jobId) {
        rows.delete(repoPk(stored.input.repo));
      }
      const count = inflightCount();
      if (count > 0) {
        rows.set(INFLIGHT_PK, { kind: "inflight", count: count - 1 });
      }
    },

    async acquireLargeSlot(jobId: string, leaseUntilMs: number): Promise<boolean> {
      const row = rows.get(LARGE_SLOT_PK);
      const t = nowMs();
      if (row?.kind === "slot" && row.leaseUntilMs > t && row.jobId !== jobId) {
        return false;
      }
      rows.set(LARGE_SLOT_PK, { kind: "slot", jobId, leaseUntilMs });
      return true;
    },

    async releaseLargeSlot(jobId: string): Promise<void> {
      const row = rows.get(LARGE_SLOT_PK);
      if (row?.kind === "slot" && row.jobId === jobId) {
        rows.delete(LARGE_SLOT_PK);
      }
    },

    async listJobsEndedSince(sinceIso: string): Promise<readonly JobRecord[]> {
      const jobs: StoredJob[] = [];
      for (const row of rows.values()) {
        if (row.kind === "job") {
          jobs.push(row.data);
        }
      }
      return listJobsEndedSinceFromRecords(jobs, sinceIso);
    },
  };

  return Object.assign(ledger, { rows });
}
