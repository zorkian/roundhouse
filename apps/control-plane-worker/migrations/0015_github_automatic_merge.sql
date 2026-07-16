-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS github_automatic_merges (
  repository_full_name TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'merging', 'merged', 'blocked')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  claim_id TEXT,
  claim_expires_at TEXT,
  merge_commit_sha TEXT,
  failure_code TEXT,
  next_action TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  projection_completed_at TEXT,
  PRIMARY KEY (repository_full_name, pull_request_number, head_sha),
  UNIQUE (run_id)
);

CREATE INDEX IF NOT EXISTS github_automatic_merges_recovery
  ON github_automatic_merges(status, updated_at);
