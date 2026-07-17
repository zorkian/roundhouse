<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Goal 1 clean-run evidence template

Copy this template for one clean Goal 1 issue run. Use UTC timestamps with
seconds and link the maintainer-visible evidence where available.

| Evidence field       | Record                                               |
| -------------------- | ---------------------------------------------------- |
| Issue number         | `<number>`                                           |
| Base commit          | `<full commit SHA>`                                  |
| Start time           | `<UTC timestamp>`                                    |
| Plan time            | `<UTC timestamp>`                                    |
| Pull request time    | `<UTC timestamp>`                                    |
| Review result        | `<completed UTC timestamp, outcome, URL>`            |
| CI result            | `<completed UTC timestamp, exact-head outcome, URL>` |
| Merge time           | `<completed UTC timestamp>`                          |
| Final recommendation | `<recommendation, timestamp, URL>`                   |
| Residual risk        | `<risk stated before merge>`                         |
| Human intervention   | `No / Yes: <action and reason>`                      |

A run with a manual retry, manual approval, manual CI dispatch, or manual merge
is diagnostic rather than clean Goal 1 evidence.
