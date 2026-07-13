-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS github_webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  repository_full_name TEXT NOT NULL,
  sender_login TEXT,
  status TEXT NOT NULL CHECK (status IN ('received', 'completed', 'ignored', 'failed')),
  result_json TEXT,
  claim_id TEXT,
  claim_expires_at TEXT,
  received_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS github_webhook_deliveries_status
  ON github_webhook_deliveries(status, received_at);

CREATE TABLE IF NOT EXISTS github_issue_runs (
  issue_number INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_comment_outbox (
  comment_key TEXT PRIMARY KEY,
  issue_number INTEGER NOT NULL,
  body TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent')),
  github_comment_id INTEGER,
  github_comment_url TEXT,
  claim_id TEXT,
  claim_expires_at TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS github_comment_outbox_pending
  ON github_comment_outbox(status, created_at);

CREATE TABLE IF NOT EXISTS github_check_observations (
  pull_request_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  check_key TEXT NOT NULL,
  status TEXT NOT NULL,
  conclusion TEXT,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (pull_request_number, head_sha, check_key)
);
