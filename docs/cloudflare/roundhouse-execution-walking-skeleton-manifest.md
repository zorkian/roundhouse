<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Cloudflare execution walking-skeleton manifest

Status: **preauthorized, verified, and applied 2026-07-12**

This manifest is bounded by the maintainer's explicit authorization for the
Cloudflare execution walking-skeleton milestone. Everything not listed here is
out of scope.

## Existing resources retained and updated

| Resource                       | Authorized change                                          |
| ------------------------------ | ---------------------------------------------------------- |
| `roundhouse-dev-control-plane` | deploy the Container-backed execution adapter              |
| `roundhouse-dev-coordination`  | apply additive migration `0002_execution_evidence.sql`     |
| `roundhouse-dev-runs`          | continue existing producer and single-message consumer use |

The existing hostname, DNS, Access application and policy, certificate, D1
identity, primary Queue, and dead-letter Queue are not created, deleted, or
otherwise administered by this milestone.

## New retained resources

| Resource                 | Exact configuration                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------- |
| R2                       | bucket `roundhouse-dev-evidence`                                                    |
| Container image          | `roundhouse-dev-execution`, built for `linux/amd64` from the checked-in Dockerfile  |
| Container Durable Object | class `RoundhouseExecutionContainer`, SQLite migration tag `execution-container-v1` |
| Container capacity       | `standard-1`, `max_instances: 1`, immediate 100% development rollout                |

Applied identities:

- Container application `a030958f-41f0-4ae6-9a68-a33d0876ea72`;
- Container Durable Object namespace `bb8e22de4a1a4125a7e344ebbd5cc6df`;
- retained image digest
  `sha256:5603ea8df02d20de809b7e46d21fc369a5ea7aa90a7b92fe78ce1e5578e259ad`;
- final Worker version `411a4119-de5c-45c6-a263-b8beea9e0a05`.

The image uses the digest-pinned `node:24.4.1-bookworm-slim` base, bakes pnpm
`10.13.1` at build time, runs as UID 10001, and accepts no mounted secret or
ambient credential.

## Execution boundary

1. Access-authenticated submission and D1/Queue claiming remain in the existing
   control-plane Worker.
2. A deterministic Durable Object name binds one Container to one run attempt.
3. The Container accepts only the exact public Roundhouse repository URL, a
   forty-character commit, profile `roundhouse.v1`, and command `license`.
4. Internet access defaults to disabled. During checkout only `github.com` is
   allowed through an audited outbound handler.
5. The Worker removes the outbound handler and allowed host before executing
   the fixed profile command. Both HTTPS to an unapproved host and non-HTTP TCP
   are required to fail before validation starts.
6. The Container runs `pnpm license:check` without installing dependencies,
   records the exact checkout, bounded output, timing, changed-file inventory,
   disk and memory observations, and then stops.
7. The Worker conditionally creates one immutable JSON object per attempt in
   R2. D1 records its object key, SHA-256, size, media type, attempt, and time.
8. Replay returns already-durable evidence instead of re-executing the attempt.

The bounded demonstration-only scenarios `nonzero`, `timeout`, and
`interrupt-once` are selected only through reviewed Worker configuration. They
do not accept a submitted command. The final retained configuration is
`success`.

## Mutation order

1. Repeat exact-name inventory and abort if a new resource collides.
2. Create R2 bucket `roundhouse-dev-evidence`.
3. Apply additive D1 migration `0002_execution_evidence.sql` remotely.
4. Run a Wrangler deployment dry-run and verify this manifest against the
   resulting bindings.
5. Deploy `roundhouse-dev-control-plane`; Wrangler builds and publishes the
   development image and creates the named SQLite Durable Object class.
6. Verify existing Access protection, hostname, D1, Queue, new R2 binding,
   Container binding, capacity, and deny-by-default execution configuration.
7. Run at most four demonstrations: success, nonzero exit, timeout, and one
   interruption followed by recovery. Restore `EXECUTION_SCENARIO=success`.
8. Redeploy once and confirm prior D1/R2 evidence remains inspectable.

No more than one Container may be active. Demonstration commands have a
two-minute upper bound, output is limited to 256 KiB per stream, and total
incremental Cloudflare cost must remain below the authorized USD 5 ceiling.

## Retention and rollback

Development resources and demonstration evidence are retained. Rollback is
documented but not executed:

1. Redeploy the prior control-plane version, removing Container and R2 bindings
   from active code before deleting anything.
2. Delete the exact `roundhouse-dev-execution` Container application/image only
   with fresh destructive approval.
3. Delete the exact `RoundhouseExecutionContainer` namespace only if Cloudflare
   supports safe class deletion and no retained instance state is required.
4. Delete `roundhouse-dev-evidence` only with explicit evidence-deletion
   approval.
5. The additive D1 table and retained rows are not automatically rolled back.

Never select a rollback target by partial name. No rollback action, evidence
deletion, existing-resource deletion, billing change, or resource outside this
manifest is authorized.
