<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Roundhouse V2

- Status: Active
- Audience: Maintainers and implementers
- Last updated: 2026-07-27

This is the current product, architecture, and implementation plan for
Roundhouse V2. Git history and the `v1-poc-final` tag preserve earlier designs
and completed migration work; this document intentionally does not.

## 1. Product and development rule

Roundhouse turns an issue in an explicitly enrolled public GitHub repository
into a validated change. An authorized maintainer starts it once. Roundhouse
then:

1. qualifies the request and asks only material questions;
2. investigates current behavior and reproduces bugs when possible;
3. proposes an evidence-backed plan;
4. implements the change in an isolated repository development environment;
5. validates and independently reviews the exact candidate;
6. repairs actionable failures and findings;
7. integrates the current target branch;
8. observes GitHub CI on the exact pull-request head; and
9. merges automatically or leaves the pull request for a maintainer, according
   to repository policy.

Clarification happens as ordinary issue conversation. It has no special answer
command and no arbitrary round limit. Any participant may supply facts; only a
configured operator may start or resume a run or authorize a consequential
decision.

Roundhouse is a functional prototype. We build the smallest complete journey,
observe it, and then address demonstrated failures. We do not pre-build retry
limits, spend governors, abuse systems, recovery machinery, generalized policy,
or other hardening for imagined failures. We will replace a bad boundary
instead of layering compensating hacks on it.

Repository-defined workflow composition is approved product work, not
speculative hardening. It lets repositories express real differences in their
development processes while Roundhouse retains a small security kernel.

## 2. Deployed behavior

The development deployment currently supports:

- GitHub issue intake, comments, pull requests, checks, and merge;
- public repositories enrolled through the Roundhouse GitHub App and a
  repository-owned Profile V2;
- bugs, maintenance tasks, and small features;
- natural-language clarification and resumption from every waiting state;
- hosted public research for qualification, investigation, and planning;
- durable Git workspaces and implementation checkpoints;
- repository Dev Containers inside isolated Cloudflare Sandboxes;
- repository validation commands and screenshot evidence;
- a holistic reviewer with conditional security and data reviewers;
- remediation, target-branch integration, exact-head CI, and automatic or
  maintainer merge;
- a GitHub-facing status conversation and a Roundhouse dashboard; and
- structured boundary, command, model, API-response, timing, and lifecycle
  logging.

The current lifecycle runs through a compiled repository workflow graph.
Profile V2 configures validation, merge behavior, operators, paths, project
instructions, and the development environment.
Workflow agent nodes configure typed inputs, result schemas, prompts, models,
capabilities, conditions, and edges. Review nodes configure generic
always-on/selected reviewers, blocking/advisory/shadow modes, prompts, models,
severity policy, and exact-head-bound fan-out/join evidence.

Current intentional limitations:

- only explicitly enrolled public repositories are supported;
- investigation and implementation have project network access inside their
  isolated Sandboxes so repository image builds, dependency installation,
  lifecycle commands, and public research can work in the repository's actual
  development environment;
- qualification, planning, and review use restricted access plus
  capability-gated broker-mediated hosted research;
- risk and approval types exist in old core/schema work but are not active
  product behavior;
- Roundhouse currently begins with an issue start and finishes at merge; and
- deployment observation, production monitoring, organizational knowledge,
  SIEM export, repository-defined triggers, and repository-supplied executors
  are not implemented.

## 3. Target workflow architecture

The lifecycle is a repository-defined declarative workflow graph. It is a state
machine rather than a strict DAG: branches, joins, human
waits, clarification, validation, review, and repair may return to earlier
nodes without an arbitrary traversal count.

```text
authenticated trigger
        |
        v
profile + workflow compiler ---- rejects invalid authority or routes
        |
        v
 D1 coordinator/interpreter <---- immutable node results and external events
        |
        +---- Roundhouse-owned agent/read/write/review executors
        +---- deterministic validation and GitHub executors
        +---- human waits and approved external adapters
        |
        v
 declared terminal outcome
```

The repository chooses composition. Roundhouse chooses what each executor is
capable of doing.

### 3.1 Repository source and compilation

The repository owns:

- `.roundhouse/profile.yaml` for enrollment policy, operators, paths, merge
  defaults, development environment, validation definitions, and maximum
  repository-granted capabilities;
