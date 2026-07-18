<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Roundhouse V2 plan

- Status: Active
- Audience: Maintainers and implementers
- Last updated: 2026-07-17

This is the product contract, architecture decision, transition plan, and
acceptance plan for Roundhouse V2. It supersedes every V1 plan, ADR, manifest,
spike note, and acceptance checklist. When implementation and this document
disagree, either the implementation is wrong or this document must be updated
in the same change.

## 1. Decision

Roundhouse V1 is a successful proof of concept and an unsuitable foundation for
incremental product development.

V1 proved the hard part of the idea: three representative low-risk dogfood
issues completed in 13–16 minutes with no human intervention after start. Each
change was implemented, validated, published, independently reviewed, checked
by exact-head CI, and automatically merged. The reproduced-bug journey included
a failing pre-change reproduction and passing post-change regression.

V1 also showed that its orchestration cost is too high. Business state,
delivery state, evidence state, retry state, and provider state became
interdependent. A single Worker entry point grew to thousands of lines, the
database accumulated stage-specific tables and migrations, internal hashes and
identifiers leaked into ordinary interactions, and dozens of documents
described successive versions of the system. Adding a product behavior often
required changing many schemas and recovery paths.

The V2 decision is a **controlled rewrite in this repository**:

- preserve the product evidence and small, independently useful security
  components;
- replace the orchestration, data model, runner protocol, repository
  configuration, and reviewer loop;
- use Cloudflare Artifacts as the durable Git workspace and agent-handoff
  primitive;
- keep V1 recoverable through Git history and a final tag rather than a
  parallel legacy tree or documentation archive; and
- accept V2 only through maintainer journeys on Roundhouse and at least one
  external open-source repository.

This is not a blank-sheet rewrite of every component. It is a rewrite of the
parts whose coupling made V1 hard to change.

## 2. Product promise

For a clear, eligible open-source bug report, an authorized maintainer starts
Roundhouse once and can walk away. Roundhouse:

1. reads the issue and relevant repository context;
2. asks only questions whose answers materially affect the outcome;
3. attempts to reproduce the reported behavior;
4. records a truthful qualification result, including inability to reproduce;
5. posts its understanding, evidence, implementation plan, and explained risk;
6. waits for plan approval when policy says the plan is risky;
7. implements the approved intent in an isolated workspace;
8. runs repository formatting and validation and repairs failures;
9. obtains all configured independent reviews of the exact candidate commit;
10. repairs actionable review findings and repeats validation and affected
    reviews;
11. observes repository CI on the exact pull-request head; and
12. automatically merges a low-risk passing head, or requests final human
    review when policy does not permit automatic merge.

Ordinary maintainers should see the issue, Roundhouse's current understanding,
evidence, proposed change, checks, risk, and next action. They should not need
to understand runs, attempts, leases, deliveries, model sessions, storage
objects, or internal identifiers.

### 2.1 Clarification is conversation

Clarification happens in the existing issue. A reporter or maintainer answers
in ordinary prose, and the same work item resumes from the new issue snapshot.
Roundhouse may ask multiple focused questions at once, but it should normally
need at most one clarification round.

Clarification content supplies facts, not authority. Any GitHub user may offer
information on a public issue. Only an actor authorized by repository policy
may approve a plan, expand scope, spend additional budget, publish, or merge.

### 2.2 Reproduction precedes the fix plan

Bug reproduction is a first-class stage between qualification and planning. It
must run before Roundhouse presents a plan as validated.

A reproduction result is one of:

- `reproduced`;
- `not_reproduced_missing_information`;
- `not_reproduced_environment`;
- `not_reproduced_intermittent`;
- `already_fixed`;
- `expected_behavior`; or
- `inconclusive_needs_judgment`.

The issue shows the relevant command or procedure, expected behavior, observed
behavior, base commit, and bounded diagnostics. Roundhouse never invents a
reproduction or quietly treats “tests passed” as proof that the report was
reproduced.

When reproduction cannot proceed because information is missing, Roundhouse
asks for it. When the result is already fixed, expected behavior, unsupported,
or genuinely inconclusive, Roundhouse stops with evidence unless an authorized
maintainer explicitly asks it to continue under a revised plan.

Features and maintenance tasks use acceptance-criteria validation instead of a
synthetic reproduction.

### 2.3 Plans express outcomes, not brittle path contracts

A plan includes:

- Roundhouse's understanding of the problem;
- acceptance criteria;
- reproduction or qualification evidence;
- the proposed behavioral change;
- likely areas of the repository;
- the validation strategy;
- known uncertainties;
- risk level and matched risk signals; and
- whether human approval is required.

