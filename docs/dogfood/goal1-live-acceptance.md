<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Goal 1 live acceptance evidence

This document records three representative live journeys for Goal 1. The
normative requirements remain in the
[V1 maintainer acceptance checklist](../v1-maintainer-acceptance.md); this file
only provides a compact evidence record and does not alter those requirements.

## Prerequisites

- Record the exact development release commit active when each Goal 1 start is
  issued.
- Use the Roundhouse development App (`/rhd` or `/roundhouse-dev`) and
  development resources for an enrolled repository with its reviewed
  administrator profile configured to permit low-risk automatic merge.
- Confirm the repository profile supplies the required formatting, validation,
  and test commands, and that repository CI and independent review are enabled.
- Select three distinct, clear, eligible, low-risk issues. At least one journey
  must be a reproduced bug with a passing post-change regression, and at least
  one must be a small maintenance or formatting change. Repeat either scenario
  type for the third journey.
- After each start, no human acts until Roundhouse confirms the merge.
- A bounded automatic retry or recovery remains valid evidence when the
  journey meets its latency and cost targets and produces neither duplicate
  paid work nor duplicate publication.

## Evidence record

Use UTC timestamps with seconds and link the maintainer-visible evidence. Keep
excluded GitHub-hosted runner queue time visible rather than subtracting it
silently. Record `0` when there were no human interventions.

Runs that require manual retry, manual approval, manual CI dispatch, or manual
merge are useful diagnostic evidence, but they are not Goal 1 acceptance
evidence. Automatic bounded recovery is recorded rather than excluded.

Goal 1 product acceptance evidence ends when the pull request is merged and the
originating issue is closed. Development deployment evidence may be recorded
separately for Roundhouse's own engineering workflow, but it is not part of the
Roundhouse product acceptance journey.

All three journeys started from development candidate
`ec365b4bb43dec2bd838d1e6218b2c65bd11321f`.