- `.roundhouse/workflow.yaml` for triggers, nodes, prompts, models, schemas,
  conditions, and outcomes; and
- referenced prompts and schemas under `.roundhouse/**`.

Roundhouse loads these files from one exact commit, normalizes and validates
them, resolves references, computes a hash, and snapshots the compiled workflow
onto the run. An active run is never reinterpreted under changed repository
configuration.

The workflow source contains:

- typed triggers and a start node for each trigger;
- stable node IDs and Roundhouse-owned executor kinds;
- typed input selectors and structured output schemas;
- optional prompts, models, context providers, and reduced capabilities;
- ordered conditional transitions with a required fallback; and
- explicit terminal outcomes.

Conditions are data, not executable policy. Initial operators cover boolean
composition, existence, equality, membership, and ordered comparisons over
declared outputs and deterministic signals. Conditions cannot execute code,
shell commands, functions, network requests, or secret lookups.

Compilation rejects unknown types, invalid references, unreachable required
nodes, non-terminal dead ends, undeclared output paths, capability escalation,
model-controlled bypass of deterministic gates, inexact publication or merge,
write-capable reviewers, model-capable mechanical GitHub mutations, and
references outside `.roundhouse/**`.

### 3.2 Typed executors

Repositories compose these executor kinds within fixed maximum authority:

| Kind                      | Maximum authority                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `agent.read`              | Read an exact checkpoint; optionally run project commands, use project network, and capture previews; no durable Artifact mutation |
| `agent.write`             | Write an isolated Artifacts checkpoint; no GitHub mutation                                                                         |
| `review`                  | Read an exact candidate and return structured findings                                                                             |
| `validate`                | Run deterministic commands and return exact results                                                                                |
| `human`                   | Wait for clarification or an authenticated decision                                                                                |
| `github.publish`          | Publish a validated exact candidate                                                                                                |
| `github.checks`           | Observe checks for the exact published head                                                                                        |
| `github.merge`            | Merge an exact head after required gates                                                                                           |
| `external.wait` / `check` | Use one separately enabled, named, scoped adapter                                                                                  |
| `fanout` / `join`         | Coordinate typed child attempts; no external authority                                                                             |
| `terminal`                | Record a declared outcome                                                                                                          |

The first graph supports only the existing authenticated
`github.issue.started` trigger. The trigger contract also accommodates later
reviewed pull-request, deployment, alert, or scheduled adapters without
changing the graph representation.

Context providers are named, typed, read-only, and attributable. The initial
set exposes repository files, GitHub issue and pull-request context, prior node
outputs, the current diff, profile data, and broker-mediated public research.
Future providers may expose indexed organizational policy, architecture,
ownership, incidents, or bounded logs. A workflow cannot name an arbitrary
plugin, MCP server, URL, or secret as a provider.

### 3.3 Durable execution

D1 is the only workflow authority. Queue messages contain a run ID and expected
revision and serve only as wakeups. Every active run revision atomically
creates or reopens a D1 outbox record. Queue delivery may be duplicated or
lost temporarily without losing the work: the consumer completes that outbox
record only after the revision becomes inactive or a durable attempt owns it,
and the scheduled reconciler republishes pending records.

One Cloudflare Workflow instance owns the transport lifetime of each Sandbox
attempt. Its durable steps restore the prepared workspace, keep the runner
request attached until the executor returns a completion, record that
completion in D1, validate it, attempt an optional workspace backup, publish it
idempotently, accept it, and release the Sandbox. Once D1 records an attempt as
`executed`, recovery can resume only the settlement steps; it cannot invoke the
model again. If execution is interrupted before a completion is recorded, D1
records a typed interruption outcome and the coordinator issues a new
revision-bound attempt automatically. A rejected checkpoint similarly returns
to the same workflow node with the rejection evidence. If publication observes
that the pull-request branch has moved, the coordinator accepts that observed
head, invalidates stale review and integration evidence, and returns through
implementation to reconcile it. Workspace backup improves continuation speed
but is not a correctness boundary: the Artifacts checkpoint and Git commit
remain authoritative when backup is unavailable. The Cloudflare Workflow does
not choose nodes, transitions, or product outcomes.

