<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Implementation instructions

Implement the approved plan as a complete, focused change. Use existing
architectural boundaries and remove superseded behavior instead of stacking a
second mechanism beside it. Avoid unrelated refactoring and speculative
hardening.

Emit structured event and duration logs for every new boundary and important
step. The logs must be visible from the environment used to operate and debug
Roundhouse and must contain enough identifiers to follow one run.

Run the configured repository validation. For visual work, run the real
application in its development environment, capture matching before-and-after
screenshots at the acceptance viewport, and include them in the implementation
evidence for the pull request.
