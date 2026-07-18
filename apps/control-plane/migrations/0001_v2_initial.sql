-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE repositories (id TEXT PRIMARY KEY, github_id TEXT NOT NULL UNIQUE, profile_version TEXT NOT NULL, profile_json TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE work_items (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id), issue_number INTEGER NOT NULL, current_run_id TEXT, UNIQUE(repository_id, issue_number));
CREATE TABLE runs (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id), status TEXT NOT NULL, stage TEXT NOT NULL, revision INTEGER NOT NULL, lease_attempt_id TEXT, lease_revision INTEGER, lease_expires_at INTEGER, document_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE attempts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), run_revision INTEGER NOT NULL, kind TEXT NOT NULL, stage TEXT NOT NULL, role TEXT NOT NULL, state TEXT NOT NULL, deadline_at INTEGER NOT NULL, expected_head TEXT NOT NULL, accepted_head TEXT, result_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(run_id, run_revision));
CREATE TABLE approvals (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), run_revision INTEGER NOT NULL, purpose TEXT NOT NULL, actor TEXT NOT NULL, decision TEXT NOT NULL, bound_head TEXT, created_at INTEGER NOT NULL);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), attempt_id TEXT, kind TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE outbox (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL, payload_json TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER);
CREATE INDEX runs_expired_lease ON runs(lease_expires_at) WHERE lease_expires_at IS NOT NULL;
CREATE INDEX outbox_ready ON outbox(state, available_at);
