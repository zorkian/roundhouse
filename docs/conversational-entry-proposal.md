<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Conversational entry for Roundhouse

- Status: Draft proposal for review
- Audience: Product and engineering
- Last updated: 2026-08-02

## Summary

Roundhouse should let a person begin with a conversation rather than requiring
them to begin with a build-ready GitHub issue. A person may have a question,
want a current-behavior investigation, or need help deciding whether any code
change is appropriate. Only after the desired outcome is sufficiently clear
should an authorized operator promote the conversation into Roundhouse's
existing issue-to-merge workflow.

The first product surface will be the Roundhouse web UI. The backend will use a
channel-neutral conversation and message model so later clients such as a
mobile app, Slack bot, Discord bot, or another authenticated application can
participate without acquiring their own agent runtime or delivery workflow.
Adapters authenticate and normalize messages; Roundhouse owns conversation
state, agent execution, authorization, and promotion.

The v0 goal is deliberately narrow: ask a useful read-only question about one
enrolled public repository, refine it over several turns, review a proposed
delivery brief, and explicitly promote that brief into exactly one GitHub issue
and normal Roundhouse run. The conversational agent cannot write repository
content, create issues, start runs, obtain provider credentials, or invoke
external mutations.

## Problem and product boundary

The existing issue-to-merge journey works when the request is already a unit of
software work. It is a poor fit for earlier questions such as:

- Is this behavior intentional?
- Does the repository already support this?
- Is this still reproducible?
- Which of two approaches fits the current design?
- Can you explain the constraint before we decide whether to change it?

Treating every question as a delivery run would make ordinary inquiry look like
failed or abandoned implementation, would create unnecessary GitHub noise, and
would blur the boundary between understanding a request and authorizing a
change. Conversely, turning the current qualification node into an indefinite
chat would mix two different durability and authority models inside one run.

Roundhouse will therefore distinguish:

1. A **conversation**, which helps a person understand and refine a possible
   change using read-only authority.
2. A **delivery brief**, which is a reviewed, immutable handoff describing a
   concrete desired outcome.
3. A **work item**, initially the GitHub issue created from that brief.
4. A **run**, which executes the repository's snapshotted workflow against the
   work item and brief.

A conversation may end with an answer and no delivery brief. In v0 it may be
promoted at most once. Clear GitHub issues may continue to use the existing
start command and skip the conversational journey entirely.

## V0 user journey

### Start and explore

1. The user signs in to the existing Roundhouse UI with GitHub.
2. The user selects one enrolled public repository they can access.
3. The user starts a conversation with a question or tentative request.
4. Roundhouse acknowledges the message, inspects an exact default-branch
   repository snapshot with its fixed read-only tools, and replies in the same
   conversation.
5. The user can ask follow-up questions or refine the desired behavior. Each
   turn sees the canonical conversation history and the repository identity.

The UI must always show that the conversation is **Read only** and identify the
repository and source commit used for the latest answer. Responses should cite
repository paths or approved public sources when those sources materially
support the answer. V0 does not run project commands or start a Dev Container;
deep reproduction remains part of a delivery run or a later conversational
investigation feature.

### Model policy

V0 uses one conversation model configured by the repository, not selected by
the user. The default is `openai/gpt-5.6-sol` with high reasoning. Conversation
volume should initially be low, and correctly understanding repository behavior
and producing a strong delivery brief matter more than minimizing turn latency.
Profile V2 gains a conversation setting equivalent to:

```yaml
conversation:
  model: { id: openai/gpt-5.6-sol, reasoning: high }
```

The private model broker must still authorize the requested route against its
deployment-wide configuration. The conversation records the configured and
actual route, reasoning level, token usage, and available cost for every turn.
Changing the model never changes the conversation's fixed read-only capability
set.

V0 does not expose a model picker. A later version may let a repository define
named modes such as `quick` and `thorough`, each with an approved model and
reasoning level, and let the user select among those modes. Adapters and message
prose cannot request an arbitrary provider or model. This keeps cost policy
with the repository operator while eventually allowing a user to choose the
appropriate cost and depth for a particular conversation.