Likely files are guidance. Repository policy—not a model's predicted file
list—is the enforceable boundary. Discovering that a nearby test or helper must
change is not a plan violation. Crossing a protected path, semantic boundary,
budget, or material scope boundary requires replanning or approval.

## 3. Operating boundary

The first V2 release supports explicitly enrolled public GitHub repositories
with reviewed repository profiles.

In scope:

- GitHub issues, comments, pull requests, checks, reviews, and merge;
- bugs, bounded maintenance tasks, and small features;
- natural-language clarification in the issue;
- repository-aware reproduction and validation;
- low, medium, and high risk classification;
- approval before risky implementation;
- final human review for work not eligible for automatic merge;
- multiple independently configured review roles;
- Cloudflare Containers for isolated execution;
- Cloudflare Artifacts for durable Git workspaces;
- D1 for authoritative workflow state;
- one external open-source repository before V2 acceptance; and
- provider/model routing recorded for every agent attempt.

Not in the first V2 release:

- private or confidential repositories;
- arbitrary unreviewed repositories;
- automatic deployment, rollout, or execution of database migrations;
- customer-grade multi-tenancy or billing;
- a general-purpose workflow engine;
- a marketplace of reviewer plugins;
- a dashboard duplicating GitHub's maintainer experience;
- self-modifying policy, prompts, permissions, or model routing;
- unlimited repair or review loops; or
- claims that automated validation proves a change secure or correct.

Roundhouse's responsibility ends at merge. Repository-owned release and
deployment systems remain outside the product.

## 4. Non-negotiable safety kernel

V2 keeps these boundaries even when doing so costs implementation effort:

1. Verify GitHub webhook signatures before parsing or acting on content.
2. Deduplicate GitHub deliveries and all paid or externally mutating actions.
3. Authorize every consequential action against the authenticated actor and
   the bound repository profile.
4. Bind a run to an enrolled repository and exact base commit.
5. Treat issue text, comments, repository files, commands, test output, model
   output, patches, and review findings as untrusted data.
6. Never provide an agent container with GitHub App credentials, Cloudflare
   administration credentials, deployment credentials, or authority over the
   default branch.
7. Give each attempt only short-lived, least-privilege credentials and bounded
   time, turns, compute, output, disk, and model usage.
8. Keep publication and merge in the trusted control plane.
9. Validate repository policy and expected Git ancestry before publication.
10. Bind validation, review, CI, approval, and merge to the exact current head.
    A new head invalidates gates for the old head.
11. Make cancellation, exhausted limits, ambiguous state, and stale approval
    fail closed with one visible next action.
12. Do not retain credentials, authorization headers, or known secret values in
    prompts, logs, Git commits, D1, R2, GitHub comments, or model output.

The security objective is containment rather than magical prompt-injection
prevention: untrusted input may influence a proposed patch, but it cannot grant
credentials, expand repository authority, mutate a protected branch, merge a
change, or escape the reviewed workflow.

## 5. What V2 takes from V1

### 5.1 Retain as concepts and selectively extract as code

- GitHub webhook verification and delivery deduplication.
- GitHub App authentication and the credentialed publication broker.
- Separation between the control plane and untrusted agent execution.
- Exact base/head identity and exact-head merge gates.
- Repository path policy and actor authorization.
- Bounded, disposable container execution.
- Idempotent attempt identity, durable completion, and reconnection after a
  Worker release or lost caller.
- D1 compare-and-swap lease ownership with one lifecycle authority.
- Secret redaction and bounded command output.
- Validation and replay tests that exercise real failure classes.
- The measured V1 dogfood evidence and latency targets.
- Explicit per-stage model and reasoning-effort selection, recorded in attempt
  evidence and verified against the actual result.

Any V1 file reused in V2 must be small enough to understand independently,
covered by a focused test, and moved behind a V2 contract. V2 will not import
the V1 orchestration as a compatibility layer.

### 5.2 Do not carry forward

- The V1 control-plane entry point and its embedded orchestration.
- Stage-specific lifecycle tables and overlapping state machines.
- R2 patches or evidence bundles as a substitute for a Git workspace.
- Hash ceremonies without a named deduplication, transport-integrity, or
  publication-reconciliation purpose.
- Exact-path plans as implementation authorization.
- Commands requiring users to copy plan IDs, revisions, run IDs, or hashes.
- Hard-coded repository names, URLs, validation commands, or branch rules.
- Hard-coded model literals spread across runners and schemas.
- One fixed “Claude review” record shape or a fixed two-cycle review workflow.
- Infrastructure manifests and evidence logs committed as product
  documentation.
