-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS github_issue_plans (
  plan_id TEXT PRIMARY KEY,
  issue_number INTEGER NOT NULL UNIQUE,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'rejected', 'approved', 'materialized')),
  plan_sha256 TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  evidence_object_key TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL,
  evidence_size INTEGER NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  run_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS github_issue_plans_status
  ON github_issue_plans(status, updated_at);

CREATE TABLE IF NOT EXISTS github_plan_events (
  event_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE(plan_id, sequence)
);

CREATE INDEX IF NOT EXISTS github_plan_events_plan
  ON github_plan_events(plan_id, sequence);

CREATE INDEX IF NOT EXISTS self_development_runs_dashboard
  ON self_development_runs(updated_at DESC, state);
