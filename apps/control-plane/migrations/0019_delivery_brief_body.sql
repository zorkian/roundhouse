-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE conversation_delivery_briefs ADD COLUMN body TEXT NOT NULL DEFAULT '';

UPDATE conversation_delivery_briefs
SET body =
  '## Outcome\n\n' || outcome ||
  CASE WHEN json_array_length(acceptance_criteria_json) > 0 THEN
    '\n\n## Acceptance criteria\n\n' ||
    (SELECT group_concat('- ' || value, char(10)) FROM json_each(acceptance_criteria_json))
  ELSE '' END ||
  CASE WHEN json_array_length(constraints_json) > 0 THEN
    '\n\n## Constraints\n\n' ||
    (SELECT group_concat('- ' || value, char(10)) FROM json_each(constraints_json))
  ELSE '' END ||
  CASE WHEN json_array_length(evidence_json) > 0 THEN
    '\n\n## Evidence and decisions\n\n' ||
    (SELECT group_concat('- ' || value, char(10)) FROM json_each(evidence_json))
  ELSE '' END ||
  CASE WHEN json_array_length(uncertainties_json) > 0 THEN
    '\n\n## Remaining uncertainties\n\n' ||
    (SELECT group_concat('- ' || value, char(10)) FROM json_each(uncertainties_json))
  ELSE '' END || '\n';
