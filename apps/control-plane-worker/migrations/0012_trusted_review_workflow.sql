-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS trusted_review_workflows (
  workflow_instance_id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatched', 'running', 'completed', 'failed')),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE (review_id, delivery_id)
);
CREATE INDEX IF NOT EXISTS trusted_review_workflows_review
  ON trusted_review_workflows(review_id, created_at);
