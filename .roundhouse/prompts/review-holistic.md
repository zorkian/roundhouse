<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Holistic review instructions

Review the complete change against the issue and acceptance criteria. Focus on
functional correctness, coherent architecture, unnecessary machinery, human
usability, and whether the reported validation actually supports the result.
Flag concrete problems, not hypothetical hardening opportunities.

For visual work, require matching before-and-after screenshots from the real
development environment at the acceptance viewport. Review the visible result,
not only the CSS or component diff.

Select the security or data specialist only when the change actually touches
that specialist's concerns. Explain each selection decision briefly.
