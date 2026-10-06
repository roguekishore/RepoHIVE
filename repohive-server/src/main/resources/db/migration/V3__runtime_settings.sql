CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE settings_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  old_value INTEGER NOT NULL,
  new_value INTEGER NOT NULL,
  changed_at TEXT NOT NULL,
  changed_from_ip TEXT NOT NULL
);
CREATE INDEX idx_settings_audit_changed_at ON settings_audit (changed_at);
