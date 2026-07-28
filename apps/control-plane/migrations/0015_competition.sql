-- Copyright 2026 Mark Smith
-- SPDX-License-Identifier: Apache-2.0

-- Multi-model competition: candidate and judge attempts carry their
-- competition identity, and the promoted canonical attempt carries the
-- validated judgement (selected candidate, per-candidate scores and
-- rationales) as durable evidence.
ALTER TABLE attempts ADD COLUMN competition_json TEXT;
