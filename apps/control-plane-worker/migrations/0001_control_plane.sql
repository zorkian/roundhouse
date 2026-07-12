-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS self_development_runs (
  run_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS self_development_runs_claimable
  ON self_development_runs(state, updated_at);

CREATE TABLE IF NOT EXISTS control_plane_submissions (
  idempotency_key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  delivery_id TEXT NOT NULL,
  delivery_state TEXT NOT NULL CHECK (delivery_state IN ('pending', 'sent')),
  created_at TEXT NOT NULL,
  delivered_at TEXT
);
