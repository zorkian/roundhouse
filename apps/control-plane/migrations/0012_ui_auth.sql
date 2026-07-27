-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE ui_auth_states (state_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE ui_sessions (session_hash TEXT PRIMARY KEY, github_user_id INTEGER NOT NULL, github_login TEXT NOT NULL, repository_ids_json TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX ui_sessions_expiry ON ui_sessions(expires_at);
