-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE model_usage ADD COLUMN provider TEXT;
ALTER TABLE model_usage ADD COLUMN configured_model TEXT;
ALTER TABLE model_usage ADD COLUMN routing_rule TEXT;