Attempt acquisition writes the run lease and attempt in one D1 transaction.
The lease records both the logical attempt and the current Cloudflare Workflow
instance, since settlement recovery may use a different Workflow instance
without rerunning the model. A top-level Workflow failure records a typed
interruption immediately when execution has not completed. The scheduled
reconciler also observes every active Workflow transport, resumes settlement
for recorded executions, and reconciles terminal or inactive transports
independently so one broken recovery cannot prevent other runs from moving.
GitHub checks and merge waits retain pending outbox records and are polled until
GitHub supplies the external outcome.

For each node execution the coordinator:

1. loads the run revision and immutable workflow snapshot;
2. resolves typed inputs from durable outputs;
3. reserves the execution with compare-and-swap;
4. dispatches an idempotent executor operation;
5. records a result only while the reservation still matches;
6. evaluates ordered conditions;
7. records the selected edge; and
8. activates the destination or terminal outcome.

A work item is the enduring external subject. A run is one execution of a
compiled workflow against an immutable trigger, profile, and workflow snapshot.
An attempt is the durable record of one node execution. It stores the
coordinator-minted effective capability set and any typed executor outcome;
fan-out attempts may own typed child attempts.

A waiting run records a typed requested action or external event declared by
the workflow.
Resumption follows the workflow edge recorded for that node and never attempts
to reconstruct a stage from current source configuration or comment wording.

The interpreter replaces the compiled lifecycle switch. Development may reset
D1 for the migration, and all enrolled development repositories will migrate
together. Roundhouse will not operate old and new workflow runtimes in
parallel.

## 4. Security kernel

Workflow configuration may reduce authority but cannot change these rules:

1. Authenticate GitHub webhooks before acting on content.
2. Deduplicate deliveries and paid or externally mutating actions.
3. Authorize consequential actions against the actor and bound profile.
4. Bind every run to an enrolled repository and exact base commit.
5. Treat issues, comments, repository content, tool output, model output,
   patches, reviews, and research as untrusted data.
6. Never give an agent GitHub App, Cloudflare administration, deployment,
   default-branch, or model-provider credentials.
7. Use short-lived, least-privilege attempt credentials.
8. Keep publication and merge in the trusted control plane.
9. Validate ancestry, allowed and protected paths, and exact candidate identity
   from a clean environment before publication.
10. Bind validation, review, CI, human gates, publication, and merge to the
    exact relevant head; a new head invalidates old gates.
11. Fail closed on cancellation, ambiguity, stale decisions, or changed heads
    with one visible next action.
12. Never persist credentials or known secret values in prompts, logs, Git,
    D1, R2, GitHub, or model output.
13. Snapshot the exact workflow and referenced policy files.
14. Reject any repository request for unknown or excessive authority.
15. Record every transition, condition result, capability set, workflow hash,
    timing, outcome, and exact commit where applicable.
16. Never let a model-derived route bypass a deterministic requirement.

Containment is the objective. Prompt injection may influence a proposed patch;
it must not grant credentials, expand authority, publish outside the constrained
branch, mutate protected policy, merge, deploy, or escape the reviewed
workflow.

The foundation deliberately excludes repository-supplied executor code,
arbitrary plugins, arbitrary agent-to-agent communication, automatic mutation
of protected Roundhouse policy, and deployment credentials in agent
containers. Those are authority expansions rather than missing graph features.

## 5. Runtime boundaries

### 5.1 Control plane and storage

One Cloudflare control-plane Worker owns GitHub intake, authorization, workflow
progress, publication, checks, merge, and the dashboard. A separately deployed
runtime-host Worker owns the Cloudflare Sandbox Durable Objects and container
image. The control plane reaches those objects through a typed cross-Worker
Durable Object binding; there is no second workflow protocol or lifecycle
authority. This deployment boundary lets control-plane changes ship without
replacing active coding environments, while runtime and image changes still
roll forward deliberately.

D1 stores lifecycle state and small structured results, including the durable
wakeup outbox and current attempt transport owner. One at-least-once Queue
wakes the coordinator; the outbox and scheduled reconciliation make Queue
delivery a transport detail rather than workflow authority. Runtime-host
Durable Objects exist only where the Cloudflare Sandbox/Container lifecycle
requires them; they do not own workflow state.

Cloudflare Workflows provide the durable execution context for the generic
restore-execute-settle Sandbox boundary. They do not mirror D1 run state or
implement repository workflow composition.