- V1's operator UI until a real V2 maintainer need cannot be met in GitHub.
- Release/deployment orchestration as a Roundhouse product responsibility.

## 6. V2 architecture

V2 has one control-plane deployable, one agent-runner image, one pure core
package, and a small number of managed resources.

```text
GitHub webhook/comment/check
          |
          v
  control-plane Worker
  - verify + authorize
  - update D1 run
  - enqueue one wakeup
          |
          v
  run coordinator <------ D1 (only workflow authority)
          |
          +------> Artifacts (one durable Git repo per run)
          |
          +------> agent Container (one stage attempt)
          |
          +------> GitHub publication / CI / merge
```

Target source layout:

```text
apps/control-plane/       Worker, GitHub adapter, coordinator, D1, queue
packages/core/            pure state transitions, policy, shared contracts
containers/agent-runner/  qualification, reproduction, implementation, review
tests/journeys/           end-to-end scenarios with real contract boundaries
docs/v2-plan.md           this document
```

The precise folders may change once, during transition, if the resulting
boundary is smaller. They must not proliferate into one package per stage.

### 6.1 One coordinator owns progress

A coordinator invocation:

1. loads the run and its revision from D1;
2. determines the single next action from current state and recorded outcomes;
3. reserves that action with a compare-and-swap transition;
4. dispatches an idempotent external operation;
5. records the result if the reservation still matches; and
6. enqueues the run again when another automatic action is ready.

Queue messages are wakeups containing a run ID and expected revision. They do
not own business state, consume retry budgets, or decide that a run is dead.
Duplicate and stale messages are harmless.

A scheduled recovery pass finds expired active reservations and enqueues them.
It uses the same coordinator path; it is not a second recovery state machine.

V2 will not use Cloudflare Workflows or Durable Objects initially. They may be
added only when an observed requirement cannot be met by the D1-plus-Queue
model and the change replaces, rather than duplicates, an existing authority.

### 6.2 Run and attempt model

A **work item** is the enduring GitHub issue. A **run** is one execution of the
V2 workflow against a snapshot of that issue and a repository profile. An
**attempt** is one bounded invocation of a stage, provider, or system action.

The run has two orthogonal fields:

- `status`: `active`, `waiting`, `succeeded`, `failed`, or `cancelled`;
- `stage`: `qualify`, `reproduce`, `plan`, `implement`, `validate`, `review`,
  `publish`, `ci`, or `merge`.

A waiting run also has one reason: `clarification`, `plan_approval`,
`final_approval`, `maintainer_judgment`, `budget`, `external_check`, or
`retry_exhausted`.

This avoids encoding every combination as a new state. State-specific data is
stored in a versioned run document and normalized only when it has a real
query, authorization, or uniqueness requirement.

### 6.3 Minimal D1 model

V2 starts with no more than these seven tables:

| Table          | Purpose                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `repositories` | Enrollment, GitHub identity, active profile version                     |
| `work_items`   | GitHub issue identity and current run                                   |
| `runs`         | Authoritative status, stage, revision, lease, inputs, workspace, budget |
| `attempts`     | Idempotency, stage/role, model routing, timing, outcome, result         |
| `approvals`    | Actor, purpose, run revision, plan or exact head, decision              |
| `events`       | Small append-only audit and diagnostic timeline                         |
| `outbox`       | Idempotent GitHub and Queue side effects awaiting delivery              |

No stage receives its own table merely because its JSON schema is different.
Large query needs must be demonstrated before adding a projection. A migration
that adds a table must name the user journey or operational query requiring it.

D1 stores small structured model outputs, summaries, commands, status, object
references, and costs. It does not store Git repository contents or secrets.

### 6.4 Cloudflare Artifacts is the workspace layer

Cloudflare Artifacts is a required V2 dependency. GitHub remains canonical for
the upstream repository and public pull request; Artifacts is canonical for the
private, durable workspace of an active run.

Each run gets an isolated Artifacts repository containing:

- the exact upstream base commit;
- a stable Roundhouse work branch;
- checkpoint commits produced by successful attempts;
- the exact candidate commit reviewed and validated at each cycle; and
- optional non-secret run metadata attached to commits when useful.

The control plane stores only the Artifacts namespace, repository identity,
expected base, accepted head, and lifecycle timestamps in D1. It never stores a
repo token.

Credential rules:

- mint a short-lived write token only for an authorized implementation or
  repair attempt;
- give reproduction and qualification no write capability unless explicitly
  required for a scratch ref;
- give reviewers a short-lived read token;
- inject the token only after the attempt is authorized;
- redact it from output and never retain it in a remote URL;
- revoke it at completion or cancellation; and
- verify expected ancestry and policy even though the run repo is untrusted
  agent output.

