<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# GitHub-first self-hosting pilot manifest

Status: approved on 2026-07-13 and not yet applied.

This manifest records the exact mutation boundary for making GitHub issues and
generated pull requests the practical development operator surface. Secret
values are never recorded here. Any external mutation outside this manifest
requires new approval.

## Existing resources updated in place

- Worker `roundhouse-dev-control-plane`;
- D1 database `roundhouse-dev-coordination`;
- Queue `roundhouse-dev-runs` and its existing dead-letter Queue;
- R2 bucket `roundhouse-dev-evidence`;
- Container application and image `roundhouse-dev-execution`;
- Access-protected hostname `roundhouse-dev.rm-rf.rip` and its existing exact
  webhook-path bypass;
- existing `roundhouse-dev` GitHub App installed only on
  `zorkian/roundhouse`.

Apply only additive D1 migration `0009_github_first_status.sql`. It adds the
repository identity to the existing comment outbox and creates the durable
independent-review Check projection. Deploy a new version of the existing
Worker and, only if required by the existing deployment process, a new digest
of the existing Container image. Retain all existing bindings, schedules,
resources, policies, routes, secrets, rows, and evidence objects.

No hostname, DNS record, route, certificate, Worker, D1 database, Queue, R2
bucket, KV namespace, Durable Object class, Container application, Access
application, policy, GitHub permission, event subscription, installation
scope, or secret is created, expanded, deleted, or replaced. Incremental
Cloudflare and bounded model usage is capped at USD 15.

## GitHub pilot operations

The existing GitHub App may maintain one rolling issue-status comment for each
authorized pilot issue and one repository-qualified GitHub Check per
independent review. Each status comment links to the Access-protected aggregate
workflow page. Each Check is bound to the exact reviewed repository, pull
request head, review ID, and durable revision.

Create at most one milestone pull request and three pilot issues with their
generated pull requests. At least two pilots must make useful source or test
harness changes through the complete Roundhouse cloud path. Issue commands,
status comments, generated branches and pull requests, Check runs, and replies
to verified Copilot review threads on the milestone pull request are
authorized. No pull request is merged, no human reviewer is requested, and no
person or organization is contacted.

Repository identity is explicit in every new status key, outbox row, route,
and external URL. The currently enrolled repository remains
`zorkian/roundhouse`; attempts to inspect or operate another repository fail
closed. Existing plan and run tables remain the documented single-repository
adapter and are not presented as the future multi-tenant storage contract.

## Credentials and security boundary

Human access continues through the existing Cloudflare Access application.
The webhook bypass remains limited to exact signed GitHub webhook requests.
The existing development-only Codex and Claude subscription credential
exceptions remain unchanged and may enter only their respective bounded
trusted Container processes. No GitHub, Cloudflare, or other credential enters
the Container.

Checkout remains limited to the audited public GitHub host. Agent tools and
arbitrary network access remain disabled; model transport remains limited to
the previously measured OpenAI or Anthropic hosts for the applicable process.
No credential is printed, committed, logged, stored in D1 or R2, retained as
evidence, baked into an image, or left after Container teardown.

## Mutation order and rollback

1. Pass focused contracts, formatting, licensing, typechecking, tests, and
   deployment dry-run checks.
2. Verify Wrangler's proposed resource changes exactly match this manifest.
3. Apply additive migration `0009_github_first_status.sql` to the existing D1
   database.
4. Deploy only the existing Worker and any deployment-coupled image digest.
5. Demonstrate rolling status, exact-head review Checks, repository-qualified
   workflow inspection, and at least two complete pilot changes.
6. Leave no active Container and retain the development evidence and pilot
   artifacts.

Rollback is documented but not executed: deploy the prior Worker version and
prior immutable image under fresh authorization. Do not reverse the additive
migration or delete rows, evidence, issues, pull requests, branches, checks, or
other retained artifacts.
