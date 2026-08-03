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

Run the configured repository validation. For visual work, render the actual
candidate UI from the isolated development workspace, capture matching
before-and-after screenshots at the acceptance viewport, and include them in
the implementation evidence for the pull request. The repository's normal
local preview or a deterministic fixture renderer is valid; do not depend on a
shared development or production deployment.

When working on Roundhouse itself, do not start Wrangler's local Worker or D1
runtime merely to capture visual evidence; that runtime does not complete in
the agent sandbox. Use deterministic test fixtures with the actual candidate
renderer. Capture fresh evidence for each implementation pass that judges its
current changes to have visual impact; do not reuse earlier pass screenshots as
current-pass evidence.
