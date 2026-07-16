<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Goal 1 clean-run checklist

Use this operator checklist to keep diagnostic or repair runs separate from the
final clean acceptance evidence. It does not add or change product requirements.

- [ ] Deploy the candidate commit to development and record its full SHA.
- [ ] Start three distinct, eligible low-risk issues from that same candidate
      commit.
- [ ] Include at least one reproduced bug with a passing regression and at least
      one maintenance change.
- [ ] For each issue, allow no operator retry, approval, or other intervention
      between start and confirmed merge.
- [ ] Confirm repository CI passes for each exact pull-request head.
- [ ] Confirm each exact pull-request head receives independent review before
      merge.
- [ ] Record final merge evidence for every run, including the merge commit and
      closed pull request.
- [ ] Exclude any repaired, retried, or otherwise diagnostic run from the clean
      three-run acceptance set.

Capture the detailed record in the
[Goal 1 live acceptance evidence](goal1-live-acceptance.md).
