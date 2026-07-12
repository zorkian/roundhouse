-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS trusted_approval_audit (
  approval_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  run_revision INTEGER NOT NULL,
  base_commit TEXT NOT NULL,
  patch_sha256 TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  approver TEXT NOT NULL,
  source_actor TEXT NOT NULL,
  approved_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS trusted_approval_audit_run
  ON trusted_approval_audit(run_id, run_revision);

CREATE TABLE IF NOT EXISTS trusted_publication_audit (
  publication_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  run_revision INTEGER NOT NULL,
  branch TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  remote_url TEXT NOT NULL,
  pull_request_url TEXT,
  verified_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS trusted_publication_audit_run
  ON trusted_publication_audit(run_id, run_revision);
