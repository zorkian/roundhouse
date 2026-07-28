-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE runs ADD COLUMN lease_workflow_instance_id TEXT;
ALTER TABLE runs ADD COLUMN lease_acquisition_id TEXT;

UPDATE runs
SET lease_workflow_instance_id=lease_attempt_id
WHERE lease_attempt_id IS NOT NULL;