| Evidence field                                   | Journey 1                                                                                                                                | Journey 2                                                                                                                                | Journey 3                                                                                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Scenario type                                    | Reproduced bug                                                                                                                           | Maintenance                                                                                                                              | Maintenance                                                                                                                              |
| Issue                                            | [#219](https://github.com/zorkian/roundhouse/issues/219)                                                                                 | [#221](https://github.com/zorkian/roundhouse/issues/221)                                                                                 | [#220](https://github.com/zorkian/roundhouse/issues/220)                                                                                 |
| Run                                              | `run_d915952a461c5ae3da9e4e64aff7d83a8197380e`                                                                                           | `run_f86ab2519ea337451904d44621a2c6628bad827e`                                                                                           | `run_2fc9e1f7102ac5a646cccc46183434f21f4903db`                                                                                           |
| Start                                            | `2026-07-17T03:43:30Z`                                                                                                                   | `2026-07-17T03:47:10Z`                                                                                                                   | `2026-07-17T03:47:12Z`                                                                                                                   |
| Durable acknowledgement and current-stage status | `2026-07-17T03:43:34Z` (4s)                                                                                                              | `2026-07-17T03:47:15Z` (5s)                                                                                                              | `2026-07-17T03:47:15Z` (3s)                                                                                                              |
| Materialized plan                                | `2026-07-17T03:43:38Z` (8s)                                                                                                              | `2026-07-17T03:47:18Z` (8s)                                                                                                              | `2026-07-17T03:47:25Z` (13s)                                                                                                             |
| Pull request                                     | [#222](https://github.com/zorkian/roundhouse/pull/222), `2026-07-17T03:58:00Z` (14m30s), head `4a07e6483432f2014af446f958ef4433e3cb1072` | [#223](https://github.com/zorkian/roundhouse/pull/223), `2026-07-17T03:58:53Z` (11m43s), head `b10292fcc1ed6d0bdba29143b4aac538f86bf4bf` | [#224](https://github.com/zorkian/roundhouse/pull/224), `2026-07-17T04:00:22Z` (13m10s), head `e248dc4c1cf4864a51ba23e4f6878f1bfb916419` |
| Independent review                               | Passed with no substantive findings at `2026-07-17T03:58:49Z`                                                                            | Passed with no substantive findings at `2026-07-17T04:00:01Z`                                                                            | Passed with no substantive findings at `2026-07-17T04:01:15Z`                                                                            |
| Exact-head CI                                    | Passed at `2026-07-17T03:59:08Z`                                                                                                         | Passed at `2026-07-17T04:00:04Z`                                                                                                         | Passed at `2026-07-17T04:01:27Z`                                                                                                         |
| Pre-merge package                                | Low risk; stated exact-head evidence, blast radius, rollback, and residual risk; `Recommendation: Merge automatically`                   | Low risk; stated exact-head evidence, blast radius, rollback, and residual risk; `Recommendation: Merge automatically`                   | Low risk; stated exact-head evidence, blast radius, rollback, and residual risk; `Recommendation: Merge automatically`                   |
| Merge                                            | Automatic at `2026-07-17T03:59:16Z` (15m46s), `8a0c53e7ee7b82116f7954bcfc329186ed1ef279`; closed outcome recorded                        | Automatic at `2026-07-17T04:00:12Z` (13m02s), `616cfe81596a8ceec03173d4c80fb22f634913b3`; closed outcome recorded                        | Automatic at `2026-07-17T04:01:36Z` (14m24s), `276b86f0670f145fda80ed9729acaafb3f7481c7`; closed outcome recorded                        |
| Attempts and cycles                              | 1 implementation, 1 validation, 1 CI run, 1 review cycle                                                                                 | 1 implementation, 1 validation, 1 CI run, 1 review cycle                                                                                 | 1 implementation, 1 validation, 1 CI run, 1 review cycle                                                                                 |
| Recovery and duplicate work                      | None; no duplicate work                                                                                                                  | None; no duplicate work                                                                                                                  | None; no duplicate work                                                                                                                  |
| Human interventions after start                  | 0                                                                                                                                        | 0                                                                                                                                        | 0                                                                                                                                        |

For Journey 1, the pre-change reproduction on the candidate collected one test
and failed the intended behavioral assertion: `+` bullets returned `[]`. The
post-change command
`corepack pnpm exec vitest run --config packages/self-development/reproductions/vitest.config.ts`
collected and passed one test on final `main` at
`276b86f0670f145fda80ed9729acaafb3f7481c7`.

## Batch integrity and timing

All starts preceded the first candidate pull-request merge, every materialized
plan used the candidate above, and the three changed-path sets were pairwise
disjoint. GitHub merge search from `2026-07-17T03:58:00Z` through
`2026-07-17T04:02:00Z` returned only #222, #223, and #224, in that order. No
unrelated pull request merged inside this clean sequence.

Maintainer-visible issue status linked a live page refreshing every five
seconds during active work, and no additional action was requested. The raw
end-to-end durations above include all GitHub-hosted runner queue time and meet
every Goal 1 speed target; no queue-time exclusion is needed.

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

## Timing calculations

Use the maintainer-visible GitHub timestamp of the initial start comment as
`start`. Use the first durable, maintainer-visible GitHub acknowledgement as
`ack`, and the first status that identifies the current stage or reports useful
progress as `status`. Calculate acknowledgement as `ack - start` and first
useful status as `status - start`.

Use the timestamp of the first maintainer-visible plan as `plan`, the draft pull
request's creation timestamp as `draft`, and the successful merge timestamp as
`merge`. Calculate the three end-to-end durations as `plan - start`,
`draft - start`, and `merge - start`; do not reset the clock at an intermediate
event.

Record each interval spent waiting in an unrelated GitHub-hosted runner queue,
including its visible start, end, workflow URL, and duration. Report the raw
draft-pull-request and merge durations first. When applying a target that
excludes that queue time, also report the adjusted duration as
`raw duration - documented unrelated queue duration`; never alter or omit the
raw duration. Do not exclude Roundhouse work, its own retry delays, or other
waiting time.

For the active-work silence check, order every maintainer-visible progress
timestamp from `start` through `merge` and calculate each consecutive
difference. While Roundhouse is actively working, every interval must be at or
below two minutes. A status must identify the current stage or provide live
progress to end a silence interval; internal activity does not count.

## Pass/fail checks

- [x] Three representative live clear low-risk issues reach a supported final
      recommendation and merge successfully; any bounded automatic recovery
      meets the latency and cost targets without duplicate paid or published
      work.
- [x] At least one is a reproduced bug with a passing post-change regression
      and at least one is a small maintenance change.
- [x] No human acts between the initial start and confirmed merge.
- [x] Start, progress, plan, pull-request, review, and recommendation timing
      meet the speed targets.
- [x] Each exact pull-request head passes repository CI and independent review
      before automatic merge.
- [x] The final package states residual risk and the automatic-merge
      recommendation before merge, then reports the merge commit and closed pull
      request.
- [x] No severity-1 or severity-2 Goal 1 defect remains.
- [ ] A maintainer reviews the three journeys and explicitly accepts that this
      basic delegation loop feels fast, clear, and worth using.

The technically proven checks are complete. The explicit maintainer experience
check remains open: this evidence does not claim that human product acceptance
has occurred. Final development release verification, if recorded separately,
is engineering evidence outside Goal 1 product acceptance.
