<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Conversational entry v0 implementation plan

- Status: Implemented (v0)
- Audience: Maintainers and implementers
- Last updated: 2026-08-02

This plan maps the accepted conversational-entry proposal to the concrete
persistence, service, adapter, execution, and test contracts that shipped in
v0. The proposal remains the product source of truth for deferred follow-ons.
Do not weaken the v0 boundaries below without an explicit product decision.

## V0 architecture

The control plane owns the canonical conversation application service. The web
UI is the first adapter: it authenticates the GitHub user, maps a request to a
verified canonical envelope, invokes the service, and renders persisted state.
It does not invoke models, choose tools, approve its own actions, or implement
independent conversation state.

An inbound message is committed to D1 together with one pending
`ConversationTurn` and a durable Queue-wakeup outbox record. The HTTP request
publishes that wakeup when possible and returns without waiting for a model.
The scheduled liveness scan republishes any pending wakeup whose delivery was
lost. Queue delivery is at least once; a D1 turn lease and terminal state make
execution idempotent and serialize turns for each conversation.

The turn worker resolves the repository-configured model through the private
broker. The profile specifies a model identity and reasoning level; the broker
must map that identity to a deployment-approved provider, protocol, and
transport. The conversation engine has protocol adapters for every protocol the
broker can approve. Provider protocol never changes the fixed Roundhouse-owned
read-only tool set.

Every model call, including tool rounds and delivery-brief synthesis, records
its configured and actual route, reasoning level, tokens, available cost,
latency, and outcome against the conversation and turn. The usage dashboard
combines conversation and delivery-run calls. V0 intentionally adds no
Roundhouse quota or rate-limit policy; the recorded primitives support those
controls later and the deployment-level Cloudflare budget remains the initial
backstop.

## Canonical records

- `Conversation`: repository, creator, source snapshot, current state, and the
  active turn/current brief references.
- `ConversationMessage`: direction, stable actor, canonical body, adapter
  installation, provider conversation/message identities, and delivery state.
- `ConversationTurn`: triggering message, kind, lease/state, source commit,
  configured and actual route, result, and bounded error.
- `DeliveryBrief`: revisioned draft/approved state, editable structured fields,
  source commit, and approval actor/time.
- `ConversationPromotion`: approved brief, actor, durable external-write state,
  issue identity, handoff state, lease, and bounded error.
- `ConversationLink`: auditable links to the GitHub issue and accepted
  Roundhouse run.
- `ConversationModelUsage`: one record per provider call with route, token,
  cost, latency, and outcome data.
- `ConversationOutbox`: durable turn wakeups and adapter replies. D1 is the
  authority; Queue delivery is only a wakeup.

## Adapter contract

The application service accepts a verified envelope containing:

```text
adapter
adapter_installation
external_conversation_id
external_message_id
verified_actor_id
verified_actor_login
body
sent_at
```

The deduplication key is scoped to the adapter installation. An adapter may
verify identity and deliver a reply; it cannot expand the tool set, select an
unapproved route, bypass repository access, approve a brief, or perform
promotion. The web adapter uses a stable form idempotency key and a no-op reply
delivery because persisted messages are rendered directly.

## Read-only execution

Conversation creation snapshots the repository's public default-branch commit,
compiled profile hash, conversation model, project instructions, and operator
policy. Every turn reads only that exact commit. Trusted code exposes bounded
tree listing and UTF-8 file reading; path segments are URL encoded so model
arguments cannot alter the pinned `ref`. Hosted public research is requested
through the broker when the selected protocol supports it. No model receives a
GitHub, OAuth, Cloudflare, or provider credential.

V0 rejects private repositories before a conversation is created. Supporting
private code remains a separate data-boundary decision.

## Brief and promotion lifecycle

Preparing a brief creates a durable `brief` turn. A completed draft does not
close the conversation: the creator may edit it, continue talking, or replace
it with a newer draft. A new inbound message supersedes an unapproved draft.

Starting delivery freezes the submitted brief fields as an approved revision
and records the exact actor. Promotion does not reload or compile the profile
and does not duplicate operator authorization. Normal GitHub intake remains
the single authority: it checks the actor against the then-current profile.

Promotion is a durable state machine. It reconciles an issue using a marker
containing the conversation and approved brief identities before creating one,
then similarly reconciles the start comment. External writes use only the
signed-in user's encrypted GitHub credential and the two allowlisted issue API
operations. A retry therefore reuses both writes after an interrupted D1
update.

Posting the start comment changes the conversation to `handoff_pending`, not
`promoted`. The normal GitHub webhook loads the current default head and
profile, authorizes the comment actor, creates the immutable run snapshot, and
enqueues it. Only that accepted intake links the run and closes the
conversation. Rejected intake remains visible and does not claim delivery
started.

## Requirement-to-test contract

| Approved requirement            | Implementation evidence                           | Required test                                              |
| ------------------------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| Web is one reusable adapter     | canonical envelope and application service        | web requests enter the same idempotent service contract    |
| Durable serialized turns        | turn record, lease, wakeup outbox, Queue worker   | lost/duplicate wakeups produce one terminal turn and reply |
| Provider-neutral model          | broker-approved route plus protocol adapters      | each approved protocol can complete text and local tools   |
| Fixed read-only tools           | trusted tool dispatcher, exact encoded commit ref | injection/path inputs cannot mutate or escape the snapshot |
| Creator-private visibility      | creator and current repository access predicates  | another repository member receives no transcript           |
| Public repositories only        | current GitHub visibility check                   | private repository creation is rejected before model use   |
| Editable brief                  | revisioned draft separate from conversation state | edit, continue, supersede, approve paths remain distinct   |
| Explicit operator promotion     | approved actor plus authoritative webhook check   | model text and unauthorized actors cannot promote          |
| Exactly one issue/start comment | durable state plus deterministic markers          | failure after either GitHub write reconciles on retry      |
| Close only after accepted run   | webhook correlation and run link                  | start-comment success alone remains handoff pending        |
| Auditable links                 | brief approval, issue link, run link              | conversation traces exact actor, brief, issue, and run     |
| Usage and cost visibility       | per-call conversation usage joined into dashboard | turns and brief calls appear beside delivery-run usage     |

## Explicitly deferred

- Slack, Discord, phone, and GitHub conversational adapter implementations
- shared conversation links or repository-member visibility
- user-selectable models and named cost modes
- Roundhouse quotas, rate limits, and repository budgets
- shell, Dev Container, MCP, or arbitrary tool execution
- attachments, streaming, and branch-aware context
- live steering of an active delivery run
- reopening an accepted/promoted conversation or creating multiple deliveries
  from it

These client and feature deferrals do not defer the canonical adapter seam,
durable execution, audit linkage, usage tracking, or security boundaries.
