-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE ui_auth_states ADD COLUMN state_cookie_hash TEXT NOT NULL DEFAULT '';
