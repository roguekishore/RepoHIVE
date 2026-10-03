/**
 * Application SQLite (hosting-3 step 4): one file under `REPOHIVE_DATA_DIR`,
 * schema applied on open, version recorded in `schema_version`.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAppConfig } from "@/server/hosting/config";
import { APP_DB_FILENAME, APP_DB_SCHEMA_VERSION, applyAppDbSchema } from "./schema";

export type AppDatabase = DatabaseSync;

function ensureSchemaVersion(db: DatabaseSync): void {
  applyAppDbSchema(db);
  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | undefined;
  if (row === undefined) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(APP_DB_SCHEMA_VERSION);
    return;
  }
  if (row.version < APP_DB_SCHEMA_VERSION) {
    db.prepare("UPDATE schema_version SET version = ?").run(APP_DB_SCHEMA_VERSION);
    return;
  }
  if (row.version !== APP_DB_SCHEMA_VERSION) {
    throw new Error(`app database schema ${row.version} does not match expected ${APP_DB_SCHEMA_VERSION}`);
  }
}

/** Opens (or creates) the database file and ensures the schema is current. */
export function openAppDatabase(filePath: string): AppDatabase {
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA foreign_keys = ON");
  ensureSchemaVersion(db);
  return db;
}

let cached: AppDatabase | undefined;

/** Process-wide handle, lazily opened from configuration. */
export function getAppDatabase(): AppDatabase {
  if (cached === undefined) {
    const { dataDirectory } = getAppConfig();
    mkdirSync(dataDirectory, { recursive: true });
    cached = openAppDatabase(join(dataDirectory, APP_DB_FILENAME));
  }
  return cached;
}

/** Vitest-only: replace or clear the singleton. */
export function resetAppDatabaseForTests(db?: AppDatabase): void {
  cached = db;
}