Cloudflare Artifacts is the durable Git workspace for each run. It stores the
exact upstream base, stable work branch, successful checkpoints, and exact
candidate commits. The control plane stores identities and commit references,
not repository contents or credentials. A new Sandbox can restore an active run
from the accepted checkpoint.

R2 stores screenshots, workspace backups, and other non-Git evidence when
needed. It does not own workflow state.

### 5.2 Agent environment

The outer Cloudflare Sandbox VM is the isolation boundary. For investigation
and implementation, Roundhouse adapts the repository's image-based Dev
Container inside that Sandbox. The Dev Container provides compatibility, not
another security boundary: repository lifecycle commands and the agent share
the outer Sandbox's authority.

Implementation receives a short-lived Artifacts writer, never a GitHub
credential. Investigation may execute commands, use project network access,
and capture previews, but receives only Artifacts read authority. Review and
other read-only work receive only read authority. A separate clean validation
Sandbox verifies Git ancestry and path policy before the trusted control plane
publishes anything.

Implementation workspaces, dependency caches, volumes, and application data can
be backed up before compute is destroyed and restored for later revisions.
Browser Rendering reaches an active application through a capability-protected
preview route and stores screenshots as run evidence.

### 5.3 Models

A private model broker authorizes each snapshotted route and invokes AI Gateway
Unified Billing. The runner uses Pi as a provider-neutral harness with native
OpenAI Responses, OpenAI Chat Completions, Anthropic Messages, or Google
Generative AI protocols. The broker does not translate conversation history.

Each attempt records provider, model, reasoning level, prompt version, effective
capabilities, actual route, timing, and available usage. The project
environment receives no provider credential. Hosted research is attached only
when the attempt has `research.public`, independent of its role name. In-flight
attempts keep their original route and capability snapshot.

## 6. Repository policy and human interaction

The deployed Profile V2 defines:

- explicit allowed and protected paths;
- operators by repository permission, GitHub user, or GitHub team;
- automatic or maintainer merge and merge method;
- an optional Dev Container configuration;
- repository-wide instructions;
- workflow agent prompts, models, typed inputs, and result schemas;
- workflow reviewer prompts, models, activation, operating modes, and blocking
  severities; and
- validation commands as argument arrays.

Roundhouse always protects `.roundhouse/**` and the selected Dev Container
configuration. Repository instructions cannot override isolation, tool,
read-only, credential, or result-submission rules.

Operators may start and explicitly resume Roundhouse. Ordinary participants may
answer a clarification while the run waits. GitHub permissions remain the
authority for a human merge. Under maintainer merge mode, Roundhouse leaves a
clean CI-passing pull request and completes when GitHub reports its merge.

The dashboard visualizes the compiled workflow graph and configuration revision
from the latest immutable run snapshot. Its editor validates changes with the
production compiler, then hands the repository-file proposal to GitHub's
authenticated branch and pull-request flow. D1 is not a second configuration
authority.

## 7. Default issue-to-merge workflow

The initial repository workflow preserves the behavior deployed today:

1. **Qualification:** classify the request and ask only questions not
   answerable from available repository, issue, or approved public context.
2. **Investigation:** reproduce a bug, establish a feature baseline, or inspect
   a maintenance constraint in the repository's development environment.
   Record truthful command, public research, and screenshot evidence plus a
   regression or acceptance strategy.
3. **Planning:** produce acceptance criteria, proposed behavior, likely areas,
   validation strategy, uncertainty, and any real human decision.
4. **Implementation:** make the smallest complete change in the repository
   environment and create a durable checkpoint.
5. **Validation:** apply formatting, path policy, regression/acceptance checks,
   static/build checks, targeted tests, and profile-required validation.
6. **Review:** run the configured independent reviewers on the exact candidate.
   Actionable findings return through implementation and validation.
7. **Integration:** incorporate the current target branch. Conflicts needing
   judgment return to an agent or human node.
8. **Publication and CI:** cleanly validate and publish the exact candidate,
   then observe required GitHub checks on that same head.
9. **Merge:** merge automatically or wait for GitHub maintainer merge according
   to the profile.

There is no speculative cap on clarification, implementation, validation,
review, or remediation. A loop continues while it makes progress and waits when
information or judgment is genuinely required.

