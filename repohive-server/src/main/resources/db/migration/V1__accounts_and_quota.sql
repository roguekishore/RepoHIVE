CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  scrypt_n INTEGER NOT NULL,
  scrypt_r INTEGER NOT NULL,
  scrypt_p INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_utc_day TEXT NOT NULL,
  created_ip TEXT NOT NULL
);
CREATE INDEX idx_accounts_created_ip_day ON accounts (created_ip, created_utc_day);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_account ON sessions (account_id);
CREATE TABLE sign_in_failures (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  failed_at TEXT NOT NULL
);
CREATE INDEX idx_sign_in_failures_account_time ON sign_in_failures (account_id, failed_at);
CREATE INDEX idx_sign_in_failures_ip_time ON sign_in_failures (ip, failed_at);
CREATE TABLE precheck_hourly (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);
CREATE TABLE index_charges (
  job_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  charged_at TEXT NOT NULL,
  refunded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_index_charges_account_day ON index_charges (account_id, utc_day, refunded);
CREATE INDEX idx_index_charges_ip_day ON index_charges (ip, utc_day, refunded);
CREATE TABLE backup_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_backup_utc_day TEXT
);
