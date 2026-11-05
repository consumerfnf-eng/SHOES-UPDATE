CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1), password_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_rate_limits (
  bucket TEXT PRIMARY KEY, window INTEGER NOT NULL, hits INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_snapshots (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_checks (
  brand TEXT PRIMARY KEY, checked_at TEXT NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_jobs (
  id TEXT PRIMARY KEY, brand TEXT NOT NULL, status TEXT NOT NULL,
  requested_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  lease TEXT, lease_until INTEGER, result TEXT, run_url TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_one_active_brand ON admin_jobs(brand)
  WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS admin_job_queue ON admin_jobs(status, requested_at);
CREATE TABLE IF NOT EXISTS admin_batches (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, created_at TEXT NOT NULL,
  target_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_batch_jobs (
  batch_id TEXT NOT NULL, job_id TEXT NOT NULL, brand TEXT NOT NULL,
  PRIMARY KEY(batch_id, brand)
);
