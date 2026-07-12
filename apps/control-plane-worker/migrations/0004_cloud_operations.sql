-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS operator_mutations (
  idempotency_key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  run_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  response_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS operator_mutations_run
  ON operator_mutations(run_id, created_at);

CREATE TABLE IF NOT EXISTS operational_alerts (
  alert_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  run_id TEXT,
  detail_json TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS operational_alerts_active
  ON operational_alerts(resolved_at, last_seen_at);

CREATE TABLE IF NOT EXISTS recovery_cycles (
  cycle_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  repaired_submissions INTEGER NOT NULL,
  requeued_runs INTEGER NOT NULL,
  alerts_recorded INTEGER NOT NULL
);
