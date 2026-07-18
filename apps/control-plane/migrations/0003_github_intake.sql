-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE events ADD COLUMN delivery_id TEXT;
CREATE UNIQUE INDEX events_github_delivery ON events(delivery_id) WHERE delivery_id IS NOT NULL;
ALTER TABLE attempts ADD COLUMN model_calls INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attempts ADD COLUMN routing_json TEXT;
