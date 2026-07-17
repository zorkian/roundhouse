<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Goal 1 representative-journey checklist

Use this operator checklist to distinguish autonomous product evidence from
journeys that needed manual rescue. It does not add or change product
requirements.

- [ ] Record the full development release SHA active for each journey.
- [ ] Start three distinct, eligible low-risk issues.
- [ ] Include at least one reproduced bug with a passing regression and at least
      one maintenance change.
- [ ] For each issue, allow no operator retry, approval, or other intervention
      between start and confirmed merge. Record bounded automatic recovery,
      including cost and delay.
- [ ] Confirm repository CI passes for each exact pull-request head.
- [ ] Confirm each exact pull-request head receives independent review before
      merge.
- [ ] Record final merge evidence for every run, including the merge commit and
      closed pull request.
- [ ] Confirm no automatic recovery duplicates paid agent work, publication,
      review, CI repair, or merge.
- [ ] Exclude any manually rescued journey from the three-run acceptance set.

Capture the detailed record in the
[Goal 1 live acceptance evidence](goal1-live-acceptance.md).
