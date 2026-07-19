-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

PRAGMA defer_foreign_keys=ON;
CREATE TABLE attempts_next (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), run_revision INTEGER NOT NULL, kind TEXT NOT NULL, stage TEXT NOT NULL, role TEXT NOT NULL, state TEXT NOT NULL, deadline_at INTEGER NOT NULL, expected_head TEXT NOT NULL, accepted_head TEXT, result_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, base_commit TEXT NOT NULL DEFAULT '', routing_json TEXT, model_calls INTEGER NOT NULL DEFAULT 0, UNIQUE(run_id, run_revision, role));
INSERT INTO attempts_next SELECT id,run_id,run_revision,kind,stage,role,state,deadline_at,expected_head,accepted_head,result_json,created_at,updated_at,base_commit,routing_json,model_calls FROM attempts;
DROP TABLE attempts;
ALTER TABLE attempts_next RENAME TO attempts;
PRAGMA defer_foreign_keys=OFF;
