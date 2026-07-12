<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Cloudflare trusted self-development manifest

Status: **preauthorized, not yet applied**

This manifest records the exact development mutations authorized for the
cloud-hosted trusted self-development milestone. Any difference requires a new
approval before mutation.

## Existing resources updated

| Resource                       | Authorized change                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `roundhouse-dev-control-plane` | Deploy bounded Codex execution, approval, evidence, and publication coordination    |
| `roundhouse-dev-coordination`  | Apply one additive migration for approval and publication audit records             |
| `roundhouse-dev-runs`          | Continue the existing producer and single-message consumer configuration            |
| `roundhouse-dev-evidence`      | Retain immutable agent, patch, validation, approval, and publication evidence       |
| `roundhouse-dev-execution`     | Extend the existing `linux/amd64` image; retain `standard-1` and `max_instances: 1` |

The existing hostname, DNS, certificate, Access application and human policy,
D1 identity, Queue identities, R2 identity, Durable Object namespace, and
Container application identity remain unchanged.

## Development credential exception

Create exactly one encrypted Worker secret on `roundhouse-dev-control-plane`:

- binding: `ROUNDHOUSE_CODEX_AUTH_JSON`;
- source: the existing dedicated subscription-backed Codex credential;
- destination: only an owner-readable temporary `CODEX_HOME/auth.json` inside
  the deterministic execution Container;
- lifetime: one Container attempt;
- readers: the Worker supervisor and bounded Codex process for that attempt.

The secret is never printed, parsed by operational tooling, committed, baked
into an image, written to D1 or R2, included in logs/evidence, or retained after
Container teardown. No GitHub, Cloudflare, DNS, or other credential enters the
Container. This is a development exception and not the accepted production
credential boundary.

Codex model transport is limited to the measured, explicitly documented
official OpenAI HTTPS hosts required by the bounded dogfood run. Repository
checkout remains limited to audited HTTPS requests to `github.com`. Agent tool
network access is disabled, and validation begins only after all model and
checkout egress handlers are removed. The deployment stops if a broader
network boundary is required.

## Additive data changes

Migration `0003_trusted_self_development.sql` may create append-oriented tables
for exact approvals, publication attempts, and security audit events. It may
add indexes but may not alter or delete existing rows or tables.

## Execution and publication boundary

1. Access-authenticated submission records an exact public base commit,
   schema-validated instructions, allowed paths, validation level, and a
   predeclared publication target.
2. D1 and Queue grant one revision-bound attempt lease. Duplicate delivery is
   harmless.
3. One deterministic Container checks out the exact public commit with only
   audited GitHub HTTPS egress.
4. The Worker injects the dedicated Codex credential only for the bounded agent
   phase. Codex model transport uses only measured official OpenAI hosts. Agent
   tools cannot use the network.
5. The agent cannot approve, commit, push, administer Cloudflare, or access a
   GitHub credential. It may modify only the isolated checkout.
6. Roundhouse captures a bounded patch and changed-file inventory, rejects
   paths outside the submitted allowlist, then revokes model egress and removes
   the credential file before validation.
7. Fixed repository-profile commands perform diff-aware formatting, license,
   type, and test validation. Immutable evidence is conditionally written to
   R2 and hash-bound to D1.
8. Approval binds run ID, base commit, patch SHA-256, and the complete evidence
   set. Any mutation invalidates approval.
9. Publication is performed outside the coding agent. It reconstructs only the
   approved patch, verifies the expected GitHub repository and remote base,
   creates one commit, pushes one new branch, and may create one draft PR.

## Bounded dogfood

The delegated dogfood task may change exactly:

`docs/dogfood/trusted-self-development-loop.md`

Delegated approval identity:

`mark-smith-delegated-trusted-loop-dogfood`

The deployment variable `DELEGATED_ACTOR_ID` binds that delegated identity to
the approved Access actor `zorkian@fastmail.fm`; approval and publication both
require the same authenticated mapping.

Delegated approval is valid only after the patch exists and only when the path,
task content, Apache-2.0 header, exact base, patch SHA-256, evidence hashes, and
all validation results independently verify.

## Limits and retention

- At most one active Container and one active demonstration.
- Agent attempt timeout: 20 minutes.
- Validation timeout: 15 minutes.
- Patch limit: 512 KiB and 50 changed files.
- Event/log capture: 5 MiB, with bounded redacted inspection projections.
- Incremental Cloudflare spend ceiling: USD 10.
- Development resources, demonstration rows, immutable evidence, and the
  encrypted Worker secret are retained pending explicit later cleanup.

## Mutation order

1. Verify exact existing resource identities and absence of name collisions.
2. Run local contracts, security tests, licensing, formatting, typechecking,
   builds, and a credential-isolated local Container exercise.
3. Apply additive migration `0003_trusted_self_development.sql`.
4. Create encrypted secret `ROUNDHOUSE_CODEX_AUTH_JSON` without displaying its
   value.
5. Dry-run the Worker/Container deployment and compare bindings to this
   manifest.
6. Deploy the existing Worker and Container application.
7. Verify Access protection, D1, Queue, R2, Container capacity, secret absence
   from configuration output, and default-deny networking.
8. Run bounded success, denial, cancellation, interruption/recovery, tampering,
   approval, and dogfood publication demonstrations.
9. Leave the final configuration in its normal success mode with no active
   Container.

## Rollback

Rollback is documented but not executed. A future explicitly approved rollback
may deploy the prior Worker version and remove the secret binding. It may not
delete evidence, D1 rows, the R2 bucket, Queue, Container application, Durable
Object namespace, hostname, Access policy, or any unrelated resource without
fresh destructive authorization.
