-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS github_issue_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  issue_number INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE(issue_number, content_sha256)
);

CREATE INDEX IF NOT EXISTS github_issue_snapshots_issue
  ON github_issue_snapshots(issue_number, fetched_at);

CREATE TABLE IF NOT EXISTS github_publications (
  run_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planning', 'published')),
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS github_publications_status
  ON github_publications(status, updated_at);
