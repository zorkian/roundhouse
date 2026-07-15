-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS trusted_execution_workflows (
  workflow_instance_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatched', 'running', 'completed', 'failed')),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE (run_id, delivery_id)
);
CREATE INDEX IF NOT EXISTS trusted_execution_workflows_run
  ON trusted_execution_workflows(run_id, created_at);
