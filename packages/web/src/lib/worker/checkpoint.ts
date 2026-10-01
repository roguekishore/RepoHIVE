import type { AppDatabase } from "@/lib/app-db/database";

const EPOCH = "1970-01-01T00:00:00.000Z";

export function readWorkerCheckpoint(db: AppDatabase): string {
  const row = db.prepare("SELECT last_ended_at FROM worker_checkpoint WHERE id = 1").get() as
    | { last_ended_at: string }
    | undefined;
  if (row === undefined) {
    db.prepare("INSERT INTO worker_checkpoint (id, last_ended_at) VALUES (1, ?)").run(EPOCH);
    return EPOCH;
  }
  return row.last_ended_at;
}

export function writeWorkerCheckpoint(db: AppDatabase, lastEndedAt: string): void {
  db.prepare(
    "INSERT INTO worker_checkpoint (id, last_ended_at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_ended_at = excluded.last_ended_at",
  ).run(lastEndedAt);
}
