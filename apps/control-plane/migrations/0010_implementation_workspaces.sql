-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE implementation_workspaces (
  run_id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL,
  backup_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE implementation_screenshots (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  commit_sha TEXT,
  object_key TEXT NOT NULL,
  route TEXT NOT NULL,
  port INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX implementation_screenshots_attempt
  ON implementation_screenshots(attempt_id, created_at);