Use separate namespaces for development and production. Names use opaque run
identifiers, not issue titles or user-controlled text. One run repo has one
active writer at a time. Reviewers may read concurrently after the candidate
head is fixed.

Artifacts replaces V1's R2 patch bundles and cross-container workspace
handoffs. A new container clones the run repo and reconnects to the accepted
checkpoint after loss or deployment. Reviewers inspect the exact Git commit.
Remediation creates a new commit and naturally invalidates old gates.

R2 is optional. It may hold screenshots, large raw logs, binary fixtures, or
other non-Git payloads that exceed bounded D1 records. V2 does not provision or
depend on R2 until a supported journey produces such a payload. R2 never owns
run state or source handoff.

The first Artifacts integration test must prove:

1. create or import a public repository baseline;
2. establish the exact requested base commit;
3. create an isolated run repository;
4. clone and push with a short-lived write token;
5. clone the fixed head with a read-only review token;
6. lose the first container and resume from the same commit in another;
7. reject an unexpected head, ancestry, or protected-path change;
8. revoke both token scopes;
9. observe idempotent create/reconnect behavior; and
10. delete the run repository under the retention policy.

This validates our use of Artifacts; adoption is not conditional on the test
outcome. A failing item is an integration defect or a workflow assumption to
correct.

Relevant Cloudflare documentation:

