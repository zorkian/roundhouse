-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

UPDATE model_usage
SET model =
  CASE
    WHEN provider IS NOT NULL AND trim(provider) <> '' THEN trim(provider) || '/' || model
    WHEN configured_model IS NOT NULL AND instr(configured_model, '/') > 1 THEN
      substr(configured_model, 1, instr(configured_model, '/') - 1) || '/' || model
    ELSE model
  END
WHERE instr(model, '/') = 0;

UPDATE conversation_model_usage
SET model =
  CASE
    WHEN provider IS NOT NULL AND trim(provider) <> '' THEN trim(provider) || '/' || model
    WHEN configured_model IS NOT NULL AND instr(configured_model, '/') > 1 THEN
      substr(configured_model, 1, instr(configured_model, '/') - 1) || '/' || model
    ELSE model
  END
WHERE instr(model, '/') = 0;