The generic review executor will replace the fixed holistic/security/data
identities. A configured reviewer will declare a stable ID, label, model,
prompt, typed inputs, reduced capabilities, activation condition, blocking
severities, and `shadow`, `advisory`, or `blocking` mode. Findings will add
stable fingerprints, evidence locations, and proposed acceptance tests.

## 8. Fit with Anthropic's AI-native SDLC

Anthropic's July 2026
[AI-native SDLC](https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle)
combines contextual planning, isolated coding, deterministic and agentic
testing, deployment-time checks, monitoring, incident response, and
governance.

| Anthropic capability                            | Roundhouse foundation                                                               | Missing integration                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Security planning with organizational context   | `agent.read` and attributable context providers                                     | Policy, architecture, ownership, and incident indexes               |
| Repository guidance and isolated coding         | Snapshotted prompts, `agent.write`, Sandbox, and Dev Container                      | Safe private-repository execution and tighter implementation egress |
| Closed-loop instruction improvement             | Attributable policy recommendation plus human node                                  | Trusted adapter proposing protected policy changes                  |
| Narrow independent security agents              | Generic review fan-out/join, separate context, exact-head evidence, operating modes | Reviewer registry, proof/fingerprint contract, shadow reporting     |
| SAST, invariants, and risk-weighted human gates | Deterministic validation, conditions, policy checks, and human nodes                | Specific scanners, risk policy, and approval journeys               |
| Staging DAST                                    | Deployment triggers and scoped external check adapters                              | Deployment, staging, and scanner adapters                           |
| Alert triage, logs, postmortem, and fixes       | Alert triggers, log context, agent nodes, issue/PR outputs                          | Alert, production-log, and incident-channel adapters                |
| Governance, sampling, metrics, and SIEM         | Workflow hashes, operating modes, canonical audit events                            | Sampling, Analytics Engine, SIEM export, governance UI              |

The graph provides a place to connect these capabilities without another
orchestration rewrite. It does not make undeveloped or unauthorized adapters
exist. Roundhouse also does not become the deployment system: it may eventually
observe a repository-owned deployment and run checks, while deployment
authority remains elsewhere.

Anthropic permits deliberate agent coordination over human-visible channels.
Roundhouse does not provide arbitrary agent-to-agent access. Equivalent future
coordination would require a typed, attributable channel adapter with its own
identity and capability review.

## 9. Workflow implementation plan

Work proceeds in vertical slices. A slice is complete only when its user
journey and boundary tests pass.

### Slice 7.0 — Reconcile the contract

Keep this plan and the README consistent with deployed behavior, the approved
workflow target, the Anthropic comparison, and intentional exclusions.

Exit gate: a reviewer can identify what exists, what is approved, what is
deferred, and what authority is prohibited without consulting historical
documents.

### Slice 7.1 — Run the current lifecycle through the graph

Implement the schema, condition evaluator, compiler, immutable snapshot,
interpreter, and structured transition logging. Express the existing lifecycle
as `.roundhouse/workflow.yaml`. Migrate Roundhouse and Dreamwidth development
profiles and D1 together, then delete the compiled lifecycle switch.

Exit gate:

- existing journeys pass through the interpreter with no intended behavior
  change;
- one branch and one loop resume correctly from D1;
- invalid references, conditions, capability escalation, and exact-head bypass
  fail compilation; and
- no parallel workflow runtime remains.

### Slice 7.2 — General agent composition

Make `agent.read` and `agent.write` consume typed inputs and schemas and select
repository prompts, models, context, and transitions.

Exit gate: a repository changes a meaningful route, prompt, model, branch, and
return edge without Roundhouse source changes, and the timeline shows the
resolved inputs, authority, result, condition, and selected edge.

### Slice 7.3 — Generic review fan-out and join

Replace the fixed reviewer identities with generic review nodes,
fan-out/join, stable finding evidence, and operating modes. Migrate the current
three reviewers without changing their effective policy.

Implemented: reviewer identities and policy now live only in the immutable
workflow snapshot. The runtime resolves configured fan-out, validates selector
results, joins only completed attempts bound to one exact candidate head, and
records durable fan-out/join events. Findings carry stable fingerprints and
candidate-head evidence; blocking, advisory, and shadow modes share one
contract. Downstream `nodes.<review>.review` inputs resolve to that deterministic
join and record every contributing attempt ID, rather than selecting one
reviewer attempt.

