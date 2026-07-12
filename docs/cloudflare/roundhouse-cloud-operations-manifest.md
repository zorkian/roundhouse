<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Roundhouse authenticated cloud-operations manifest

Status: applied 2026-07-12.

Verified 2026-07-12 against Worker version
`210ea8b2-8ae7-46ae-b018-72e3e9089f5d`: the only pending migration is
`0004_cloud_operations.sql`, and the only Worker secret name is the retained
`ROUNDHOUSE_CODEX_AUTH_JSON`.

This manifest is the exact mutation boundary authorized for the authenticated
cloud-operations milestone.

## Existing resources retained

- Worker: `roundhouse-dev-control-plane`
- D1: `roundhouse-dev-coordination`
- Queue producer/consumer: `roundhouse-dev-runs`
- Dead-letter Queue: `roundhouse-dev-runs-dlq`
- R2: `roundhouse-dev-evidence`
- Container application: existing `RoundhouseExecutionContainer`
- Container image name: `roundhouse-dev-execution`
- Access-protected development hostname and current Access application
- Secret name: existing `ROUNDHOUSE_CODEX_AUTH_JSON`

No resource identifier, hostname, DNS record, Access policy, secret, route, or
billing setting changes.

## Additive mutations

1. Apply D1 migration `0004_cloud_operations.sql` to the existing database.
   It creates `operator_mutations`, `operational_alerts`, and
   `recovery_cycles`, plus non-destructive indexes.
2. Deploy the existing Worker with the repository configuration and one cron
   trigger: `*/5 * * * *`.
3. Wrangler may mechanically rebuild the existing Container image from its
   unchanged source while deploying the owning Worker. No Container source,
   name, class, instance type, maximum instance count, or rollout policy changes.

## Retention and rollback

All existing resources, runs, evidence, and demonstration rows are retained.
Rollback is a Worker version rollback and removal of the cron trigger in a
future reviewed manifest. The additive tables remain. No destructive rollback
or data deletion is authorized.

Estimated incremental Cloudflare usage remains below USD 10.

Initial Worker version: `fe09e61b-10c9-458e-8d95-e1c8ccc55410`.
Final reviewed Worker version: `9a8c732f-430c-47d8-9857-a22d42cda6d0`.
Applied Container image digest:
`sha256:6b2e052e1f8beaca517bbf4bd4b3da08e893ab2aa3b8eff0510c09a021b87e58`.
Migration `0004_cloud_operations.sql` is recorded as applied and the cron trigger
is active at `*/5 * * * *`.
