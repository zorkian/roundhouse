-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS execution_attempt_phases (
  attempt_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  PRIMARY KEY (attempt_id, phase)
);

CREATE INDEX IF NOT EXISTS execution_attempt_phases_run
  ON execution_attempt_phases(run_id, started_at);

CREATE TABLE IF NOT EXISTS github_pull_request_lifecycle (
  repository_full_name TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'closed', 'merged')),
  merge_commit_sha TEXT,
  merged_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (repository_full_name, pull_request_number),
  UNIQUE (run_id)
);

CREATE INDEX IF NOT EXISTS github_pull_request_lifecycle_run
  ON github_pull_request_lifecycle(run_id);
