-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE model_usage_next (
  call_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  model TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  configured_model TEXT,
  routing_rule TEXT,
  input_tokens INTEGER,
  cached_input_tokens INTEGER,
  reasoning_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, call_id)
);
INSERT INTO model_usage_next
SELECT call_id,attempt_id,model,COALESCE(provider,''),configured_model,routing_rule,input_tokens,cached_input_tokens,reasoning_tokens,output_tokens,total_tokens,cost_usd,created_at
FROM model_usage;
DROP TABLE model_usage;
ALTER TABLE model_usage_next RENAME TO model_usage;
CREATE INDEX model_usage_attempt ON model_usage(attempt_id);
