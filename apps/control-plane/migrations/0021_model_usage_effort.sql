-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

-- Nullable metadata keeps usage rows written before effort observability readable.
ALTER TABLE model_usage ADD COLUMN requested_effort TEXT;
ALTER TABLE model_usage ADD COLUMN resolved_effort TEXT;
ALTER TABLE model_usage ADD COLUMN latency_ms INTEGER;
ALTER TABLE model_usage ADD COLUMN tool_call_count INTEGER;

ALTER TABLE conversation_model_usage ADD COLUMN requested_effort TEXT;
ALTER TABLE conversation_model_usage ADD COLUMN resolved_effort TEXT;
ALTER TABLE conversation_model_usage ADD COLUMN tool_call_count INTEGER;
