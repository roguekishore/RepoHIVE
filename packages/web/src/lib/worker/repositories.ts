import type { AppDatabase } from "@/lib/app-db/database";
import { nowIso } from "@/lib/auth/time";

export interface IndexedRepositoryRow {
  readonly repo: string;
  readonly snapshotId: string;
  readonly commitSha: string;
  readonly indexedAt: string;
  readonly nodeCount: number;
  readonly jobId: string;
}

export function upsertIndexedRepository(db: AppDatabase, row: IndexedRepositoryRow): void {
  db.prepare(
    `INSERT INTO indexed_repositories (repo, snapshot_id, commit_sha, indexed_at, node_count, job_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo) DO UPDATE SET
       snapshot_id = excluded.snapshot_id,
       commit_sha = excluded.commit_sha,
       indexed_at = excluded.indexed_at,
       node_count = excluded.node_count,
       job_id = excluded.job_id`,
  ).run(row.repo, row.snapshotId, row.commitSha, row.indexedAt, row.nodeCount, row.jobId);
}

export function markJobOutcomeProcessed(db: AppDatabase, jobId: string): boolean {
  const existing = db.prepare("SELECT 1 FROM worker_job_outcomes WHERE job_id = ?").get(jobId);
  if (existing !== undefined) {
    return false;
  }
  db.prepare("INSERT INTO worker_job_outcomes (job_id, processed_at) VALUES (?, ?)").run(jobId, nowIso());
  return true;
}

/** `github.com/<owner>/<repo>` to `/repos/<owner>/<repo>/knowledge-graph`. */
export function repoKeyToViewerPath(repoKey: string): string | undefined {
  const match = /^github\.com\/([^/]+)\/([^/]+)$/u.exec(repoKey);
  if (match === null) {
    return undefined;
  }
  return `/repos/${match[1]}/${match[2]}/knowledge-graph`;
}
