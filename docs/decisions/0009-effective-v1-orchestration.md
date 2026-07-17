<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# ADR 0009: Effective V1 orchestration

## Status

Accepted.

## Context

Roundhouse's V1 security kernel is proportionate to its authority: the coding
agent has no GitHub or Cloudflare credentials, execution is bounded, repository
policy constrains publication, and an exact pull-request head must pass
repository CI and independent review before merge. Those boundaries limit the
impact of prompt injection and bad generated code without pretending that
automation can prove a patch correct.

Several orchestration and acceptance mechanisms grew beyond those boundaries.
Routine comments expose internal IDs and hashes; plan path predictions can look
like an exact implementation contract; ordinary low-risk changes repeat the
same full validation locally and in GitHub; multiple stores make overlapping
liveness and retry decisions; deployments can sever a synchronous Worker call
to an otherwise surviving Container; and the Goal 1 and Goal 3 gates test
Cloudflare topology more than maintainer outcomes. These mechanisms consume
latency, tokens, and operator attention without materially reducing the
authority of the generated patch.

ADR 0008 remains the security baseline except where its original human-only
merge assumption has already been superseded by repository-authorized,
exact-head automatic merge in the V1 acceptance contract. This ADR narrows the
orchestration required to enforce that contract.

## Decision

Roundhouse will optimize V1 around visible maintainer state, Git identity, and
one durable lifecycle owner. It retains the existing one-remediation/two-review
policy and the security controls that bound authority.

### Acceptance measures maintainer journeys

Goal 1 is accepted with representative clear low-risk journeys. Bounded
automatic recovery may occur and counts as success when the journey stays
within its published latency and cost budgets, creates no duplicate paid or
published work, and requires no human babysitting. A same-base, zero-retry
three-run batch is useful diagnostic evidence but is not a product gate.

Goal 3 tests observable failure classes:

- transient execution or model unavailability;
- interrupted delivery or orchestration;
- lost caller or deployment handoff while work continues;
- transient GitHub read, publication, check, or merge failure; and
- exhausted, non-retryable, or ambiguous failure that must stop safely.

Tests may inject those outcomes at whichever provider boundary is stable. V1
does not require a separate acceptance scenario for every Cloudflare product.

### Git is the published-code identity

The base commit and published pull-request head commit are the primary durable
identities for code. Exact-head CI, review, approval when required, and merge
bind to the head commit.

Additional hashes are permitted only when they have a named mechanical use:

- deduplicating an untrusted delivery or mutation;
- checking bytes transferred to or read from object storage;
- reconciling a publication operation that may have completed before its
  response was observed; or
- binding a retained retry candidate before it has a Git commit identity.

Such hashes are implementation details. They do not appear in routine
maintainer commands or imply code quality. Unused plan, path-set, patch-set,
and evidence-set hash ceremonies are removed rather than propagated.

### Commands resolve visible current state

The ordinary maintainer interface accepts unambiguous prose and short commands
such as `/rh start`, `/rh clarify`, `/rh implement`, `/rh retry`, `/rh cancel`,
`/rh review`, and `/rh approve`. The control plane resolves the command against
the repository, issue or pull request, actor profile, and the single visible
current plan, run, review, or head.

If there is no eligible current object, or more than one object could be acted
on, Roundhouse performs no mutation and replies with one exact next action.
Internal plan IDs, revisions, run IDs, and hashes remain available in operator
diagnostics and API paths but are never required to construct a routine GitHub
comment.

### Plans predict; repository policy authorizes

Planned paths describe the likely implementation and help reviewers understand
scope. They are advisory. A candidate may add, omit, or substitute paths when
that is necessary to satisfy the accepted outcome.

The enforceable boundary is repository policy: allowed and protected paths,
risk floors, actor authority, maximum files and bytes, dependency and migration
rules, and the constrained publication branch. A change outside that boundary
stops or asks for the required approval; a harmless deviation from predicted
paths does not fail solely for plan non-compliance.

### Validation is layered

Every implementation attempt runs formatter-write, diff and repository-policy
checks, a relevant reproduction or targeted test when available, and
typechecking for changed typed code. Ordinary low-risk changes do not also run
the entire repository test suite inside the implementation Container unless a
repository rule or changed-file trigger promotes them to full validation.

High-risk changes and changes to workflows, execution boundaries, dependency
manifests, lockfiles, repository profiles, or build configuration use full
local validation. GitHub required checks on the exact published head remain the
authoritative repository-wide gate for every merge. A local quick pass can
therefore reduce feedback latency but can never waive exact-head CI.

### One owner decides lifecycle outcomes

The durable self-development run or independent-review record in D1 is the
only business-state authority for lifecycle state, lease ownership, retry
budget, cancellation, and terminal outcome. Coordinator compare-and-swap
transitions are the only code allowed to make those decisions.

Queues and Cloudflare Workflows transport idempotent deliveries. Their rows may
record delivery telemetry (`pending`, `dispatched`, `completed`, `failed`) but
may not prove run liveness, consume retry budget, change a run terminal, or
block recovery after the authoritative lease expires. Scheduled recovery reads
the authoritative record, then requests an idempotent redispatch; it does not
maintain a second lifecycle state machine.

### Active attempts survive releases

An attempt is addressed by its stable attempt ID and is reconnectable. Starting
an attempt returns or establishes a durable execution handle before waiting for
completion. The named execution service exposes status and final result for
that handle, and completion is written durably with create-if-absent semantics.

After a development Worker deployment, a replacement caller first checks the
durable result and then reconnects to the same named attempt. It must not start
a second paid agent invocation for that attempt. Existing attempts continue on
the execution image and Container instance on which they began; new attempts
use the newly deployed version. If a platform version cannot provide that
reconnect contract, deployment must drain new starts and wait for active
attempts instead of interrupting them.

An infrastructure handoff may renew or reacquire the same attempt lease without
being counted as an implementation retry. A genuine terminal attempt failure
is recorded once by the lifecycle owner and follows the ordinary bounded retry
policy.

## Boundaries retained

This decision does not relax credential isolation, webhook verification, actor
authorization, bounded execution and network access, protected-path and risk
rules, constrained branches, publication brokerage, exact-head CI, exact-head
independent review, approval for repository-defined risk, or merge gates. It
does not change the existing maximum of one remediation followed by a second
and final independent review.

## Consequences

Maintainer comments become shorter and less error-prone. Planning can adapt to
the code it discovers without escaping repository authority. Low-risk feedback
arrives sooner while GitHub remains the authoritative full validation surface.
Recovery becomes easier to reason about because delivery systems cannot
compete with the run coordinator. Deployments stop turning healthy work into
false implementation retries.

The control plane must perform careful current-state resolution and give an
explicit ambiguity response. Quick validation requires trustworthy changed-file
classification and targeted commands. Durable execution status/result storage
adds a small protocol to the Container boundary, but replaces repeated paid
work and deployment-specific retry exceptions.

## Verification

This ADR is complete when tests and development evidence show:

1. representative Goal 1 journeys can recover within budgets without duplicate
   work and Goal 3 is expressed in outcome-level failure classes;
2. routine GitHub commands contain no internal IDs, revisions, or hashes and
   ambiguity fails without mutation;
3. planned-path deviation permitted by repository policy succeeds;
4. low-risk quick validation runs formatting, targeted checks, and typechecking
   while exact-head required CI still gates merge;
5. only the authoritative D1 record decides leases, retries, and terminal state;
6. a caller interrupted by a development deployment reconnects to the same
   attempt and observes its single durable result; and
7. the one-remediation/two-review policy and retained security boundaries remain
   green.
