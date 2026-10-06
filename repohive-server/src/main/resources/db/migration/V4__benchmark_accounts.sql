CREATE TABLE bench_accounts (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE bench_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  email TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('ENABLED', 'DISABLED')),
  expires_at TEXT,
  changed_at TEXT NOT NULL,
  changed_from_ip TEXT NOT NULL
);
