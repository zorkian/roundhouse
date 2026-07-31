-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

-- Sliding session renewal must not extend the cached repository
-- authorization snapshot forever: keep the GitHub access token so a stale
-- snapshot can be re-resolved against GitHub, and record when the snapshot
-- was last resolved.
ALTER TABLE ui_sessions ADD COLUMN github_access_token TEXT;
ALTER TABLE ui_sessions ADD COLUMN authorized_at INTEGER;
