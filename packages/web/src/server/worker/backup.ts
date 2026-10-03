/**
 * hosting-3 Requirement 10.5: daily SQLite backup into the artifact store.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactStore } from "@repohive/indexer";
import type { AppDatabase } from "@/server/app-db/database";
import { utcCalendarDay } from "@/server/auth/time";

const BACKUP_PREFIX = "backup/";
const RETAIN_DAYS = 7;

function backupKeyForDay(utcDay: string): string {
  return `${BACKUP_PREFIX}app-${utcDay}.sqlite`;
}

export async function maybeBackupAppDatabase(
  db: AppDatabase,
  dbFilePath: string,
  store: ArtifactStore,
): Promise<boolean> {
  const today = utcCalendarDay();
  const row = db.prepare("SELECT last_backup_utc_day FROM worker_backup_state WHERE id = 1").get() as
    | { last_backup_utc_day: string | null }
    | undefined;
  const lastDay = row?.last_backup_utc_day ?? null;
  if (lastDay === today) {
    return false;
  }

  const tempDir = join(dbFilePath, "..", ".backup-tmp");
  mkdirSync(tempDir, { recursive: true });
  const tempFile = join(tempDir, `app-${today}.sqlite`);
  const escapedPath = tempFile.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escapedPath}'`);
  const body = new Uint8Array(readFileSync(tempFile));
  await store.put(backupKeyForDay(today), body, { contentType: "application/x-sqlite3" });

  const keys = await store.list(BACKUP_PREFIX);
  const dated = keys
    .filter((key) => key.startsWith(`${BACKUP_PREFIX}app-`) && key.endsWith(".sqlite"))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  if (dated.length > RETAIN_DAYS) {
    await store.delete(dated.slice(RETAIN_DAYS));
  }

  rmSync(tempFile, { force: true });
  db.prepare(
    "INSERT INTO worker_backup_state (id, last_backup_utc_day) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET last_backup_utc_day = excluded.last_backup_utc_day",
  ).run(today);
  return true;
}

/** Copies a backup object back over the live database file (manual restore). */
export async function restoreAppDatabaseFromBackup(
  store: ArtifactStore,
  utcDay: string,
  dbFilePath: string,
): Promise<void> {
  const object = await store.get(backupKeyForDay(utcDay));
  if (object === undefined) {
    throw new Error(`no backup for ${utcDay}`);
  }
  copyFileSync(dbFilePath, `${dbFilePath}.before-restore`);
  writeFileSync(dbFilePath, object.body);
}
