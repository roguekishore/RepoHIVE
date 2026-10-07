/**
 * The signed-in account's job list (`GET /api/account/jobs`). The account's job ids are the
 * `index_charges` rows it owns; each id is read from the ledger, so every field returned is a recorded one. A job the ledger no longer holds (it expires 30 days after it ends), or whose record names another
 * account, is left out.
 */
import type { JobList, JobListItem } from "@repohive/design/contracts";
import type { JobLedger, JobRecord } from "@repohive/indexer";
import type { AppDatabase } from "@/server/app-db/database";

/** Most jobs the list returns. */
export const ACCOUNT_JOBS_LIMIT = 50;

function toListItem(record: JobRecord): JobListItem {
  const { input } = record;
  return {
    jobId: input.jobId,
    repo: input.repo,
    state: record.state,
    tier: input.tier,
    requestedAt: record.createdAt,
    ...(record.endedAt === undefined ? {} : { endedAt: record.endedAt }),
    ...(record.progress === undefined ? {} : { progress: record.progress }),
    ...(record.state === "succeeded" ? { result: { snapshotId: input.snapshotId } } : {}),
    ...(record.state === "failed" ? { failure: { code: record.failureCode ?? "FAILED" } } : {}),
  };
}

export async function listAccountJobs(db: AppDatabase, ledger: JobLedger, accountId: number): Promise<JobList> {
  const rows = db
    .prepare("SELECT job_id FROM index_charges WHERE account_id = ? ORDER BY charged_at DESC, id DESC LIMIT ?")
    .all(accountId, ACCOUNT_JOBS_LIMIT) as { job_id: string }[];

  const records = await Promise.all(rows.map((row) => ledger.get(row.job_id)));
  const items = records
    .filter((record): record is JobRecord => record !== undefined && record.input.accountId === String(accountId))
    .map(toListItem);
  // The ledger's own creation time is the order the screen shows; the charge time is only how the ids were found.
  items.sort((a, b) => (a.requestedAt === b.requestedAt ? 0 : a.requestedAt < b.requestedAt ? 1 : -1));
  return { items };
}
