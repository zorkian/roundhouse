-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE runs ADD COLUMN current_node_id TEXT;
ALTER TABLE runs ADD COLUMN workflow_hash TEXT;
ALTER TABLE attempts ADD COLUMN node_id TEXT;
ALTER TABLE attempts ADD COLUMN executor TEXT;

CREATE INDEX attempts_by_node
ON attempts(run_id, node_id, run_revision);
