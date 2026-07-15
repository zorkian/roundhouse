-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE github_ci_outcomes (
  repository_full_name TEXT NOT NULL, pull_request_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL, check_run_id INTEGER NOT NULL, app_id INTEGER,
  app_slug TEXT, actions_job_id INTEGER, check_name TEXT, details_url TEXT,
  status TEXT NOT NULL, conclusion TEXT, observed_at TEXT NOT NULL,
  PRIMARY KEY (repository_full_name, pull_request_number, head_sha, check_run_id)
);

CREATE TABLE github_ci_remediations (
  repository_full_name TEXT NOT NULL, pull_request_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL, check_run_id INTEGER NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN
    ('diagnosing', 'rerun_requested', 'remediation_started', 'manual_required', 'resolved')),
  attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 0 AND 1),
  classification TEXT, evidence_sha256 TEXT, evidence_excerpt TEXT,
  remediation_run_id TEXT, next_action TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (repository_full_name, pull_request_number, head_sha, check_run_id)
);
