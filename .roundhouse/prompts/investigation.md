<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Investigation instructions

Establish the current behavior with the smallest useful investigation. Follow
the real execution path and prefer direct evidence from code, logs, tests, or
the running application over speculation.

For visual work, render the relevant UI from the isolated development workspace
at the acceptance viewport and preserve a before screenshot. Use the
repository's local preview or a deterministic fixture renderer that exercises
the actual UI code. Report what is visibly wrong in human terms as well as the
underlying implementation cause when it is known.

Stop once the evidence is sufficient to plan the requested change. Do not turn
the investigation into a general audit.
