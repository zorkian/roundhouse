<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Roundhouse execution observability

Roundhouse explicitly enables persisted Cloudflare Workers Observability for
the development and production control-plane deployments. Cloudflare
correlates Worker, Durable Object, and Container logs for the Container
application.

## Logging boundary

Operational logs record run and attempt identity, lifecycle phase, duration,
outcome, bounded failure classification, and bounded validation stdout and
stderr excerpts. Validation runs only after the temporary model credential is
removed and network access is disabled.

Complete prompts, model transcripts, patches, and command output remain in the
immutable execution evidence. They are deliberately not duplicated into the
general-purpose log index because evidence has stronger identity, integrity,
retention, and access semantics. Logs are diagnostic hints; evidence is the
authoritative record.

The logging implementation must never record environment variables,
credential payloads, authorization headers, webhook bodies, Access tokens, or
GitHub App tokens. New lifecycle fields require the same public-disclosure
review as committed source.

## Operator commands

Inspect the Container application and instances:

```zsh
pnpm exec wrangler containers list
pnpm exec wrangler containers info <application-id>
pnpm exec wrangler containers instances <application-id>
```

Tail new production events while reproducing a problem:

```zsh
pnpm exec wrangler tail roundhouse-prod-control-plane --format pretty
```

Retained logs are available in the Cloudflare dashboard under the production
Worker's Observability view and the Container application's Logs view. Filter
by `runId` or `attemptId` to correlate control-plane phases with Container
output.

The Roundhouse run page should eventually expose the safe lifecycle timeline
directly. Raw Cloudflare logs remain an operator interface rather than an end
user interface.

## V1 pilot reliability summary

`GET /v1/operations/reliability` is an authenticated, read-only summary of up
to 25 recently updated issue plans. The dashboard renders the same data. Every
workflow has schema version `1`, the active Roundhouse environment, repository,
issue number, and the stable identity
`<environment>:<repository>#<issue-number>`. The response contains no prompts,
webhook bodies, evidence contents, credentials, or command output.

The metrics use these durable boundaries:

- Start to plan is the first planning-job creation through plan creation.
- Approval to draft pull request is plan approval through verified
  publication. This is the closest durable V1 boundary to draft creation.
- Implementation time is the sum of completed implementation attempts.
- Independent-review time is the sum of each review record's creation through
  its latest durable update.
- Human-action wait is the sum of plan-created to plan-approved and
  awaiting-implementation-approval to approval-recorded intervals.
- CI time is the first exact-pull-request check observation through the last
  terminal check observation. It is unavailable until both exist.

A duration is `{ "status": "unavailable" }` when either boundary is absent or
invalid, so legacy and incomplete runs remain readable. Retry counts are
additional implementation attempts, replans are distinct durable planning jobs
whose command is `replan`, and remediation cycles are review cycles after the
first. Delivery and operator stores already enforce unique delivery and
idempotency keys; therefore replayed webhooks and operations do not add metric
events. The summary-level `duplicateDeliveries` count is the number of
additional durable delivery IDs carrying an already-seen repository payload
hash. Per-workflow `duplicateDeliveries` reports duplicate effects and is zero
for suppressed replays.

Completed, failed, cancelled, and rejected workflows are terminal; all others
are explicitly nonterminal. Failure classes are restricted to the documented
agent, cancellation, infrastructure, publication, timeout, and validation
classes, with unknown values reported as `other`. Human-action counts use
distinct actor-bound planning jobs, plan events, and completed idempotent
operator mutations. Roundhouse service actors are excluded.

When Roundhouse cannot implement an approved plan, an authenticated operator
can record the manual fallback without adding an analytics service:

```text
POST /v1/plans/<plan-id>/manual-fallback
Idempotency-Key: <unique key>
Content-Type: application/json

{"schemaVersion":1,"expectedRevision":<revision>,"planSha256":"<sha256>"}
```

The operation binds the actor, exact plan revision, and plan SHA-256 to one
`implementation.manual_fallback` event in the existing plan-event store.
Repeating the same actor declaration or idempotency key does not double-count
it. This summary adds no external telemetry recipient and changes no deployment
resource, retention policy, or production-promotion behavior.
