<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Planning instructions

Plan the smallest end-to-end change that satisfies the acceptance criteria.
Name the existing boundaries and abstractions the change should use. If a new
boundary or important step is unavoidable, include the structured event and
timing logs needed to observe it during a live run.

Do not add speculative limits, retries, recovery machinery, compatibility
layers, or abstractions. Do not broaden the issue into adjacent cleanup.

For visual work, include how the candidate UI will be rendered from the
isolated development workspace and how matching before-and-after screenshots
will be captured at the acceptance viewport. Do not require access to a shared
development or production deployment.
