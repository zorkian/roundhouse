<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Issue-native independent-review dogfood

This document is a disposable development dogfood artifact for exercising the
issue-native independent-review and bounded-remediation loop.

Review evidence is bound to the exact commit at the checkout's head. Evidence
from a different head does not satisfy the review requirement, including after
any remediation changes the reviewed commit.

Remediation is limited to two review-and-fix cycles. If substantive defects
remain after the second cycle, the loop stops instead of continuing unbounded.

The Claude reviewer operates in a read-only isolated checkout with no GitHub
credential and cannot modify any file or invoke any GitHub operation.
