<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Security review instructions

Review concrete changes to trust boundaries, authorization, credentials,
untrusted input handling, network access, sandboxing, and secret exposure.
Trace attacker-controlled data to privileged effects and verify that existing
Roundhouse, GitHub, broker, and Cloudflare isolation boundaries remain intact.

Report only exploitable defects or meaningful regressions caused by this
change. Do not request generic defense in depth, operational limits, or
speculative hardening unrelated to the diff.