This is a quality-first v0 choice, not an assumption that higher effort is
always better. [OpenAI's GPT-5.6 guidance](https://developers.openai.com/api/docs/guides/latest-model)
describes `medium` as the balanced starting point and recommends higher effort
when it produces a measured quality gain. Record enough usage, latency, and
outcome evidence to compare `medium` against `high` on real conversations after
the first pilot. Do not use `max` reasoning or pro mode without a separate
demonstrated need.

### Prepare a delivery brief

When the user asks to build the change, or Roundhouse believes the request may
be ready, Roundhouse may propose a delivery brief containing:

- a concise title;
- the problem or desired outcome;
- acceptance criteria;
- explicit constraints and non-goals;
- the evidence and decisions established in the conversation; and
- remaining uncertainties, if any.

The proposal is data, not an action. The user may continue the conversation or
edit the brief fields in the UI. The agent may suggest that the work is ready,
but it cannot mark its own brief approved and cannot call the promotion path.

### Promote to delivery

An authenticated repository operator selects **Start delivery** and reviews a
confirmation showing the repository and exact issue title and body. The trusted
control plane freezes the approved brief, creates one GitHub issue as the
signed-in user, and posts the configured Roundhouse start command as that same
user. The user's GitHub credential is decrypted only in memory for those two
fixed API operations and is never exposed to the model or browser.

The start comment enters the ordinary GitHub webhook intake. That existing path
loads the then-current default-branch commit, profile, and workflow; authorizes
the comment actor against that profile; creates the normal immutable run
snapshot; and enqueues it. Promotion therefore does not separately repeat
authorization or profile compilation. Partial promotion state is durable, so a
retry reuses an issue that has already been created.

The GitHub issue contains the approved brief and a link to the originating
conversation, but not the entire transcript. The UI switches to a delivery
summary with links to the issue and run. To keep v0 unambiguous, the promoted
conversation is closed to further messages; live steering and multiple briefs
from one conversation are follow-on product work.

## Product model and adapter boundary

The canonical data model belongs to Roundhouse rather than to the web client or
any future chat provider.

```text
Conversation
  id, repository, creator, status, created_at, promoted_brief_id?

ConversationMessage
  id, conversation_id, direction, actor, body, source, source_message_id,
  created_at

ConversationTurn
  id, conversation_id, triggering_message_id, state, source_commit,
  model_route, result, created_at, updated_at

DeliveryBrief
  id, conversation_id, revision, title, outcome, acceptance_criteria,
  constraints, evidence, approved_by, approved_at, source_commit

ConversationLink
  conversation_id, kind, external_id, url
  # v0 kinds: github.issue and roundhouse.run
```

Messages use a small canonical inbound envelope:

```text
adapter                  # roundhouse.web in v0
adapter_installation     # authenticated adapter instance
external_conversation_id
external_message_id      # deduplication key within the installation
verified_actor           # stable provider identity, never a display name
body
sent_at
```

An adapter has three responsibilities: verify its provider request, map the
provider identity and conversation to the canonical envelope, and deliver a
Roundhouse reply to the provider destination. It does not choose tools, invoke
models directly, authorize repositories, approve briefs, create runs, or store
independent conversation state.

The core accepts an inbound message only after adapter verification, resolves
the verified actor to Roundhouse identity, applies conversation access policy,
records the message idempotently, and schedules one durable turn. Turns for one
conversation execute serially. D1 remains the durable conversation authority;
Queue delivery is only a wakeup. Reply delivery uses an outbox so retrying an
adapter callback cannot repeat the model turn or post duplicate replies.

Future adapters may add provider-specific presentation such as buttons,
reactions, or push notifications. Those controls must normalize into the same
typed core events. A provider button is not itself authorization: Roundhouse
must authenticate the actor and recheck repository authority when processing
the resulting event.

## Security and authority

Conversational content, repository content, public research, adapter metadata,
and model output are untrusted data. V0 preserves these invariants:

1. A conversational turn runs with a fixed Roundhouse-owned read-only executor
   and a maximum capability set of `repository.read`, `context.read`, and
   optionally broker-mediated `research.public`.
2. It receives no `artifact.write`, command execution, project environment,
   project network, preview capture, GitHub mutation, external adapter, or
   deployment capability.
3. The model and its Sandbox receive no GitHub App, model-provider, Cloudflare,
   deployment, or other reusable credential.
4. Repository access is pinned to an exact public commit. The turn cannot push,
   publish a checkpoint, alter the default branch, modify Roundhouse policy, or
   persist files into a later delivery workspace.
5. Model output is validated structured data or assistant prose. It cannot call
   the promotion service or manufacture an authorized core event.
6. Promotion is a separate deterministic control-plane operation initiated by
   an authenticated, same-origin UI action. It never trusts authority asserted
   by the conversation or adapter.
7. The promotion operation may create only the declared GitHub issue and start
   comment. The existing GitHub intake rechecks operator authorization and
   applies its idempotency and exact-profile snapshot rules before the run is
   enqueued.
8. A future adapter may reduce available functionality but cannot expand the
   conversational tool set or promotion authority.
9. General logs contain identifiers, timings, routes, and bounded outcomes, not
   full transcripts, repository file contents, credentials, or prompts.
10. V0 supports only enrolled public repositories. Private repositories,
    attachments, organizational systems, additional OAuth grants, and secret-bearing
    context require separate threat models and are not enabled by this design.

The conversation itself is visible only to its authenticated creator in v0.
Before promotion, the confirmation warns that the approved brief will be
published to the repository's GitHub issue according to that repository's
visibility. Shared conversations and participant authorization are deferred.

## V0 scope

V0 includes:

- authenticated web conversations in the Roundhouse UI;
- selection of one accessible enrolled public repository;
- durable messages and one serial read-only agent turn per user message;
- exact-commit repository reading and optional hosted public research;
- source-aware answers and a visible read-only authority indicator;
- generation and user editing of one delivery brief;
- one repository-configured conversation model with per-turn usage reporting;
- explicit operator confirmation;
- idempotent GitHub issue creation and handoff to the existing run workflow;
- conversation-to-brief-to-issue-to-run links; and
- an internal adapter interface exercised by the web adapter.

V0 intentionally excludes:

- Slack, Discord, mobile push, and other external adapters;
- existing issue or pull-request conversations in the new UI;
- multi-user and shared conversations;
- private repositories and organizational knowledge;
- file, image, audio, or other attachments;
- project commands, Dev Containers, reproduction, or browser interaction;
- external provider credentials, MCP servers, or arbitrary plugins;
- persistent memory across conversations;
- live steering of an active run;
- reopening a promoted conversation or creating multiple briefs from it;
- token streaming and rich provider-specific interaction; and
- user selection of a raw provider, model, or reasoning level;
- automatic promotion based on model intent classification.

The internal adapter seam is part of v0 because it prevents the web transport
from becoming the conversation model. No generalized plugin SDK, adapter
marketplace, OAuth framework, or provider capability negotiation is required
until a second real adapter is selected.

A later read-expansion slice may add Roundhouse-owned tools or MCP-backed
context providers. Each one requires an explicit read-only capability and
credential boundary; installing a conversational adapter or mentioning a tool
in message prose cannot make that tool available.

## Acceptance criteria

V0 is successful when:

- an authorized user can ask and refine a repository question without creating
  a GitHub issue, run, branch, checkpoint, or pull request;
- a useful answer can identify the exact repository commit and supporting
  repository locations;
- prompt injection in a message or repository file cannot expose a credential,
  add a tool, execute a command, write an artifact, or invoke promotion;
- a model-produced recommendation cannot start delivery without the separate
  authenticated operator action;
- promotion creates exactly one issue and one normal run despite duplicate UI,
  Queue, or GitHub delivery;
- an unauthorized or forged adapter actor cannot view a conversation or
  promote its brief;
- the approved brief and exact promotion actor are auditable from the linked
  conversation, issue, and run; and
- the web UI uses the same canonical inbound, turn, reply, and promotion
  contracts available to a future adapter.

## Accepted product decisions

1. **Name:** use “conversation” in the product and data model.
2. **Promotion behavior:** create a new GitHub issue from every v0 promotion,
   then post the normal start command so existing GitHub intake performs the
   trusted run-start operation.
3. **Post-promotion behavior:** close the conversation to new messages in v0;
   the user follows the active work through the existing live service.
4. **Read depth:** restrict v0 to repository file reading and hosted public
   research. Consider explicitly bounded read-only tools or MCP context
   providers in a later slice.
5. **Visibility:** keep v0 conversations private to their creator while making
   the approved brief visible through the repository's GitHub issue. A future
   slice may provide a shareable conversation URL with an opaque ULID or UUID;
   the identifier is not an authorization secret, and every viewer must sign in
   and retain access to the conversation's repository.
6. **Model policy:** use one repository-configured conversation model in v0,
   defaulting to `openai/gpt-5.6-sol` with high reasoning. Defer optional
   repository-defined user-selectable modes.
