<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Trusted execution Workflow

`roundhouse-dev-trusted-execution` is the development-only durable owner of a
trusted repository implementation delivery. The existing Queue remains the
buffer and backpressure boundary, but its consumer no longer waits for checkout,
agent execution, validation, evidence retention, or GitHub projection.

## Handoff

For `cloudflare-trusted-codex` deployments with the
`TRUSTED_EXECUTION_WORKFLOW` binding, the Queue consumer:

1. validates the exact run delivery;
2. derives a deterministic Workflow instance ID from the complete delivery;
3. reserves that binding in `trusted_execution_workflows`;
4. calls the idempotent Workflow `createBatch` API; and
5. acknowledges the Queue message.

Duplicate delivery is harmless. The Workflow ID is a SHA-256 binding of the run
ID, delivery ID, and expected run revision. Event parameters contain no
credential. Deployments without the binding retain the legacy synchronous Queue
adapter so production remains unchanged until separately authorized.

## Durable execution

The Workflow has two persisted steps:

- `execute trusted repository attempt` owns the coordinator lease and the
  deterministic Container attempt. It has a three-hour step timeout, two
  infrastructure retries delayed beyond the five-minute lease, a two-hour
  agent budget, and one shared thirty-minute validation budget.
- `finalize trusted repository attempt` reads authoritative D1 state, schedules
  an eligible bounded retry, applies existing low-risk publication policy, and
  projects status through the GitHub outbox. It is independently idempotent and
  retryable.

The execution Container still performs exact checkout, temporary Codex
credential installation, model-only egress, explicit network revocation,
network-disabled validation, and immutable R2 evidence retention. GitHub and
Cloudflare credentials never enter the Container. Workflow parameters and step
results contain identifiers and public run state only.

Scheduled recovery does not requeue a lease-less run while a corresponding
Workflow reservation is pending, dispatched, or running. If Workflow retries
are exhausted, its D1 projection becomes `failed`; ordinary recovery may then
requeue the still-active Roundhouse run with a new delivery identity.

## Inspection

`GET /v1/runs/:runId` includes `workflows`, with the instance ID, exact delivery
and revision binding, status, and timestamps. The run page shows the newest
durable execution instance above the phase timeline. Phase and attempt evidence
remain authoritative for repository execution details.

Local verification:

```text
pnpm check
pnpm exec wrangler deploy --dry-run --containers-rollout=none \
  --config apps/control-plane-worker/wrangler.deploy.jsonc
```

Deployment is performed only by the reviewed main-branch release and promotion
workflows. Development binds `roundhouse-dev-trusted-execution`; production
binds `roundhouse-prod-trusted-execution`. Promotion renders the production
binding from the exact development release rather than rebuilding source or the
Container image.
