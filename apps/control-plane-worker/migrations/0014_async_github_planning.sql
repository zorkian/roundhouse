-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS github_planning_jobs (
  job_id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  roundhouse_environment TEXT NOT NULL CHECK (roundhouse_environment IN ('development', 'production')),
  repository_full_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  command_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'retrying', 'completed', 'failed', 'timed_out')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claim_id TEXT,
  claim_expires_at TEXT,
  result_json TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS github_planning_jobs_status
  ON github_planning_jobs(status, updated_at);

CREATE TABLE IF NOT EXISTS github_planning_job_events (
  event_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE(job_id, sequence)
);

CREATE INDEX IF NOT EXISTS github_planning_job_events_job
  ON github_planning_job_events(job_id, sequence);
