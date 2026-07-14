<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Issue-driven live operations manifest

Status: repository implementation approved on 2026-07-14. Production
application remains subject to the existing protected GitHub environment and
an explicit human promotion approval.

This manifest records the complete external mutation required to make the
production Roundhouse deployment the ordinary GitHub-issue development engine
with useful live status and faster interruption recovery. It does not create a
production-to-development dispatch channel. Production performs the repository
work; a merged pull request reaches development through the existing immutable
`main` release workflow.

## Existing resources only

The release may update the existing Worker and Container versions for:

- development Worker `roundhouse-dev-control-plane` and Container application
  `roundhouse-dev-execution`;
- production Worker `roundhouse-prod-control-plane` and Container application
  `roundhouse-prod-execution`;
- the existing development and production D1 databases, Queues, dead-letter
  Queues, R2 evidence buckets, Durable Object namespaces, scheduled triggers,
  Access applications, hostnames, and GitHub App installations.

Migration `0010_execution_progress.sql` is additive. It creates only bounded
Container phase projections and exact pull-request lifecycle projections in
each environment's existing D1 database. Existing rows and evidence remain.

No new hostname, DNS record, route, Access policy, Worker, Container
application, Durable Object class, Queue, database, bucket, secret, service
token, GitHub App permission, or billing setting is required. Stop before
promotion if the deployed bindings or required resources differ from this
manifest.

## Runtime changes

- Trusted implementation runs use a five-minute exclusive lease renewed every
  minute while the coordinating Worker remains healthy.
- Lease heartbeats do not alter the logical run revision exposed to operator
  commands.
- Container phases record only run and attempt identity, phase, state,
  timestamps, and bounded duration observations.
- The Access-protected status page displays live phase progress and retains the
  existing exact evidence, validation, retry, approval, and publication views.
- Signed `pull_request` webhooks bind the generated pull request to its exact
  Roundhouse run. A merged pull request links the issue workflow to the exact
  merge commit and that commit's GitHub checks, including the existing
  development release.

## Boundaries

The accepted temporary Codex and Claude credential exceptions are unchanged.
No credential is added, moved, printed, logged, or persisted. Agent tools and
repository commands remain network-disabled, model transport remains
host-allowlisted, and GitHub and Cloudflare authority remain outside the
Container.

Roundhouse continues to create draft pull requests only. It gains no merge,
default-branch write, deployment, or production-promotion operation. GitHub
branch protection, human merge, and the protected production environment
remain external controls.

Rollback redeploys the previous healthy Worker versions and immutable
Container digest. The additive migration and retained diagnostic rows remain;
no destructive rollback is authorized.
