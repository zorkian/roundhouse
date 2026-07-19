-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE model_usage (
  call_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  model TEXT NOT NULL,
  input_tokens INTEGER,
  cached_input_tokens INTEGER,
  reasoning_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL,
  created_at INTEGER NOT NULL
);
CREATE INDEX model_usage_attempt ON model_usage(attempt_id);
