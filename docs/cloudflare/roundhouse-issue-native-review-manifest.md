<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Issue-native independent review manifest

Status: approved on 2026-07-12 and applied on 2026-07-12.

This manifest records the exact external mutation boundary for the independent
Claude review, bounded remediation, and linked operator-status milestone.
Secret values are never recorded here. Any external change outside this
manifest requires new approval.

## Existing resources updated in place

- Worker `roundhouse-dev-control-plane`;
- D1 database `roundhouse-dev-coordination`;
- Queue `roundhouse-dev-runs` and its existing dead-letter Queue;
- R2 bucket `roundhouse-dev-evidence`;
- Container application and image `roundhouse-dev-execution`;
- Access-protected hostname `roundhouse-dev.rm-rf.rip`;
- existing `roundhouse-dev` GitHub App installation for
  `zorkian/roundhouse`.

Apply one additive D1 migration, `0008_independent_review.sql`, for immutable
review requests, review evidence, normalized findings, finding dispositions,
bounded remediation cycles, and linked status projections. Deploy new versions
of only the existing Worker and Container image. The image adds the pinned
Claude Code `2.1.142` executable alongside the existing pinned Codex runtime.

Retain every existing binding, schedule, resource identity, Access policy,
webhook bypass, audit row, and evidence object. No hostname, DNS record, route,
certificate, Worker, D1 database, Queue, R2 bucket, KV namespace, Durable
Object class, Container application, Access application, policy, GitHub
permission, event subscription, installation scope, or unrelated secret is
created, altered, or deleted. Combined incremental Cloudflare and bounded model
usage is capped at USD 15.

## Claude development credential exception

Create exactly one encrypted secret on `roundhouse-dev-control-plane`:

- binding: `ROUNDHOUSE_CLAUDE_AUTH_JSON`;
- source: a dedicated long-lived subscription token produced by Claude Code's
  `setup-token` flow after a fresh local login, wrapped outside the repository
  as `{"oauthToken":"..."}`;
- destination: the `CLAUDE_CODE_OAUTH_TOKEN` environment variable of one
  bounded reviewer process inside the trusted Container;
- lifetime: one review attempt; the token is never written to the Container
  filesystem and disappears when the process and Container terminate;
- readers: the Worker supervisor and the bounded Claude reviewer process only.

The source is not a copied `.credentials.json` file. Claude subscription OAuth
refresh credentials rotate and a copied credential-file snapshot is therefore
not a restart-safe secret boundary. The token is never printed, committed,
logged, baked into an image, stored in D1 or R2, retained as evidence, included
in process arguments, or exposed to Claude tools. This is a development
exception, not the accepted production credential architecture.

A measured tools-disabled Claude Code `2.1.142` request using the dedicated
setup token and an isolated empty home requires HTTPS transport only to
`api.anthropic.com`. Subscription identity host `platform.claude.com` and
optional telemetry and MCP destinations, including
`http-intake.logs.us5.datadoghq.com` and `mcp-proxy.anthropic.com`, remain
blocked. The reviewer receives no GitHub, Cloudflare, Codex, or other
credential. Its tools and arbitrary network access remain disabled.

## Review and remediation boundary

1. Review starts only from a retained Roundhouse publication result and exact
   pull-request head commit.
2. A fresh deterministic Container checks out that exact public commit through
   the existing audited `github.com` checkout boundary.
3. The reviewer receives the immutable issue snapshot, approved plan, exact
   base and head identities, patch, validation summary, and retained evidence
   references. It receives no writable implementation workspace or prior agent
   conversation.
4. Claude emits schema-validated findings with stable identity, severity, path,
   optional line, rationale, and recommendation. It cannot edit files, invoke
   GitHub, approve, publish, or merge.
5. The credential and model egress are removed before evidence processing.
   Complete review output is bounded, checked for credential material, stored
   immutably in R2, SHA-256-bound to D1, and tied to the exact head commit.
6. Findings are durably classified as accepted, declined, duplicate, or
   deferred. Only accepted, policy-compliant findings may create a fresh Codex
   remediation attempt.
7. Remediation is bound to the prior approved plan, exact reviewed head,
   accepted finding set, existing path allowlist, and existing validation and
   publication invariants. It uses the existing Codex credential exception and
   never receives the Claude credential.
8. At most two review/remediation cycles, one active Container, 15 minutes per
   reviewer attempt, 20 minutes per implementation attempt, 256 KiB of review
   output, 512 KiB of patch content, and 256 model requests per attempt are
   permitted. Conflicting findings, scope expansion, exhausted cycles, or a
   security-boundary change stop for human direction.

## Operator and GitHub behavior

The existing Access-protected UI may add linked issue, plan history, commit,
evidence, actor, pull-request, check, review, and remediation views. Evidence
bytes are served only through authenticated routes and independently verified
against D1 object identity, SHA-256, size, media type, and attempt binding.

The GitHub App may post concise state transitions and a direct status link on
the single milestone dogfood issue and pull request. Routine successful CI
observations remain in D1 and the dashboard and do not create issue comments.
Actionable failures, clarification requests, review summaries, and terminal
outcomes may be posted idempotently. At most one milestone pull request and one
dogfood issue/draft-PR pair are created. Verified Copilot thread replies and
resolution on the milestone pull request remain authorized. No human reviewer
is requested, no human review is submitted, and no pull request is merged.

## Mutation order and rollback

1. Pass local contracts, formatting, licensing, typechecking, tests, image
   build, credential-leak tests, and tools-disabled Claude adapter tests.
2. Reauthenticate Claude locally and create the dedicated long-lived token
   outside the repository without printing or retaining it in shell history.
3. Verify the deployed resource manifest and dry-run deployment against this
   file.
4. Apply additive migration `0008_independent_review.sql`.
5. create encrypted secret `ROUNDHOUSE_CLAUDE_AUTH_JSON` without displaying its
   value;
6. deploy only the existing Worker and Container image;
7. demonstrate exact-head review, one bounded remediation, revalidation,
   interruption recovery, immutable evidence, linked live status, and quiet CI
   observations;
8. leave no active Container and retain all development evidence.

Rollback is documented but not executed: deploy the prior Worker version and
prior immutable execution image, and remove the new secret only under fresh
authorization. No migration, evidence, audit row, demonstration artifact, or
existing resource is deleted.

## Applied identities

- D1 migration: `0008_independent_review.sql`;
- Worker version: `512517cc-24ac-4be0-8386-46713eefe93a`;
- Container application: `roundhouse-dev-execution`, application ID
  `a030958f-41f0-4ae6-9a68-a33d0876ea72`;
- immutable image digest:
  `sha256:ca21a1e03b0e7570c9876232f03a25562d46aa6bef2d124047149c0bf81c879d`;
- encrypted secret binding: `ROUNDHOUSE_CLAUDE_AUTH_JSON`.

The deployment retained the existing hostname, Access boundary, Worker, D1,
Queues, R2 bucket, Durable Object class, Container application, cron, routes,
GitHub installation, and every existing development row and evidence object.
