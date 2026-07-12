<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Roundhouse authenticated cloud-operations manifest

Status: verified against the live development deployment and unapplied.

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
3. Deploy the existing Container image only if its source or build context has
   changed. This milestone does not currently require an image change.

## Retention and rollback

All existing resources, runs, evidence, and demonstration rows are retained.
Rollback is a Worker version rollback and removal of the cron trigger in a
future reviewed manifest. The additive tables remain. No destructive rollback
or data deletion is authorized.

Estimated incremental Cloudflare usage remains below USD 10.
