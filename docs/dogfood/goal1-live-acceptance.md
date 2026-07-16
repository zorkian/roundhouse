<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Goal 1 live acceptance evidence

Use this runbook to record the three consecutive live journeys for Goal 1. The
normative requirements remain in the
[V1 maintainer acceptance checklist](../v1-maintainer-acceptance.md); this file
only provides a compact evidence record.

## Prerequisites

- Record the exact development candidate commit active when the three Goal 1
  starts are issued: `<full commit SHA>`.
- Use the Roundhouse development App (`/rhd` or `/roundhouse-dev`) and
  development resources for an enrolled repository with its reviewed
  administrator profile configured to permit low-risk automatic merge.
- Confirm the repository profile supplies the required formatting, validation,
  and test commands, and that repository CI and independent review are enabled.
- Select three distinct, clear, eligible, low-risk issues. At least one journey
  must be a reproduced bug with a passing post-change regression, and at least
  one must be a small maintenance or formatting change. Repeat either scenario
  type for the third journey.
- Run all three starts against the same candidate commit. After each start, no
  human acts until Roundhouse confirms the merge.
- Record subsequent merges during the three-run sequence separately as each
  journey's merge commit; they do not change the candidate commit for that
  evidence batch.

## Evidence record

Use UTC timestamps with seconds and link the maintainer-visible evidence. Keep
excluded GitHub-hosted runner queue time visible rather than subtracting it
silently. Record `0` when there were no human interventions.

Goal 1 product acceptance evidence ends when the pull request is merged and the
originating issue is closed. Development deployment evidence may be recorded
separately for Roundhouse's own engineering workflow, but it is not part of the
Roundhouse product acceptance journey.

| Evidence field      | Journey 1                                                             | Journey 2                                                             | Journey 3                                                             |
| ------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Scenario type       | Reproduced bug / maintenance                                          | Reproduced bug / maintenance                                          | Reproduced bug / maintenance                                          |
| Issue               | `<URL>`                                                               | `<URL>`                                                               | `<URL>`                                                               |
| Candidate commit    | `<SHA>`                                                               | `<same SHA>`                                                          | `<same SHA>`                                                          |
| Start               | `<timestamp, command evidence>`                                       | `<timestamp, command evidence>`                                       | `<timestamp, command evidence>`                                       |
| First status        | `<timestamp, URL>`                                                    | `<timestamp, URL>`                                                    | `<timestamp, URL>`                                                    |
| Plan                | `<timestamp, URL>`                                                    | `<timestamp, URL>`                                                    | `<timestamp, URL>`                                                    |
| Pull request        | `<timestamp, URL, exact head SHA>`                                    | `<timestamp, URL, exact head SHA>`                                    | `<timestamp, URL, exact head SHA>`                                    |
| Review              | `<completed timestamp, URL, outcome>`                                 | `<completed timestamp, URL, outcome>`                                 | `<completed timestamp, URL, outcome>`                                 |
| CI                  | `<completed timestamp, URL, exact-head outcome, excluded queue time>` | `<completed timestamp, URL, exact-head outcome, excluded queue time>` | `<completed timestamp, URL, exact-head outcome, excluded queue time>` |
| Recommendation      | `<timestamp, supported final recommendation, URL>`                    | `<timestamp, supported final recommendation, URL>`                    | `<timestamp, supported final recommendation, URL>`                    |
| Merge               | `<completed timestamp, merge SHA, closed PR URL>`                     | `<completed timestamp, merge SHA, closed PR URL>`                     | `<completed timestamp, merge SHA, closed PR URL>`                     |
| Attempts            | `<implementation / validation / CI counts>`                           | `<implementation / validation / CI counts>`                           | `<implementation / validation / CI counts>`                           |
| Review cycles       | `<count>`                                                             | `<count>`                                                             | `<count>`                                                             |
| Human interventions | `0 / <count and action>`                                              | `0 / <count and action>`                                              | `0 / <count and action>`                                              |
| Residual risk       | `<risk stated before merge>`                                          | `<risk stated before merge>`                                          | `<risk stated before merge>`                                          |

For a reproduced bug, attach the pre-change reproduction command, input,
expected and observed behavior, environment, repeatability, and confidence,
plus the post-change regression result tied to that reproduction.

## Goal 1 speed targets

| Measure                                                  | Target                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Durable acknowledgement of a start command               | p95 at or below 5 seconds                                                            |
| First useful GitHub status                               | p95 at or below 10 seconds                                                           |
| Qualification and initial plan for a clear issue         | p50 at or below 2 minutes; p95 at or below 5 minutes                                 |
| Clear low-risk issue to draft pull request               | p50 at or below 30 minutes; p95 at or below 60 minutes                               |
| Clear low-risk issue to successful merge                 | p50 at or below 45 minutes; p95 at or below 90 minutes                               |
| Silence while Roundhouse is actively working             | never more than 2 minutes without visible current-stage or live-progress information |
| Human interventions through merge, clear low-risk issues | zero                                                                                 |

End-to-end pull-request timing excludes time spent waiting in an unrelated
GitHub-hosted runner queue, but includes Roundhouse planning, execution,
validation, review, remediation, publication, and its own retry delays.
Excluded time must still be shown separately rather than disappearing from the
measurement.

## Pass/fail checks

- [ ] Three consecutive live clear low-risk issues at one candidate commit
      reach a supported final recommendation and merge successfully.
- [ ] At least one is a reproduced bug with a passing post-change regression
      and at least one is a small maintenance change.
- [ ] No human acts between the initial start and confirmed merge.
- [ ] Start, progress, plan, pull-request, review, and recommendation timing
      meet the speed targets.
- [ ] Each exact pull-request head passes repository CI and independent review
      before automatic merge.
- [ ] The final package states residual risk and the automatic-merge
      recommendation before merge, then reports the merge commit and closed pull
      request.
- [ ] No severity-1 or severity-2 Goal 1 defect remains.
- [ ] A maintainer reviews the three journeys and explicitly accepts that this
      basic delegation loop feels fast, clear, and worth using.

Mark the run failed if any check remains unchecked; link the affected criterion
to its defect rather than substituting unit, CI, schema, or internal-record
evidence for the end-to-end maintainer-visible journey.
