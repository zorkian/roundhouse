-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

UPDATE github_automatic_merges
SET
  status = 'pending',
  claim_id = NULL,
  claim_expires_at = NULL,
  next_action = 'No action needed; Roundhouse will retry the exact-head merge after reconciling target-branch base advancement.',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'blocked'
  AND failure_code = 'stale_base'
  AND merge_commit_sha IS NULL
  -- Blocked rows should not normally retain a live claim. If one does, leave
  -- it for normal claim-expiry recovery instead of clobbering the claimant.
  AND (
    claim_expires_at IS NULL OR
    claim_expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
