-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE attempts ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE attempts ADD COLUMN outcome_json TEXT;
