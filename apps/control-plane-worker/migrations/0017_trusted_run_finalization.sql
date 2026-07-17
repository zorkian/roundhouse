-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS trusted_run_finalizations (
  run_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  claim_id TEXT,
  claim_expires_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, revision)
);
