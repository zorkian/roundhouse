-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE attempts ADD COLUMN base_commit TEXT NOT NULL DEFAULT '';
