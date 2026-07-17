<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Goal 1 evidence log

This log is for dogfood evidence capture only. It does not redefine the V1
acceptance criteria in the
[V1 maintainer acceptance checklist](../v1-maintainer-acceptance.md).

Candidate development commit:
`ec365b4bb43dec2bd838d1e6218b2c65bd11321f`

This table records the clean Goal 1 batch. It does not mark Goal 1 as accepted;
the explicit maintainer experience-acceptance check remains open.

| Issue and run                                                                                            | Pull request and exact head                                                                        | Scenario       | Start / PR / merge                      | Result                                                                                   |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| [#219](https://github.com/zorkian/roundhouse/issues/219), `run_d915952a461c5ae3da9e4e64aff7d83a8197380e` | [#222](https://github.com/zorkian/roundhouse/pull/222), `4a07e6483432f2014af446f958ef4433e3cb1072` | Reproduced bug | `03:43:30Z` / `03:58:00Z` / `03:59:16Z` | Review and CI passed; automatically merged as `8a0c53e7ee7b82116f7954bcfc329186ed1ef279` |
| [#221](https://github.com/zorkian/roundhouse/issues/221), `run_f86ab2519ea337451904d44621a2c6628bad827e` | [#223](https://github.com/zorkian/roundhouse/pull/223), `b10292fcc1ed6d0bdba29143b4aac538f86bf4bf` | Maintenance    | `03:47:10Z` / `03:58:53Z` / `04:00:12Z` | Review and CI passed; automatically merged as `616cfe81596a8ceec03173d4c80fb22f634913b3` |
| [#220](https://github.com/zorkian/roundhouse/issues/220), `run_2fc9e1f7102ac5a646cccc46183434f21f4903db` | [#224](https://github.com/zorkian/roundhouse/pull/224), `e248dc4c1cf4864a51ba23e4f6878f1bfb916419` | Maintenance    | `03:47:12Z` / `04:00:22Z` / `04:01:36Z` | Review and CI passed; automatically merged as `276b86f0670f145fda80ed9729acaafb3f7481c7` |

All timestamps are on `2026-07-17`. Each run had one implementation attempt,
one validation, one CI run, one independent-review cycle, and zero human
interventions after start. The merge order was #222, #223, then #224; no
unrelated pull request merged within the sequence. Full timing, recommendation,
attempt, and reproduction evidence is in the
[Goal 1 live acceptance evidence](goal1-live-acceptance.md).
