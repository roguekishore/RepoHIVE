/** Current SQLite schema; bump when a phase adds tables or columns. */
export const APP_DB_SCHEMA_VERSION = 1;

export const APP_DB_FILENAME = "app.sqlite";

/** Creates tables if they are missing. Idempotent. */
export function applyAppDbSchema(db: { exec: (sql: string) => void }): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_salt BLOB NOT NULL,
      password_hash BLOB NOT NULL,
      scrypt_n INTEGER NOT NULL,
      scrypt_r INTEGER NOT NULL,
      scrypt_p INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      created_utc_day TEXT NOT NULL,
      created_ip TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_created_ip_day
      ON accounts (created_ip, created_utc_day);

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash BLOB NOT NULL PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions (account_id);

    CREATE TABLE IF NOT EXISTS sign_in_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
      ip TEXT NOT NULL,
      failed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sign_in_failures_account_time
      ON sign_in_failures (account_id, failed_at);
    CREATE INDEX IF NOT EXISTS idx_sign_in_failures_ip_time
      ON sign_in_failures (ip, failed_at);
  `);
}
