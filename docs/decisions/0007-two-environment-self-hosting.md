<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# ADR 0007: two-environment self-hosting and bootstrap model transport

## Status

Proposed.

## Context

Roundhouse must be able to improve itself without replacing the control plane
that is coordinating the improvement. The existing development deployment
currently serves both as orchestrator and deployment target. A failed update
can therefore interrupt the workflow needed to diagnose or repair that update.

Cloudflare Worker versions belong to one Worker. A version created for one
Worker cannot be deployed as the version of a differently named Worker.
Environment bindings also necessarily differ. Cloudflare Container images can
instead be built once, pushed to the account registry, and referenced by an
immutable digest from both deployments.

The current Codex and Claude subscription credentials are an accepted
bootstrap exception. They are not the intended multi-user model-transport
boundary, but removing them before Roundhouse can build their replacement
would prevent self-hosting progress.

## Decision

Use two isolated deployments:

- production and development both receive GitHub webhooks;
- development receives each merged release before production promotion and is
  the normal dogfood orchestrator;
- production is the stable fallback orchestrator.

A release is an immutable manifest binding the source commit and tree, Worker
bundle hash, Container image digest, migration hashes, profile and lockfile
hashes, and toolchain. Development and production create different Cloudflare
Worker version IDs, but both must bind the same Worker bundle hash and
Container image digest. Production promotion requires exact accepted
development deployment evidence and an explicit human approval.

GitHub Actions is the deployment principal. Development deployment runs only
from merged `main`. Production promotion runs only through a separately
protected GitHub environment after human approval. Cloudflare API tokens are
account-scoped capabilities; repository scripts cannot technically restrict
them to one named Worker. Separate tokens, GitHub environment isolation,
reviewed workflows, exact manifest verification, and human merge and promotion
gates provide the bootstrap boundary. Neither token enters a Roundhouse agent
Container.

Migrations are expand-only and backward-compatible during V1. Development
applies them first. Production promotion applies the same ordered migration
set before deploying the new Worker version. Rollback restores a previous
Worker version and Container digest; it does not reverse database migrations.

The bootstrap model transport remains available in both environments behind a
replaceable authority contract. The encrypted `ROUNDHOUSE_CODEX_AUTH_JSON` and
`ROUNDHOUSE_CLAUDE_AUTH_JSON` bindings may be delivered only to their matching
ephemeral attempt. Agent tools remain network-disabled, model transport remains
host-allowlisted and bounded, and credentials may not enter logs, evidence,
D1, R2, images, release artifacts, or GitHub Actions. Each use records only a
non-secret bootstrap-exception audit event. A future broker must replace this
adapter without changing coordinator, approval, evidence, or publication
contracts.

Production uses a separate GitHub App installation, private key, webhook
secret, and command family. Development accepts `/rhd` and `/roundhouse-dev`;
production accepts `/rh` and `/roundhouse`. Both Apps acknowledge every
subscribed delivery but ignore commands owned by the other environment.
Environment-qualified task metadata, idempotency keys, publication branches,
and mutable comment markers keep subsequent processing isolated.

## Consequences

- A failed development deployment cannot stop the stable issue orchestrator.
- The same Container image bytes reach both environments.
- Worker code equivalence is verified by bundle hash rather than shared Worker
  version ID.
- Storage and evidence remain isolated between environments.
- Either environment can orchestrate a repair when the other is unhealthy.
- Production starts without copying historical development rows; retained
  development evidence remains available at the development hostname.
- Deployment credentials remain a meaningful bootstrap capability and require
  later replacement or narrower platform support.
- Protected deployment and credential changes continue to require human
  review even after ordinary development moves entirely into GitHub Issues.
