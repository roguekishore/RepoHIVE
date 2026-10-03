CREATE TABLE indexed_repositories (
  repo TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  engine_version TEXT,
  views_version TEXT,
  node_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  indexed_at TEXT NOT NULL,
  job_id TEXT NOT NULL
);
CREATE INDEX idx_indexed_repositories_indexed_at ON indexed_repositories (indexed_at);
CREATE TABLE job_executions (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  tier TEXT NOT NULL CHECK (tier IN ('S', 'M', 'L', 'XL')),
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  state TEXT NOT NULL,
  progress_stage TEXT,
  progress_completed INTEGER,
  progress_total INTEGER,
  failure_class TEXT,
  failure_code TEXT,
  failure_message TEXT,
  retier_count INTEGER NOT NULL DEFAULT 0,
  restarted INTEGER NOT NULL DEFAULT 0,
  execution_ref TEXT,
  created_at TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE UNIQUE INDEX ux_job_executions_repo_open ON job_executions (repo) WHERE status IN ('QUEUED', 'RUNNING');
CREATE INDEX idx_job_executions_status_created ON job_executions (status, created_at);
CREATE INDEX idx_job_executions_account_status ON job_executions (account_id, status);