- [Artifacts overview](https://developers.cloudflare.com/artifacts/)
- [How Artifacts works](https://developers.cloudflare.com/artifacts/concepts/how-artifacts-works/)
- [Artifacts best practices](https://developers.cloudflare.com/artifacts/concepts/best-practices/)
- [Workers binding](https://developers.cloudflare.com/artifacts/api/workers-binding/)
- [Git protocol and token scopes](https://developers.cloudflare.com/artifacts/api/git-protocol/)
- [Limits](https://developers.cloudflare.com/artifacts/platform/limits/)
- [Pricing and explicit deletion](https://developers.cloudflare.com/artifacts/platform/pricing/)

### 6.5 Agent runner

One runner image supports stage modes through a narrow request/result contract.
The runner does not know D1, GitHub App credentials, approval state, or merge
policy. It receives:

- attempt and run identities;
- stage mode and role;
- Artifacts remote plus the least-privilege token;
- exact base or candidate commit;
- immutable repository-profile snapshot;
- bounded issue, plan, reproduction, and prior-finding context;
- selected provider, model, and reasoning effort;
- permitted command classes and network destinations; and
- resource and output limits.

The result includes exact input and output commits, structured outcome,
commands and exit results, bounded diagnostics, changed paths, actual model
routing, timing and available usage, retry classification, and a redacted
human summary.

The runner may not publish to GitHub or decide the next workflow stage.

### 6.6 Model routing is policy

The inspected V1 routing work is committed as `23e30bc`. It pinned planning,
implementation, and review to explicit model-plus-effort pairs and recorded
them in evidence. V2 keeps that behavior but removes model literals from stage
schemas and runner branches.

The active Roundhouse policy contains a versioned routing map:

```yaml
models:
  qualification: { provider: openai, model: ..., effort: medium }
  reproduction: { provider: openai, model: ..., effort: medium }
  planning: { provider: openai, model: ..., effort: medium }
  implementation: { provider: openai, model: ..., effort: medium }
  reviewers:
    code-quality: { provider: anthropic, model: ..., effort: medium }
```

The resolved policy is snapshotted onto the run. An attempt binds provider,
model, effort, prompt version, and tool-policy version atomically. Its result
must report the actual routing; a mismatch fails visibly and cannot satisfy a
gate.

In-flight attempts keep their original snapshot. A policy edit affects new
runs or an explicitly restarted stage, never silently reinterprets old
evidence.

The control plane enforces reviewer independence. At minimum, a required
reviewer uses a different provider/model family from implementation unless
repository policy records a temporary exception.

## 7. Workflow behavior

### 7.1 Qualification

Qualification classifies the request as bug, feature, maintenance, duplicate,
already satisfied, unsupported, or unclear. It reads the profile and only
enough code and history to identify acceptance criteria and a reproduction
strategy.

It asks no question answerable from the issue, repository, or supplied public
GitHub context.

### 7.2 Reproduction

For bugs, a read-oriented attempt executes the smallest safe procedure that can
demonstrate the report. Installation and network access follow the repository
profile; they are not improvised by the model.

A successful reproduction records a regression strategy that validation must
run after implementation. A change cannot receive the “fix validated”
recommendation unless that regression passes on the candidate, or a maintainer
approved an explicit non-reproduction path.

### 7.3 Planning and risk

Risk is the more restrictive of deterministic policy and model-assisted
semantic assessment. The model explains risk but cannot lower a deterministic
floor.

Default floors:

- **High:** authentication, authorization, access control, cryptography,
  credentials, security boundaries, billing, data deletion, database schema or
  migrations, CI/release/deployment authority, Roundhouse policy, or a
  broad/uncertain blast radius.
- **Medium:** dependencies and lockfiles, public APIs, persistent data formats,
  concurrency, cross-service contracts, performance-sensitive paths, or a
  change larger than repository low-risk thresholds.
- **Low:** narrow behavior with a demonstrated regression, local tests, no
  protected signals, and bounded rollback.

Repository policy may elevate risk and add protected areas. It cannot lower
Roundhouse's non-overridable global floors.

| Risk   | Before implementation | Before merge         | Automatic merge                  |
| ------ | --------------------- | -------------------- | -------------------------------- |
| Low    | No approval           | No approval          | Yes, after every exact-head gate |
| Medium | Plan approval         | Final human approval | No                               |
| High   | Plan approval         | Final human approval | No                               |

An approval binds plan revision, profile version, base commit, scope, and risk.
Material change invalidates it. Final approval binds the exact reviewed,
validated, CI-passing head.

### 7.4 Implementation and validation

Implementation starts at the accepted Artifacts checkpoint and seeks the
smallest complete change satisfying the approved outcome.

Validation is profile-defined and layered:

1. formatter in write mode when supported;
2. diff and repository-policy validation;
3. reproduced-bug regression or targeted acceptance test;
4. lint/static analysis/typecheck/build selected by changed paths;
5. targeted tests; and
6. full local validation when the profile or risk requires it.

Mechanical failures return to implementation with exact diagnostics and a
bounded retry budget. A repair produces a new commit and reruns affected
validation. The model cannot relabel a failed command as success.

GitHub required checks remain the authoritative repository-wide validation on
the published exact head.

### 7.5 Independent reviewers

Review is a list of configured roles, not a single hard-coded stage record.
Initial production policy requires one independent code-quality reviewer. The
contract supports later security, compliance, architecture, performance,
accessibility, and repository-specific reviewers without adding workflow
states or database tables.

Each reviewer declares:

- stable role ID and human label;
- provider, model, effort, and prompt version;
- inputs and tool permissions;
- changed-path or risk conditions activating it;
- finding severities it may block;
- which outcomes require rerun; and
- per-reviewer attempt and remediation limits.

Every reviewer examines the exact candidate, approved plan, reproduction,
validation, and relevant repository policy. Findings have a stable fingerprint,
severity, location when available, explanation, and proposed acceptance test.

The coordinator aggregates required outcomes:

- no blocking findings: pass that reviewer for the exact head;
- actionable in-scope findings: create one remediation batch with all current
  findings;
- scope/risk expansion: replan and request approval;
- duplicate or dispositioned findings: record without another loop;
- exhausted or conflicting findings: wait for maintainer judgment.

After remediation, validation runs first, then every reviewer affected by the
new head reruns. No reviewer can approve its own remediation, merge, grant
capabilities, change risk policy, or silently widen scope.

The loop is bounded by policy and cost, but the data model does not hard-code
“two cycles.” The initial default is two remediation batches and three attempts
per reviewer. Exhaustion produces a useful `needs_changes` result.

### 7.6 Publication, CI, and merge

The trusted publication broker:

1. reads the accepted commit from the Artifacts run repository;
2. verifies ancestry, paths, size, profile, risk, approvals, validation, and
   reviewer gates;
3. creates or updates a constrained GitHub App branch;
4. opens or updates one pull request;
5. confirms GitHub's head is exactly the candidate; and
6. records publication idempotently.

A new head invalidates old CI, reviews, and final approval. Roundhouse waits for
required GitHub checks on the exact head. Failures may receive one bounded,
in-scope diagnosis and repair loop.

The final pull-request package shows:

- source issue and accepted understanding;
- before/after reproduction or approved exception;
- plan and material deviations;
- changed behavior and important files;
- local validation and GitHub CI;
- each required reviewer and finding dispositions;
- risk signals, blast radius, rollback, and residual risk; and
- one recommendation: `merge_automatically`, `awaiting_final_approval`,
  `needs_changes`, `needs_maintainer_judgment`, or `do_not_merge`.

Before automatic merge, the control plane re-reads the pull request, approvals,
checks, and exact head. Ambiguity, conflict, stale gates, or a changed head
stops the merge.

## 8. Repository profile

Enrollment points Roundhouse to one reviewed, versioned profile in the target
repository. The initial schema contains only:

- repository identity and default branch;
- authorized actor roles;
- allowed/protected path and semantic risk rules;
- reproduction and validation commands with timeouts;
- permitted package-install behavior and egress destinations;
- resource, model, retry, and output budgets;
- required reviewers and activation conditions;
- automatic-merge policy; and
- retention periods.

Profiles are data, not executable control-plane code. Commands use argument
arrays or reviewed repository scripts; the control plane does not concatenate
model output into a shell.

Profile edits apply only to new runs unless a maintainer explicitly restarts a
waiting run under the new version. Changing the profile is high risk.

## 9. Failure and recovery contract

Every failure is classified as transient infrastructure/provider,
deterministic agent/result failure, validation/review finding, policy or
authorization block, budget exhaustion, stale/conflicting external state, or
internal invariant violation.

Only transient failures retry automatically, with bounded exponential delay.
Deterministic failures return useful diagnostics to an implementation or human
decision loop. Internal invariant violations stop; they do not “try another
model.”

Attempt dispatch uses a stable idempotency key. Before paid work, the runner
checks for an existing durable completion and active handle. A replacement
Worker reconnects to the same handle or reads its completed result. It never
starts a second paid invocation merely because the caller changed.

Test these outcomes:

- duplicate webhook and Queue delivery;
- lost response after an external mutation;
- Worker release during an active attempt;
- container loss after an Artifacts checkpoint;
- provider timeout and rate limit;
- GitHub read, publication, check, and merge failures;
- cancellation during every model-using stage;
- stale approval and changed pull-request head; and
- exhausted, ambiguous, or corrupted state stopping safely.

## 10. Maintainer experience and observability

GitHub is the initial interface. One issue status comment and one pull-request
summary are updated in place. New comments are reserved for questions,
approvals, terminal outcomes, or information that cannot be surfaced by
updating an existing artifact.

While active, status shows the plain-language stage, elapsed time, last useful
progress, whether action is needed, the exact requested action, and a pull
request link when one exists.

Initial metrics:

- journey outcome and failure classification;
- stage and end-to-end latency;
- human interventions;
- attempts, retries, and duplicate suppression;
- provider/model/effort and available usage/cost;
- validation and reviewer finding rates;
- recovery time;
- pull-request acceptance and merge outcome;
- Artifacts repository age/storage and cleanup failures; and
- stale or ambiguous actions rejected.

An operator should diagnose a failed run from its event timeline and attempts
without inspecting raw D1 tables, Queue messages, or container internals.

## 11. Complexity budget

The budget is a product requirement:

- one Worker deployable;
- one runner image;
- one D1 database;
- one Queue plus dead-letter queue;
- one Artifacts namespace per environment;
- no required R2 bucket initially;
- at most seven initial D1 tables;
- one lifecycle owner;
- no per-stage infrastructure service;
- no compatibility layer for V1 workflows;
- no runtime source file larger than roughly 800 lines without explicit review;
- no user-facing internal IDs or hashes in routine commands;
- no abstraction until there are two implementations or a boundary that must
  be faked in journey tests; and
- no feature work without a named maintainer journey and exit test.

When a proposal exceeds this budget, simplify the proposal rather than silently
amend the architecture.

## 12. Transition and implementation sequence

Work proceeds in vertical slices. A phase is complete only when its exit gate
passes; merged scaffolding without the journey is not progress.

### Phase 0 — Freeze V1 and reset the repository

Phase 0 completed on 2026-07-17 with these fixed boundaries:

- the final deployed V1 baseline is `f922198`, preserved as
  `v1-poc-final`;
- V2 development happens on `codex/v2`, based on that deployed baseline;
- the unmerged routing implementation at `23e30bc` remains on its original
  branch as reference and is not part of the V2 code base;
- GitHub's `Release development` and `Promote production` workflows are
  disabled, and the pending V1 production promotion was cancelled;
- ordinary `CI` remains enabled and runs for pull requests and direct pushes
  to `codex/v2`; and
- no Cloudflare resource is deleted or repurposed. Any new V2 resource must
  use a `v2` namespace in its name and route.

The V2 branch now contains only the target runtime skeleton:

- `packages/core` for pure run-state contracts;
- `apps/control-plane` for the V2-namespaced Worker; and
- `containers/agent-runner` for the non-root runner image.

No V2 module imports or wraps V1 orchestration code. Cloudflare resources will
be created only when Phase 1 has a component that uses them.

Actions:

1. Tag the final V1 proof-of-concept commit.
2. Create the V2 development branch. V1 production remains support-only until
   cutover.
3. Disable release deployment from the V2 branch.
4. Make this plan and the README the only current documentation.
5. Delete V1 plans, ADRs, manifests, spikes, and evidence; recover them from the
   tag or Git history if needed.
6. Record the final V1 routing commit and reapply its policy ideas through the
   V2 core rather than retaining its cross-cutting code.
7. Remove V1 runtime code from the V2 branch as small retained components are
   extracted into the target layout.

Exit gate:

- the V2 branch has one obvious product plan;
- V1 remains recoverable and its production deployment is unchanged;
- the target tree builds a minimal Worker and runner;
- no V2 module imports V1 orchestration code.

### Phase 1 — Executable core and Artifacts workspace

Actions:

1. Define pure run, attempt, approval, reviewer, risk, and transition contracts
   in `packages/core`.
2. Implement the seven-table D1 schema and in-memory/D1 adapters.
3. Implement the coordinator with one wakeup queue and revision-bound leases.
4. Integrate Artifacts creation/import, scoped tokens, clone/push, checkpoint
   validation, reconnection, and cleanup.
5. Exercise the ten-item Artifacts integration test from section 6.4.
6. Use fake GitHub and runner adapters to execute one clear low-risk journey
   deterministically.

Exit gate:

- replay produces the same transitions and side effects;
- duplicate wakeups create no duplicate attempt or publication;
- another container resumes the exact Artifacts checkpoint;
- only D1 decides lifecycle state;
- schema and resources stay inside the complexity budget.

### Phase 2 — Qualification, clarification, and reproduction

Actions:

1. Connect real GitHub webhook verification, issue snapshots, authorization,
   status updates, and comment ingestion.
2. Implement the minimal profile and enrollment validation.
3. Run real qualification and reproduction attempts.
4. Support one natural-language clarification round and same-run resumption.
5. Produce an evidence-backed plan with deterministic risk floors.
6. Bind and enforce medium/high plan approval.

Exit gate:

- one clear bug is reproduced before its plan;
- one unclear bug asks a useful question and resumes after one answer;
- one non-reproducible or already-fixed report stops truthfully;
- one risky plan cannot dispatch implementation without valid approval;
- no interaction requires an internal identifier.

### Phase 3 — Implementation and self-repairing validation

Actions:

1. Implement the runner contract and immutable routing snapshot.
2. Give implementation a short-lived Artifacts write token.
3. Commit candidate changes and verify ancestry and repository policy.
4. Implement profile-selected formatting, targeted validation, and promotion
   to full validation.
5. Feed mechanical failures into bounded repair and rerun affected checks.
6. Publish a draft pull request through the trusted broker; do not merge yet.

Exit gate:

- one reproduced bug reaches a draft PR with a passing regression;
- formatter and targeted-test failures repair without human action;
- an out-of-policy patch is rejected before publication;
- container/caller recovery creates no duplicate paid attempt or branch;
- GitHub credentials never enter the runner.

### Phase 4 — Pluggable adversarial review

Actions:

1. Implement the reviewer registry and normalized finding contract.
2. Configure one required reviewer using a different provider/model family from
   implementation.
3. Aggregate findings, fingerprint duplicates, and create one remediation batch
   per candidate head.
4. Rerun validation and affected reviewers on the repaired head.
5. Exercise a second fake reviewer role in journey tests to prove that a new
   role needs configuration and an adapter, not workflow/schema changes.

Exit gate:

- clean review passes the exact candidate;
- a seeded blocking finding is fixed, validated, and reviewed again;
- scope expansion waits for replanning and approval;
- duplicate findings terminate rather than loop;
- exhausted/conflicting reviewers produce one useful human decision.

### Phase 5 — Exact-head CI and risk-aware merge

Actions:

1. Observe required GitHub checks for the exact published head.
2. Add bounded in-scope CI diagnosis and repair.
3. Build the final merge-decision package.
4. Enable automatic merge only for low-risk work.
5. Bind medium/high final approval to the exact passing head.
6. Re-read all gates immediately before merge and record the merge commit.

Exit gate:

- low-risk work merges without intervention after all gates;
- medium/high work cannot merge without final approval;
- stale CI, review, approval, conflict, or changed head blocks merge;
- final GitHub status is concise and truthful.

### Phase 6 — Resilience, external pilot, and cutover

Actions:

1. Run the section 9 failure scenarios against development.
2. Enroll one external public repository without Roundhouse source changes.
3. Run the acceptance set below on one release candidate.
4. Measure intervention, latency, model usage, findings, recovery, and cleanup.
5. Obtain explicit maintainer acceptance that the workflow is useful.
6. Replace V1 on the default branch, deploy V2, and retain the V1 tag.
7. After the retention window, delete V1 Cloudflare resources and old
   Artifacts/R2 data from an explicit inventory.

Exit gate:

- all release journeys pass;
- no severity-1 or severity-2 product or boundary defect remains;
- the external maintainer says the system saves more effort than it creates;
- V1 has no active run before resource retirement;
- current docs remain only the README and this plan.

## 13. Release acceptance set

One V2 release candidate must demonstrate:

1. **Clear low-risk bug:** reproduced, planned, implemented, repaired if needed,
   reviewed, exact-head CI passed, and automatically merged with no human action
   after start.
2. **Clarified bug:** one useful clarification round resumes the same work item
   and reaches a supported outcome.
3. **Cannot reproduce:** accurate evidence and a truthful stop or maintainer
   decision, with no invented fix.
4. **Risky change:** deterministic signals force plan and final approval; stale
   approval is rejected.
5. **Validation repair:** seeded formatter, lint/typecheck/build, and targeted
   test failures are repaired and rerun.
6. **Adversarial repair:** an independent reviewer finds a substantive defect;
   the new head is validated and reviewed again.
7. **Multiple reviewers:** two roles aggregate correctly in a journey test
   without a new workflow state or migration.
8. **Recovery:** duplicate delivery, Worker release, lost response, and
   container replacement resume without duplicate work or publication.
9. **Boundary attack:** malicious issue/repository/review text cannot acquire a
   credential, expand policy, approve, publish outside the branch namespace, or
   merge.
10. **External repository:** clear bug, clarification, risky-plan, and
    review-remediation behavior works through configuration rather than
    Roundhouse source changes.

| Measure                                            | Target                             |
| -------------------------------------------------- | ---------------------------------- |
| Durable start acknowledgement                      | p95 ≤ 5 seconds                    |
| First useful status                                | p95 ≤ 10 seconds                   |
| Clear issue to initial plan                        | p50 ≤ 5 minutes; p95 ≤ 10 minutes  |
| Clear low-risk issue to pull request               | p50 ≤ 30 minutes; p95 ≤ 60 minutes |
| Clear low-risk issue to merge                      | p50 ≤ 45 minutes; p95 ≤ 90 minutes |
| Active silence without useful status               | Never more than 2 minutes          |
| Low-risk human interventions after start           | 0                                  |
| Duplicate paid attempts/publications               | 0                                  |
| Exact-head gate bypasses                           | 0                                  |
| Seeded authorization/boundary escapes              | 0                                  |
| Artifacts repos past retention without disposition | 0                                  |

Latency includes Roundhouse's retries and waiting. Unrelated GitHub-hosted
runner queue time may be reported separately but never hidden.

## 14. Documentation and decision policy

The maintained documentation set is:

- `README.md`: what Roundhouse is, current status, local checks, and this link;
- `docs/v2-plan.md`: product, architecture, decisions, plan, and acceptance.

There is no in-repository V1 archive. Git history and the final V1 tag are the
archive.

Do not add a standalone ADR, manifest, spike report, evidence log, checklist,
or operator note by default. Instead:

- durable product/architecture decisions update the relevant section here;
- experiments live in their issue or pull request and leave their decision
  here;
- live evidence stays on the issue, pull request, check run, or telemetry;
- routine current operator commands belong in the README; and
- Cloudflare resource configuration belongs with executable configuration,
  not prose manifests.

A new document is justified only when it has a distinct long-lived audience,
an owner, and a maintenance path that these two documents cannot serve. Its
pull request must explain why updating this plan is insufficient.

## 15. Decision log

This compact log replaces standalone ADRs.

| Date       | Decision                                                                            |
| ---------- | ----------------------------------------------------------------------------------- |
| 2026-07-17 | Treat V1 as a proven POC and rewrite its orchestration for V2.                      |
| 2026-07-17 | Keep the V1 control/execution credential boundary and exact-head gates.             |
| 2026-07-17 | Use D1 as the only workflow authority and Queue only as wakeups.                    |
| 2026-07-17 | Use one Artifacts repository per run for workspace and handoff.                     |
| 2026-07-17 | Keep R2 optional for non-Git oversized/binary payloads.                             |
| 2026-07-17 | Make reviewers data-driven; initially ship one independent code-quality reviewer.   |
| 2026-07-17 | Make provider/model/effort routing versioned policy and immutable attempt evidence. |
| 2026-07-17 | Auto-merge only low risk; medium/high receives plan and final review.               |
| 2026-07-17 | Keep only the README and this plan as normative documentation.                      |
