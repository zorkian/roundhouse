-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE github_comment_outbox
  ADD COLUMN repository_full_name TEXT NOT NULL DEFAULT 'zorkian/roundhouse';

CREATE TABLE github_review_check_outbox (
  repository_full_name TEXT NOT NULL,
  review_id TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  revision INTEGER NOT NULL,
  check_status TEXT NOT NULL CHECK (check_status IN ('in_progress', 'completed')),
  conclusion TEXT CHECK (
    conclusion IS NULL OR conclusion IN ('success', 'failure', 'neutral', 'action_required')
  ),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent')),
  check_run_id INTEGER,
  check_run_url TEXT,
  claim_id TEXT,
  claim_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  PRIMARY KEY (repository_full_name, review_id)
);

CREATE INDEX github_review_check_outbox_pending
  ON github_review_check_outbox(status, updated_at);
