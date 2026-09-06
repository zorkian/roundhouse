-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

-- Keep the requested route, broker resolution, and provider response separate.
-- Existing rows remain null: a later route or deployment config cannot tell us
-- what an earlier provider actually used.
ALTER TABLE model_usage ADD COLUMN requested_model TEXT;
ALTER TABLE model_usage ADD COLUMN resolved_model TEXT;
ALTER TABLE model_usage ADD COLUMN provider_reported_model TEXT;
ALTER TABLE model_usage ADD COLUMN provider_reported_effort TEXT;
ALTER TABLE model_usage ADD COLUMN outcome TEXT CHECK (outcome IN ('succeeded', 'failed'));

ALTER TABLE conversation_model_usage ADD COLUMN requested_model TEXT;
ALTER TABLE conversation_model_usage ADD COLUMN resolved_model TEXT;
ALTER TABLE conversation_model_usage ADD COLUMN provider_reported_model TEXT;
ALTER TABLE conversation_model_usage ADD COLUMN provider_reported_effort TEXT;
