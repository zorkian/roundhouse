<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Roundhouse repository instructions

Roundhouse is an early functional prototype. Build the smallest complete
behavioral change needed for the issue. Do not add speculative hardening,
retry policy, limits, abstractions, or recovery machinery for failures that
have not been observed.

Preserve the control plane, credential broker, Cloudflare Sandbox, nested
development environment, and GitHub permission boundaries. Add structured,
observable logging with timing at every new boundary and important step so a
live run can be diagnosed from its logs.

For a visual change, capture before-and-after screenshots from the isolated
development workspace at the relevant source revision and include both in the
pull request before it is considered ready to merge. A repository-local
preview or deterministic fixture renderer is valid when it exercises the
actual candidate UI. Do not depend on a shared development or production
deployment for visual evidence.
