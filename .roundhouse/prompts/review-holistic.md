<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Holistic review instructions

Review the complete change against the issue and acceptance criteria. Focus on
functional correctness, coherent architecture, unnecessary machinery, human
usability, and whether the reported validation actually supports the result.
Flag concrete problems, not hypothetical hardening opportunities.

For visual work, require matching before-and-after screenshots rendered from
the isolated development workspace at the acceptance viewport. Accept a
repository-local preview or deterministic fixture renderer when it exercises
the actual candidate UI. Do not require a shared deployment, authentication,
or backing-service integration as a prerequisite for visual evidence; validate
those behaviors separately. Review the visible result, not only the CSS or
component diff.

Select the security or data specialist only when the change actually touches
that specialist's concerns. Explain each selection decision briefly.
