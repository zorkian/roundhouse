-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE work_items ADD COLUMN github_issue_state TEXT NOT NULL DEFAULT 'open' CHECK (github_issue_state IN ('open', 'closed'));

UPDATE work_items
SET github_issue_state = 'closed'
WHERE issue_number = 268
  AND repository_id = (SELECT id FROM repositories WHERE github_id = 'zorkian/roundhouse');
