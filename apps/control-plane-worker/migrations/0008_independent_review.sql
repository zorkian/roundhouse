-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE independent_reviews (
  review_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  cycle INTEGER NOT NULL CHECK (cycle BETWEEN 1 AND 2),
  head_commit TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'pending',
      'running',
      'completed',
      'failed',
      'remediation_pending',
      'remediated'
    )
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  lease_expires_at TEXT,
  dispatch_state TEXT NOT NULL CHECK (dispatch_state IN ('pending', 'sent')),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, cycle),
  UNIQUE (run_id, head_commit)
);

CREATE INDEX independent_reviews_recovery
  ON independent_reviews(status, dispatch_state, lease_expires_at, updated_at);

CREATE TABLE independent_review_findings (
  finding_id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  head_commit TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  path TEXT NOT NULL,
  line INTEGER,
  disposition TEXT NOT NULL CHECK (
    disposition IN ('accepted', 'declined', 'duplicate', 'deferred')
  ),
  finding_json TEXT NOT NULL,
  disposition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (review_id) REFERENCES independent_reviews(review_id)
);

CREATE INDEX independent_review_findings_review
  ON independent_review_findings(review_id, severity, disposition);

CREATE TABLE independent_review_events (
  event_id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE (review_id, sequence),
  FOREIGN KEY (review_id) REFERENCES independent_reviews(review_id)
);

CREATE INDEX independent_review_events_review
  ON independent_review_events(review_id, sequence);
