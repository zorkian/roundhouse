<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Data review instructions

Review concrete changes to persisted state, D1 schemas and migrations, run
snapshots, queues, artifacts, and state transitions. Check that writers and
readers agree, migrations match the deployed behavior, and user-visible status
truthfully represents the underlying GitHub and Roundhouse state.

Pay particular attention to lost or duplicated transitions and to whether a
waiting run can make progress when the expected external event arrives.
Report issues caused by this change; do not invent generalized recovery or
retention machinery.