Exit gate: a repository adds a reviewer through configuration; every outcome is
exact-head-bound; remediation invalidates and reruns required gates.

### Slice 7.4 — Human, external-event, context, and audit boundaries

Implement the generic human wait/resume contract, context-provider interface,
external wait/check interface, and canonical audit envelope. Enable only
adapters needed by an approved journey.

Implemented foundation: human nodes declare their waiting reason and
participant/operator audience; a typed resume signal is consumed once on a new
durable revision. Named external adapters resume only the matching waiting node
and event. Context providers return source/version attribution, and all new
boundary events use a common workflow/node/head/actor audit envelope that is
logged, stored, and shown in run details. No production external or
organizational-context adapter is enabled by default.

Exit gate: ordinary GitHub prose resumes a configured human node; a fake
external event resumes durably; context and audit data are attributable; and
neither interface can expand authority.

### Slice 7.5 — Repository-backed graph UI

Add a dashboard graph view and editor using the same schema and compiler. Show
node authority and routes and propose changes through a GitHub pull request.

Implemented: each enrolled repository has a graph page sourced from its latest
immutable run snapshot. It shows executors, capabilities, routes, workflow hash,
and source commit; serializes the compiled graph back into repository YAML; and
validates edits through the production compiler. Proposal creation is handed
to GitHub's authenticated editor and pull-request flow, so the public dashboard
does not gain repository mutation authority and D1 remains evidence only.

Exit gate: a maintainer can round-trip the active workflow without D1 becoming
configuration authority or a protected change silently altering an active run.

After these slices, choose organizational context, scanners, staging DAST,
alert triage, or governance export as separate vertical journeys. Their order
is not approved by this plan.

## 10. Acceptance and observability

The existing product baseline must continue to demonstrate:

- a clear issue reaching exact-head CI and automatic or maintainer merge;
- clarification resuming the same work item;
- truthful handling of an unreproduced or already-satisfied request;
- validation and adversarial-review remediation;
- target-branch integration without stale review or CI authorization;
- duplicate delivery and container replacement without duplicate publication;
- interruption, checkpoint rejection, and branch supersession returning to the
  coordinator without an unnecessary maintainer restart;
- malicious untrusted content failing to acquire credentials or authority; and
- the same journeys on an external repository through configuration.

The graph migration additionally demonstrates:

- default-workflow parity;
- a structured branch and human-driven loop;
- generic reviewer fan-out/join and exact-head invalidation;
- compiler rejection of capability escalation and gate bypass;
- replay from an exact workflow/profile snapshot after configuration changes;
- durable wait/resume from a typed external event; and
- repository-file round-trip through the dashboard editor.

Every new boundary and step must log enough structured information to diagnose
it on its first real run. At minimum, events identify the run, attempt,
workflow hash, node, safe input and output references, capabilities, selected
edge, exact commit, model route, command/API operation, timing, and outcome.
Sensitive prompts, repository content, raw credentials, and authorization
headers are not copied into general logs.

The dashboard and event timeline must show current activity, elapsed time, last
useful progress, waiting action, attempts, results, selected routes, and pull
request state without requiring direct D1, Queue, or container inspection.

## 11. Complexity and documentation

The implementation retains:

- one lifecycle control plane and one private model broker;
- one independently deployed Sandbox runtime host with no lifecycle authority;
- one graph interpreter and lifecycle owner;
- one runner image and one Sandbox security boundary;
- D1 as the only lifecycle authority;
- Queue as wakeups rather than business state;
- Artifacts as the durable Git workspace;
- no per-stage infrastructure services;
- no arbitrary workflow code or repository executors;
- no compatibility runtime for the compiled lifecycle; and
- no speculative limits or recovery machinery.

The maintained documentation is:

- `README.md` for the product, current status, and development entry points;
- this document for current architecture, approved work, and acceptance; and
- `docs/future-improvements.md` for explicitly deferred ideas with no authority
  to start work.

Git history, issues, pull requests, telemetry, and the `v1-poc-final` tag hold
historical decisions, experiments, evidence, and completed migration detail.
They do not belong in this active context unless they still constrain the
current architecture.
