<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Issue-native V1 loop manifest

Status: approved, unapplied.

This manifest records the exact external mutation boundary authorized for the
issue-native V1 self-development and live operator-UI milestone. Secret values
are never recorded here.

## Existing resources updated in place

- Worker `roundhouse-dev-control-plane`;
- D1 database `roundhouse-dev-coordination`;
- Queue `roundhouse-dev-runs` and existing dead-letter Queue;
- R2 bucket `roundhouse-dev-evidence`;
- Container application `roundhouse-dev-execution` and its existing execution
  image;
- hostname `roundhouse-dev.rm-rf.rip`;
- the existing hostname-wide Access application and exact webhook-path bypass.

The Worker may add Access-protected HTML, JavaScript, and JSON routes on the
existing hostname. The exact `/v1/github/webhook` bypass remains unchanged and
no UI or operator action is exposed through it.

Apply one additive D1 migration for immutable plans, plan approvals, plan audit
events, and queryable run-dashboard projections. Deploy new versions of the
existing Worker and execution image only when required by committed milestone
code. Retain all existing schedules, bindings, audit records, evidence, and
demonstration data.

No hostname, DNS record, route, certificate, Worker, D1 database, Queue, R2
bucket, KV namespace, Durable Object class, Container application, Access
application, policy, or secret is created, altered outside this scope, or
deleted. Incremental Cloudflare usage is capped at USD 15.

## GitHub operations

Retain the existing `roundhouse-dev` GitHub App, installation, repository
permissions, webhook URL, secret, and event subscriptions. No GitHub setting,
permission, event subscription, secret, or installation scope changes.

Create at most one milestone pull request and two bounded dogfood issue/draft
PR pairs. Required Roundhouse status and planning comments on those issues and
replies to verified Copilot review threads are authorized. No human reviewer is
requested and the milestone pull request is not merged by this milestone.

## Credential and execution boundary

The existing development-only `ROUNDHOUSE_CODEX_AUTH_JSON` exception remains
unchanged. It may be installed only inside the trusted execution Container for
one bounded attempt, may reach only the measured OpenAI model endpoints, and
must be removed before validation. It is never committed, logged, stored in D1
or R2, retained as evidence, baked into an image, or exposed to agent tools.

No GitHub, Cloudflare, or other credential enters the Container. Checkout is
limited to the audited public GitHub host. Agent tools, planning validation,
repository validation, and arbitrary network access remain disabled by
default. Runtime package installation remains prohibited.

## Retention and rollback

Retain the additive schema, immutable plans, approvals, audit records, run
evidence, and authorized dogfood artifacts. Rollback is limited to a reviewed
Worker version rollback and, if needed, the prior immutable execution image.
No destructive migration, cleanup, resource deletion, or evidence deletion is
applied.
