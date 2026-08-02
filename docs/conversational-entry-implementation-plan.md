<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Conversational entry v0 implementation plan

This plan turns the product proposal into one deliberately narrow vertical
slice: a signed-in user can start a private repository conversation, ask
questions using read-only repository and public-web context, and explicitly
promote the result into a new GitHub issue. The normal GitHub intake then owns
authorization, profile loading, snapshotting, and delivery.

## Architecture

The control plane owns the canonical conversation record and web adapter. A
conversation is not a run and does not create an attempt, sandbox, branch, or
workspace. At creation time the service snapshots the repository default-branch
commit and compiled profile once. Every turn uses the conversation model from
that profile snapshot.

The conversational model is called only through the private model broker. The
control plane exposes two fixed function tools: list the snapshotted Git tree
and read one file from that commit. Hosted public web research is enabled by
the broker. Tool arguments are validated by trusted code, repository reads are
size-bounded, and no GitHub or OAuth credential enters the model request.

Promotion uses two distinct same-origin POSTs. The first freezes a delivery
brief from the transcript and shows its exact title and body for review. After
the user's second confirmation, trusted code creates exactly one issue using the signed-in user's
GitHub authorization, and posts the configured Roundhouse start command. That
comment enters the existing webhook path as the user, so the ordinary run start
performs the current operator authorization, reloads the current profile and
default head, creates the run snapshot, and enqueues delivery. The conversation
closes after the start comment succeeds.

## Build slices

1. Add an optional `conversation.model` profile setting, defaulting to
   `openai/gpt-5.6-sol` with `high` reasoning, and add a broker route for the
   conversation role. The v0 parser accepts OpenAI Responses models only;
   additional provider protocols require an engine adapter before they can be
   configured.
2. Add D1 conversation and message tables plus a repository that enforces
   creator-only reads, one active turn, idempotent promotion, and immutable
   promoted conversations.
3. Add the read-only conversation engine and tests for route selection, tool
   validation, bounded repository reads, and model-output parsing.
4. Add authenticated HTML routes for the conversation list, creation, thread,
   reply, and promotion. Require an exact same-origin mutation and current
   session repository access on every route.
5. Add deterministic delivery-brief rendering and promotion recovery so a
   retry after partial GitHub success reuses the already-created issue instead
   of creating another.
6. Add focused route/store/journey tests, then run formatting, type checking,
   and the full test suite.

## Explicitly deferred

- Slack, Discord, phone, and GitHub conversational adapters
- shared conversation links or repository-member visibility
- user-selectable models and named cost modes
- shell, devcontainer, MCP, or arbitrary tool execution
- streaming, background turn workers, attachments, and branch-aware context
- editing or reopening a conversation after promotion

## Acceptance boundary

The v0 is complete when a repository-authorized signed-in user can complete the
web journey, a non-creator receives no conversation data, concurrent turns are
rejected, model text cannot invoke promotion, the model can perform only the
three declared read capabilities, and a successful promotion produces one
GitHub issue plus one ordinary Roundhouse start event.
