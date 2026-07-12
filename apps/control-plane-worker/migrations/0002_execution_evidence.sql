-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS execution_egress_events (
  event_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  container_id TEXT NOT NULL,
  hostname TEXT NOT NULL,
  method TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS execution_egress_events_attempt
  ON execution_egress_events(attempt_id, occurred_at);
