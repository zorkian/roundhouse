# Roundhouse V1 Product and Technical Plan

Status: Proposed  
Audience: Maintainers and implementers  
Initial deployment: Single-tenant, internal, Cloudflare-first  
Initial targets: Roundhouse itself for controlled dogfooding, followed by one heterogeneous legacy monorepo, primarily Perl with Rust and JavaScript components

## 1. Product definition

Roundhouse is a GitHub-native software-development orchestration system. It converts raw GitHub issues into qualified, evidence-backed work, coordinates coding agents through planning, implementation, validation, and review, and creates draft pull requests under configurable safety and human-approval policies.

V1 is successful when a maintainer can label or command an issue, observe the complete run, answer clarification questions when necessary, approve higher-risk plans, and receive a locally validated, independently reviewed draft pull request. A human always decides whether to merge.

Roundhouse is not itself a coding model. It is the durable control, policy, execution, evidence, and audit layer around coding-agent runtimes.

Roundhouse should become its own first enrolled repository once the walking skeleton can safely operate. This creates a tight dogfooding loop without making the initial bootstrap depend on the system being able to build itself. The legacy monorepo remains the first demanding production target and the source of the heterogeneous-runtime requirements.

## 2. V1 principles

1. GitHub is the user-facing system of engagement; Roundhouse is the workflow system of record.
2. An issue must be qualified before implementation. "Received" does not mean "ready."
3. Workflows are durable state machines, not chains of webhook handlers.
4. Repository content, issue text, dependencies, and executed code are untrusted.
5. Agents receive capabilities, not ambient credentials.
6. All meaningful inputs, decisions, actions, outputs, and costs are attributable to a run.
7. Cheap local validation happens before expensive GitHub CI.
8. Risk and policy determine autonomy. Low-risk fixes may reach draft PR; medium/high-risk work pauses after planning.
9. Every merge requires a human in V1.
10. Provider-specific agent behavior stays behind adapters.
11. Untrusted instructions are data, not authority; authorization comes only from policy and authenticated human actions.
12. Learning from prior runs may recommend changes, but V1 never silently changes its own prompts, policies, code, or permissions.
13. Review feedback cannot silently expand approved scope, risk, complexity, capabilities, or budget.

## 3. V1 scope

### In scope

- Multiple trusted GitHub installations controlled by the operator, initially Mark's personal account for Roundhouse and the Dreamwidth organization for the legacy monorepo.
- A simple repository boundary from the start: separate configuration, execution profile, policy, budget, artifact namespace, and concurrency state per repository.
- An initial Roundhouse execution profile for dogfooding and a legacy-monorepo execution profile for the first production target.
- GitHub App installation, webhook ingestion, issue comments, checks, branches, draft pull requests, and pull-request reviews.
- Explicit start through a configured label or slash command.
- Issue classification, clarification, reproduction, evidence capture, and readiness decisions.
- Risk classification and policy-based plan approval.
- Codex implementation adapter and Claude Code review adapter, subject to the adapter spikes in Phase 1.
- Ephemeral container workspaces.
- Default-deny network access with explicit proxy/MCP capabilities.
- Fast local formatting, compile/static checks, and targeted tests.
- GitHub Actions as the authoritative full CI system.
- Review-to-revision loops with bounded attempts.
- Dashboard for runs, approvals, logs, evidence, artifacts, status, and estimated usage.
- Hard safety and budget limits.
- Retention of raw provider events and redacted execution records.

### Explicit non-goals

- Multi-tenancy, customer billing, marketplace distribution, or enterprise compliance certification.
- Automatic merging or deployment.
- Linear, Jira, or other work-item providers.
- GitHub Projects as the workflow database. A future integration may project Roundhouse status into Projects.
- Arbitrary repositories and language stacks.
- Fully hermetic or adversarial-grade sandboxing for public, untrusted repositories.
- Customer-grade tenant isolation, customer billing, per-customer encryption domains, or mutually untrusted organization boundaries. Installation and repository boundaries are required across the personal and Dreamwidth installations, but they are not presented as security-grade multi-tenancy.
- A custom general-purpose coding-agent loop built directly on raw model APIs.
- Fly.io execution unless Cloudflare Containers fail a documented V1 requirement.
- Perfect dollar attribution when a personal subscription does not expose it.

## 4. Primary user journeys

### 4.1 Bug issue to draft pull request

1. A maintainer adds the configured `roundhouse` label or comments `/roundhouse start`.
2. Roundhouse verifies and stores the GitHub event, creates a work item and run, and acknowledges the trigger.
3. A qualification agent classifies the issue and inspects repository guidance.
4. If information is missing, Roundhouse posts targeted questions and waits for issue activity.
5. If sufficiently specified, an agent attempts reproduction in an ephemeral workspace.
6. Roundhouse stores a reproduction bundle: commit, environment, commands, inputs, observed/expected behavior, logs, screenshots where relevant, repeatability, and confidence.
7. The system assesses scope and risk and produces a plan.
8. A low-risk fix proceeds; medium/high-risk work waits for plan approval.
9. The implementation agent edits a new branch and runs fast local validation.
10. A reviewer agent independently reviews the issue, evidence, plan, and diff.
11. Actionable findings return to the implementation agent, within iteration limits.
12. Roundhouse pushes the branch and opens or updates a draft PR containing before/after evidence and validation results.
13. GitHub CI runs. Roundhouse records and summarizes the result.
14. The run stops at `awaiting_human_merge` when all required gates pass.

### 4.2 Cannot reproduce

Roundhouse distinguishes missing information, unsupported environment, intermittent failure, expected behavior, stale/already-fixed behavior, and human judgment required. It asks specific questions when useful, retries only when new evidence arrives, and otherwise pauses with findings rather than inventing a fix.

### 4.3 Feature or risky change

Qualification replaces reproduction with acceptance-criteria clarification and repository impact analysis. The workflow produces an evidence-backed plan and pauses. Implementation cannot start until a maintainer approves the specific plan revision.

### 4.4 Pull-request review loop

For Roundhouse-created PRs, or explicitly enrolled human-created PRs, the review workflow checks the current head SHA, runs an independent agent review, publishes useful findings, and can dispatch selected findings to an implementation run. A new commit invalidates review approval for the old SHA.

### 4.5 Human conversation on a pull request

Comments and reviews on an enrolled PR are durable workflow inputs, not incidental notifications. Roundhouse classifies each new human-authored interaction as one of:

- Question or request for explanation.
- Actionable change request.
- Approval or non-blocking feedback.
- Request to rerun validation or review.
- Command such as pause, resume, cancel, or revise.
- Irrelevant, ambiguous, duplicated, or potentially malicious content.

For a question, Roundhouse may answer from already-audited run evidence without changing code. For a change request, it writes a proposed interpretation and impact, then either dispatches a bounded revision automatically when the request remains within the approved low-risk scope or pauses for approval when it expands scope, risk, permissions, or budget. The implementation attempt runs local validation again, pushes a new commit, and causes review and CI gates to bind to the new head SHA.

Roundhouse never treats arbitrary PR prose as authorization to gain capabilities, reveal data, contact a new destination, modify protected paths, or merge. Ambiguous requests are clarified. Conflicting requests, repeated patch oscillation, or comments from unauthorized users pause for human triage. Responses are threaded or updated in place where GitHub permits, and each comment records the run/revision it addresses.

Public participation and operational authority are separate. Any GitHub user may ask questions or offer feedback on a public issue or PR, and Roundhouse may classify that content as untrusted input. Only an actor authorized for the specific operation may start or cancel runs, approve plans, grant budget, accept scope changes, or request code modifications. Drive-by comments never trigger agent execution or acquire authority through persuasive wording.

### 4.6 Budget exhaustion and continuation

Budget exhaustion pauses rather than kills the work item. Roundhouse stops active execution, revokes attempt credentials, preserves the workspace patch and complete artifacts, and posts a GitHub status comment explaining which limit was reached, what work completed, and what remains.

An authorized maintainer can grant a bounded increment with a GitHub command such as `/rh budget add 10usd` or `/rh budget add 30m`, subject to repository and global policy. The grant creates an audited budget decision and a new reservation, then resumes from the last safe checkpoint. A maintainer may instead cancel the run or revise its scope. Roundhouse never interprets an unbounded phrase such as "keep going whatever it costs" as unlimited authority.

## 5. State model

State is represented as durable workflow state plus an append-only event history. D1 holds queryable projections; R2 holds large and immutable payloads.

### 5.1 Work-item state

```text
new
  -> qualifying
  -> needs_information -> awaiting_reporter -> qualifying
  -> reproducing
       -> reproduced
       -> not_reproduced
       -> human_triage_required
  -> planning
  -> awaiting_plan_approval
  -> implementing
  -> validating_local
  -> reviewing
  -> revising -> validating_local
  -> publishing_pr
  -> awaiting_ci
  -> awaiting_human_merge
  -> completed
```

Terminal states are `rejected`, `cancelled`, and `completed`. Interrupted states are `failed`, `budget_exhausted`, and `policy_blocked`; they may resume only through the appropriate new recorded command, grant, approval, or remediation.

### 5.2 Run and attempt distinction

- A **work item** corresponds to the enduring unit of requested work, usually a GitHub issue.
- A **run** is one policy-governed execution of a workflow for a work item.
- A **stage** is qualification, reproduction, planning, implementation, validation, review, or publication.
- An **attempt** is one execution of a stage by an agent or system worker.
- An **agent session** is a provider-native conversation/runtime session used by an attempt.

This distinction permits retries and model changes without losing provenance or confusing them with a new user request.

### 5.3 Event envelope

Every internal event has at least:

```ts
type EventEnvelope<T> = {
  id: string;
  type: string;
  schemaVersion: number;
  occurredAt: string;
  receivedAt: string;
  installationId: string;
  repositoryId: string;
  workItemId?: string;
  runId?: string;
  stageId?: string;
  attemptId?: string;
  actor: { type: "human" | "github" | "system" | "agent"; id: string };
  correlationId: string;
  causationId?: string;
  payload: T;
  rawArtifactId?: string;
};
```

Handlers must be idempotent. GitHub delivery IDs and provider event IDs are stored as deduplication keys.

## 6. System architecture

### 6.1 Cloudflare components

| Component | Responsibility |
| --- | --- |
| Workers | Webhook/API ingress, UI backend, GitHub callbacks, read APIs |
| Workflows | Durable business process, retries, waits, approvals, stage transitions |
| Queues | Ingress buffering, fan-out, asynchronous event processing, backpressure |
| D1 | Configuration, identities, state projections, approvals, leases, budgets, artifact metadata |
| Durable Objects | Per-work-item/PR serialization, concurrency coordination, live event streaming |
| R2 | Raw webhooks, transcripts, logs, screenshots, patches, bundles, provider-native events |
| Containers | Repository checkout, coding-agent runtime, commands, reproduction and validation |
| AI Gateway | Provider routing/telemetry when compatible with the chosen agent authentication mode |

### 6.2 Logical services

- **GitHub gateway:** signature verification, installation authentication, API calls, webhook normalization.
- **Orchestrator:** workflow definitions, transitions, retries, waits, and compensation.
- **Policy engine:** risk, approvals, capabilities, budgets, iteration limits, and protected paths.
- **Execution broker:** container lifecycle, workspace setup, leases, credentials, limits, and teardown.
- **Agent broker:** adapter selection and normalized event streaming.
- **Evidence service:** artifact creation, redaction, manifests, and signed access.
- **Validation service:** repository-defined local commands and GitHub check observation.
- **Audit service:** append-only event persistence and searchable projections.
- **Web application:** operations console and approval surface.

Initially these should be modules in a small number of deployables, not separately operated microservices.

### 6.3 Control and execution boundary

The control plane never executes repository commands. The execution plane never receives long-lived control-plane, GitHub App private-key, or provider-administration credentials.

For each attempt the execution broker provides:

- A clean workspace and pinned repository commit.
- A narrowly scoped, expiring capability token.
- The repository execution profile.
- Allowed agent runtime and stage-specific tools.
- Egress proxy settings and per-run identity.
- Time, CPU, memory, disk, command, turn, and budget limits.
- Write access only where the current stage permits it.

### 6.4 Git workspace persistence and Cloudflare Artifacts

R2 remains the durable store for immutable evidence, logs, transcripts, screenshots, and arbitrary artifacts. Git workspaces have different semantics: commits, refs, branches, diffs, and efficient handoff to standard Git tooling.

Cloudflare Artifacts is a promising optional workspace primitive because it exposes isolated, versioned repositories through Git, Workers bindings, and REST APIs. A per-run or per-attempt repository could hold a sanitized working branch, checkpoint commits, and implementer-to-reviewer handoffs without treating tarballs in R2 as Git repositories.

V1 does not depend on Artifacts because the product is currently closed beta and the operator does not have access. The committed V1 baseline is:

1. Clone the GitHub source directly into an ephemeral container.
2. Capture checkpoint patches/bundles in R2.
3. Push the authorized final branch to GitHub.

If access becomes available later, an Artifacts spike may measure import and clone time, large-monorepo behavior, storage and retention, token scoping, egress visibility, ref concurrency, cleanup, and recovery after container loss. If adopted, Artifacts stores only repository workspace state; it does not replace R2 audit/evidence storage or GitHub as the public collaboration source of truth.

## 7. GitHub integration

### 7.1 Initial webhook subscriptions

- `issues`
- `issue_comment`
- `pull_request`
- `pull_request_review`
- `pull_request_review_comment`
- `check_run`
- `check_suite`
- `workflow_run`
- `installation`
- `installation_repositories`
- `push`, limited to relevant branch/head synchronization

Only subscribed actions used by V1 should enter the workflow event stream.

### 7.2 Initial GitHub App permissions

Request the minimum permissions demonstrated by integration tests. Expected repository permissions are:

- Metadata: read
- Contents: read/write
- Issues: read/write
- Pull requests: read/write
- Checks: read/write
- Actions: read
- Commit statuses: read
- Organization members: read, when installed on an organization and team-based authorization is configured

Do not request Administration, Secrets, Environments, or Workflows write access in V1. Modification of `.github/workflows/**` is policy-blocked by default even if contents permission could modify it through Git data APIs. The organization Members permission is requested only for installations using GitHub-team authorization; personal-account installations use configured user allowlists and repository permission checks.

### 7.3 Commands and identity

Supported commands begin with `/roundhouse`; `/rh` is an exact alias. Commands are accepted only from users meeting installation and repository policy:

- `/roundhouse start`
- `/roundhouse retry`
- `/roundhouse cancel`
- `/roundhouse approve plan <revision>`
- `/roundhouse revise <feedback>`
- `/roundhouse status`
- `/roundhouse budget add <bounded-amount>`

GitHub is the authoritative operational approval surface. A valid command delivered by GitHub records the authenticated GitHub actor, installation and repository, target run, plan revision or SHA, timestamp, parsed decision, and source comment ID. The equivalent `/rh` forms are supported for every command.

Approvals must be explicit and bind to an immutable target. Roundhouse posts copyable commands such as `/rh approve plan 3`; a generic `looks good` or emoji reaction is feedback, not authorization. Repository policy determines which GitHub users, teams, or permission levels may approve plans, grant budget, retry, or cancel. Roundhouse revalidates authorization when processing every command rather than trusting author data copied from the webhook payload alone.

Authorization policy is capability-specific. The recommended order is:

1. Active membership in one or more configured GitHub organization teams for the requested capability.
2. A configured per-installation or per-repository GitHub user allowlist, required for personal-account repositories and available as a fallback.
3. Optionally, a minimum live GitHub repository permission as an additional condition, never as the only authority for sensitive operations unless explicitly configured.

Examples of separate capabilities are `run.start`, `plan.approve`, `scope.expand`, `budget.grant`, `run.cancel`, and `policy.admin`. Team membership and repository permission are checked live through GitHub at command-processing time, with short cache lifetimes only for availability. Failure to confirm authorization fails closed for consequential actions. The web app configures team slugs and fallback users but does not copy or manage GitHub team membership.

The web application displays approvals and can link an operator to the exact GitHub conversation, but it is not required for routine issue/PR decisions in V1. Administrative actions such as setting budget ceilings, concurrency, agent-role mappings, protected paths, and repository policy occur in the web application and are separately audited.

### 7.4 Branch and PR convention

- Branch: `roundhouse/issue-<number>-<short-slug>`
- Draft PR until the workflow reaches its V1 terminal handoff.
- PR body is generated from a stable template containing issue, understanding, reproduction evidence, plan revision, risk, changed behavior, local validation, independent review, CI, artifacts, and Roundhouse run link.
- Roundhouse comments are updated in place where possible to avoid notification spam.

## 8. Qualification and evidence

### 8.1 Qualification output

```ts
type QualificationResult = {
  kind: "bug" | "feature" | "migration" | "maintenance" | "security" | "support" | "duplicate" | "unknown";
  understanding: string;
  acceptanceCriteria: string[];
  missingInformation: Array<{ question: string; reason: string }>;
  reproductionRequired: boolean;
  suspectedComponents: string[];
  confidence: number;
  recommendedDisposition: "clarify" | "reproduce" | "plan" | "human_triage" | "stop";
};
```

The system asks only questions whose answers can change disposition or implementation. Clarification is limited by policy, defaults to three rounds, and resumes only on relevant new issue activity.

### 8.2 Reproduction bundle

Every reproduction attempt emits a manifest containing:

- Source commit and dirty-state assertion.
- Container image digest and repository-profile revision.
- Setup and reproduction commands with exit codes and durations.
- Sanitized environment metadata.
- Expected and observed behavior.
- Inputs, fixtures, logs, traces, screenshots/video when applicable.
- Repeat count and outcome distribution.
- Candidate failing test or minimized reproduction.
- Result category and confidence.
- Artifact checksums and redaction status.

Before/after bundles use the same reproduction procedure when possible.

## 9. Risk and approval policy

Risk is a policy decision supported by agent analysis, not an unreviewed model verdict.

### 9.1 Risk inputs

- Work kind and ambiguity.
- Reproduction confidence.
- Files and components affected.
- Diff size and semantic scope.
- Database/schema/data migration effects.
- Authentication, authorization, cryptography, secrets, payments, deployment, build, and CI changes.
- Public API or compatibility changes.
- Test coverage and rollback feasibility.
- Agent confidence and contradictory reviewer findings.

### 9.2 Default policy

**Low risk:** small, localized, reproducible bug fix; no protected component; clear acceptance criteria; regression evidence; bounded diff. May proceed through draft PR.

**Medium risk:** cross-component changes, incomplete reproduction, behavior or compatibility changes, weak tests, or larger refactoring. Pause after plan.

**High risk:** migrations, destructive data effects, auth/security boundaries, deployment/workflow changes, secrets, broad architectural work, or uncertain rollback. Pause after plan and require explicit maintainer approval; additional implementation capabilities may also require approval.

Protected paths and risk overrides are repository configuration, versioned and audited. Agent output cannot lower a mandatory risk floor.

Approvals bind to a plan revision and, where relevant, a commit SHA. Material plan or diff changes invalidate prior approval.

## 10. Agent adapters

### 10.1 Contract

```ts
interface AgentAdapter {
  readonly name: string;
  capabilities(): Promise<AgentCapabilities>;
  start(input: AgentRunInput): AsyncIterable<AgentEvent>;
  resume(sessionId: string, input: AgentMessage): AsyncIterable<AgentEvent>;
  cancel(runId: string): Promise<void>;
}
```

The contract normalizes lifecycle and observability, not every provider-specific semantic. Raw events are retained.

### 10.2 Initial role assignment

- Qualification/planning: select after a small evaluation; default to the implementation adapter initially to reduce integration surface.
- Implementation: Codex.
- Independent review: Claude Code.
- Revision: original implementation session when safely resumable; otherwise a new session with complete handoff artifacts.

The reviewer must not share the implementer's hidden session context. It receives the issue, qualification, evidence, approved plan, repository state, and diff.

### 10.3 Model and runtime selection

Agent runtime and model are separate configuration choices. Policy selects them per stage using required capabilities, measured quality, latency, and cost rather than applying one premium model everywhere.

Initial routing policy:

- **Event classification and simple extraction:** deterministic code first; a small inexpensive model only when semantic classification is needed.
- **Qualification and clarification drafting:** a fast, lower-cost model, escalating when confidence is low, repository investigation is required, or the issue is security-sensitive or unusually ambiguous.
- **Reproduction:** a capable coding agent; model escalation depends on failed attempts and environment complexity.
- **Planning and risk analysis:** a high-capability reasoning/coding model because errors here affect all later stages.
- **Implementation:** a strong coding model selected using repository-specific evaluation; small mechanical repairs may use a cheaper tier after the main change exists.
- **Independent review:** a strong model from a provider or model family independent of implementation where practical.
- **Comment summarization and status updates:** a small model or deterministic templates.

Every stage records runtime, provider, model identifier, model/config revision, selection rule, fallback reason, usage, and outcome. Model aliases are resolved to concrete identifiers for audit and replay where the provider exposes them. A fallback cannot weaken required capabilities or cross a configured cost/risk boundary without a recorded policy decision.

Model selection is tuned through the evaluation set. V1 does not assume that the most expensive model is best for every stage, nor that a small model may make final authorization or risk-floor decisions.

### 10.4 Authentication modes

- **Development bootstrap:** operator-authenticated subscription session where supported.
- **Unattended operation:** dedicated service/API credentials.

Authentication is injected at runtime and excluded from the workspace and artifacts. Subscription mode is not expected to provide exact dollar attribution or reliable AI Gateway visibility. The design must permit switching modes without changing workflows.

### 10.5 Adapter spike exit criteria

Each initial adapter must demonstrate:

- Headless operation in the target container.
- Structured, streamable output.
- Cancellation and hard timeout.
- Bounded turns.
- Stage-specific tool restrictions.
- Session continuation or a documented stateless handoff.
- Complete command/file-change observation or compensating OS-level capture.
- Operation through the required egress path.
- Credential injection without persistence.
- Usage reporting where available.

If an adapter cannot satisfy safety-critical criteria, it is not eligible for unattended V1 use.

## 11. Repository execution profile

Roundhouse uses a versioned repository profile rather than embedding legacy build knowledge in workflows.

```yaml
version: 1
runtime:
  image: roundhouse/legacy-monorepo@sha256:REQUIRED
  workspace: /workspace
bootstrap:
  command: ./automation/bootstrap-agent-environment
validation:
  format: ./automation/check-format
  compile: ./automation/check-compile
  targeted: ./automation/test-changed
  timeoutMinutes: 15
network:
  default: deny
  capabilities:
    - github-read
    - cpan-proxy
    - crates-proxy
    - npm-proxy
protectedPaths:
  - .github/workflows/**
  - deploy/**
artifacts:
  include:
    - .roundhouse/artifacts/**
```

The first profile spike must inventory the actual Perl runtime, CPAN/local dependency mechanism, native libraries, services, Rust toolchain, Node package manager, repository size, checkout time, build time, and test entry points. Stable dependencies should be placed in a pinned base image; issue-specific downloads remain controlled and audited.

## 12. Validation and review

### 12.1 Validation ladder

1. Patch integrity and protected-path check.
2. Formatter/linter for touched components.
3. Compile/static checks.
4. Targeted regression test or reproduction procedure.
5. Repository-configured fast test set.
6. Independent review.
7. Push branch and start GitHub CI.
8. Observe required checks for the exact head SHA.

An agent may repair failures in steps 1-5 within policy limits. GitHub CI is authoritative for merge readiness, but Roundhouse does not merge in V1.

### 12.2 Review output

Review findings are structured with severity, confidence, affected file/line, rationale, evidence, and proposed disposition. Findings with a precise location are published as GitHub inline review comments attached to the reviewed commit and diff position; cross-cutting findings and the disposition summary appear in the GitHub review body. Humans can reply in the native review thread, and Roundhouse correlates the thread, finding, head SHA, and later resolution.

Only actionable findings at or above configured confidence are eligible to return to implementation, and eligibility does not imply automatic acceptance. Each finding is classified as:

- `must_fix`: correctness, security, data loss, broken acceptance criteria, or required validation.
- `within_scope`: a bounded improvement consistent with the approved plan and risk.
- `scope_expanding`: refactor, new abstraction, architectural change, new dependency, public API change, or otherwise material complexity increase.
- `disputed` or `wont_fix`: unsupported, incorrect, disproportionate, or intentionally declined with rationale.

The policy engine compares a proposed response with the approved plan, protected paths, risk class, diff/complexity budget, dependencies, and acceptance criteria. A `scope_expanding` finding cannot dispatch implementation automatically. Roundhouse posts the tradeoff and asks an authorized human to decline it, approve a revised plan/risk classification, or create a follow-up issue. Reviewer severity cannot override this scope gate.

Roundhouse prefers the smallest change that satisfies the issue and required quality gates. It records `wont_fix` rationales in the PR so humans can see that a finding was considered rather than silently dropped. The workflow detects repeated findings, reopened threads, and oscillating patches and escalates rather than looping indefinitely.

Default maximums:

- Two implementation-repair attempts for local validation.
- Two review-to-revision cycles.
- One automatic retry for infrastructure failures per stage, followed by backoff/escalation.

These are configuration defaults, not hard-coded constants.

## 13. Network, tools, and secrets

### 13.1 Prompt injection and the lethal-trifecta threat model

Roundhouse assumes that issues, comments, PR text, repository files, test output, dependency metadata, web responses, MCP results, screenshots, and model-generated content can contain hostile instructions. Model judgment is never the security boundary.

The central prompt-injection risk is the combination of:

1. Access to private or sensitive data.
2. Exposure to untrusted content that can influence the agent.
3. A channel capable of communicating data or taking consequential action.

Roundhouse breaks that combination structurally:

- An agent stage receives only the minimum data required for that stage. Review does not need provider administration credentials; qualification does not need repository write access.
- Reading content cannot grant a capability. Capabilities are minted by the policy engine from workflow state and authenticated human decisions.
- External destinations and MCP tools are allowlisted per stage; untrusted content cannot add destinations or tools.
- Sensitive data and outbound communication are not simultaneously available unless a specific audited workflow requires both.
- GitHub writes are narrow structured operations where possible. Free-form agent output does not directly become API arguments, shell commands, URLs, or credentials.
- Any request to reveal data, widen scope, obtain a new secret, bypass validation, alter policy, or contact a new destination is denied or escalated independently of the agent's rationale.
- Tool results are labeled with provenance and trust class. Instructions found inside tool results remain untrusted data.
- High-impact actions require deterministic checks and, where configured, authenticated human approval bound to the exact revision or SHA.
- Canary secrets and injection-focused replay fixtures are used to test that data cannot cross prohibited boundaries.

The goal is practical defense in depth for internal repositories, not a claim that prompt injection is solved or that the sandbox can safely run arbitrary hostile public code.

### 13.2 Egress

- Default deny at the execution boundary.
- Model traffic, dependency retrieval, GitHub operations, and MCP calls are separately identified capabilities.
- Prefer controlled dependency caches/proxies.
- Route HTTP/S traffic through a per-run authenticated audit proxy where compatible.
- Deny direct access to Cloudflare metadata/control APIs and internal services.
- Record destination, method, byte counts, policy decision, run identity, timing, and redacted metadata.

### 13.3 MCP

MCP servers expose narrow operations when an agent needs external data or actions. Tool schemas, arguments, caller, result metadata, duration, and policy decisions are audited. MCP is not treated as inherently safe; each server and tool has an allow policy per stage.

### 13.4 Secrets

- Long-lived secrets reside in a managed secret store, not D1 or R2.
- The control plane mints or retrieves the narrowest usable short-lived credential.
- Git pushes and GitHub API writes should normally be brokered or use short-lived installation tokens.
- Redaction runs before persistent logs are accepted, with an additional retrospective scanner.
- Raw retention does not include known credentials, authorization headers, or secret values.

## 14. Audit, artifacts, and retention

V1 retains:

- Raw GitHub webhook payloads.
- Workflow transitions and policy evaluations.
- Human commands and approvals.
- Provider-native agent events and normalized events.
- Prompts and responses where exposed and permitted.
- Tool calls, commands, exit codes, stdout/stderr, and durations.
- File-change manifests and patches.
- Network and MCP activity.
- Reproduction and validation bundles.
- Usage and estimated cost.
- GitHub writes and resulting object IDs/SHAs.

Artifacts are immutable by ID and checksum. Corrections create new versions. D1 stores metadata and indexes; R2 stores content. Access URLs are short-lived. A retention policy interface exists in V1 even if the configured policy is `retain indefinitely`, avoiding a future schema redesign.

## 15. Budgets and circuit breakers

V1 enforces limits even when exact monetary cost is unavailable:

- Concurrent workflows and containers.
- Per-stage and per-run wall time.
- Agent turns and tool calls.
- Clarification, repair, and review iterations.
- Container CPU, memory, and disk.
- Artifact and log volume.
- Provider tokens and reported/estimated dollars when available.
- Per-run and daily global ceilings.
- Global and repository kill switches.

Limit exhaustion pauses cleanly as `budget_exhausted`, preserves artifacts and the patch, revokes credentials, and offers an authorized maintainer a bounded continuation through GitHub. The additional grant records amount, unit, actor, reason where supplied, source comment, previous consumption, and the new ceiling. Resume creates a fresh reservation and continues from the last safe checkpoint rather than blindly replaying the exhausted attempt.

Not every circuit breaker is purchasable. Repository/global kill switches, policy violations, protected-capability denials, disk safety limits, and security stops require their own explicit remediation; adding budget cannot bypass them.

Initial defaults should favor safety and be tuned from observed runs. Budget reservations prevent multiple concurrent runs from independently consuming the same remaining daily allowance.

## 16. Initial data model

Core D1 tables:

- `github_installations`
- `repositories`
- `repository_profiles`
- `work_items`
- `runs`
- `stages`
- `attempts`
- `agent_sessions`
- `events`
- `event_deduplication`
- `artifacts`
- `approvals`
- `policy_decisions`
- `risk_assessments`
- `usage_records`
- `budget_accounts`
- `budget_reservations`
- `github_objects`
- `execution_leases`

Identifiers are application-generated ULIDs. Their canonical string representation sorts lexicographically by timestamp, which is useful for operations and roughly chronological pagination. Within the same millisecond, generators must use a monotonic ULID implementation when stable creation order matters; timestamps and explicit sequence/order fields remain authoritative rather than relying on IDs for business ordering. GitHub numeric IDs and node IDs are stored as external identifiers, not primary keys. Time-series and large payloads stay out of D1. Schema changes use forward migrations and event schema versioning from the start.

## 17. Operations console

### Required V1 views

**Queue:** work items grouped by waiting on reporter, waiting on approval, running, blocked, failed, and awaiting human merge.

**Run detail:** current state, timeline, stage attempts, live agent/command stream, evidence, artifacts, policy decisions, budget, GitHub links, and cancellation.

**Approval status:** understanding, evidence, plan revision, risk reasons, protected capabilities requested, budget impact, current authorization status, and canonical GitHub conversation.

For V1, routine approval controls in this view deep-link to or provide copyable commands for the canonical GitHub issue or PR. The console must not create a parallel conversation or divergent approval state. Direct console approval may be added later only if there is a concrete operational need and equivalent identity, authorization, revision binding, and audit semantics.

**Repository settings:** trigger policy, execution-profile version, protected paths, risk rules, validation commands, agent-role mapping, limits, and egress capabilities.

**Audit search:** filter by issue, PR, SHA, run, actor, agent, command, tool, destination, result, and time.

The UI should consume the same API used by GitHub-facing status generation. No critical state exists only in browser memory.

## 18. Failure handling

- A webhook is acknowledged only after durable acceptance.
- Duplicate deliveries do not create duplicate runs or comments.
- Every external write uses an idempotency strategy or reconciliation read.
- Workflow retries distinguish transient infrastructure failure from deterministic agent/repository failure.
- Container loss can restart a stage from immutable inputs; uncommitted changes are periodically captured as attempt artifacts where feasible.
- Stale work is detected by issue revision, base branch, plan revision, and PR head SHA.
- Cancellation revokes leases and credentials, stops execution, captures final diagnostics, and records the actor.
- A reconciliation job detects missed GitHub state transitions and repairs projections.

## 19. Delivery plan

### Phase 0: Repository and environment discovery

Deliverables:

- Legacy monorepo inventory and threat model.
- Reproducible local/container bootstrap.
- Fast validation scripts for Perl, Rust, and JavaScript.
- Initial repository execution profile.
- Baseline timings and resource requirements.

Exit criteria:

- A clean container can check out a pinned commit and run formatting/compile checks without ambient developer-machine state.
- Dependencies and required network destinations are enumerated.
- At least one representative bug can be reproduced and its evidence exported.

### Phase 1: Architecture spikes

Deliverables:

- Minimal Cloudflare Workflow that waits for and resumes on approval.
- Cloudflare Container spike using the repository profile.
- Codex adapter spike.
- Claude Code adapter spike.
- Egress proxy/audit spike.
- GitHub App permission and webhook spike.
- R2 artifact plus D1 metadata spike.

Exit criteria:

- Each spike answers its documented go/no-go questions.
- Cloudflare Containers meet measured checkout, disk, runtime, process, and networking needs, or a specific fallback decision is recorded.
- At least one agent produces a patch and another reviews it through normalized events.
- Credentials do not persist in the resulting workspace or artifacts.
- Direct clone plus R2 checkpoints is demonstrated as the V1 Git workspace persistence path.

### Phase 2: Walking skeleton

Deliverables:

- GitHub event -> durable run -> container -> agent -> artifact -> GitHub status path.
- Core D1 schema and append-only event pipeline.
- Minimal run-detail UI.
- Cancellation, timeout, idempotency, and global kill switch.

Exit criteria:

- `/roundhouse start` on a test issue creates exactly one observable run.
- A restart or injected transient failure resumes without duplicating GitHub writes.
- The operator can inspect and cancel the run.

Roundhouse becomes the first dogfood repository after these exit criteria pass. Dogfood runs use a dedicated repository profile, conservative budgets, human plan approval, and no special bypasses. The legacy monorepo is enrolled after dogfooding demonstrates stable orchestration and the legacy profile passes Phase 0.

### Phase 3: Qualification and reproduction

Deliverables:

- Classification and structured qualification output.
- Targeted clarification loop.
- Reproduction execution and evidence bundles.
- Reporter-wait and human-triage states.

Exit criteria:

- Representative clear, unclear, irreproducible, and feature issues reach the correct disposition in acceptance tests.
- New relevant issue information resumes the same work item without replaying completed durable steps incorrectly.
- Evidence is visible on the issue and in the console.

### Phase 4: Planning, risk, and approvals

Deliverables:

- Structured plans and revisions.
- Deterministic risk floors plus agent-supported assessment.
- GitHub approval command path and approval-status console view.
- Approval binding and invalidation.

Exit criteria:

- Low-risk fixtures proceed automatically.
- Medium/high-risk and protected-path fixtures cannot implement without valid approval.
- Approving an old plan revision or SHA has no effect.

### Phase 5: Implementation and local validation

Deliverables:

- Branch workspace and implementation adapter.
- Validation ladder and bounded repair loop.
- Patch/provenance artifacts.
- Budget reservations and enforcement.

Exit criteria:

- A representative Perl bug is fixed and passes local format/compile/targeted validation.
- Invalid formatting is caught before any push.
- Time, turn, tool, and budget exhaustion stop cleanly with recoverable work.

### Phase 6: Independent review and draft PR

Deliverables:

- Reviewer adapter and structured findings.
- Bounded review-to-revision loop.
- Branch push, draft PR template, and evidence links.
- GitHub CI observation for exact head SHA.

Exit criteria:

- A separate provider reviews the produced diff without implementation-session context.
- An actionable seeded defect is detected, revised, and revalidated.
- A passing run creates a draft PR and ends at `awaiting_human_merge`.
- Roundhouse cannot merge through either UI or command path.
- Human PR questions receive evidence-backed answers, and in-scope change requests produce a new validated revision.
- Scope-expanding or unauthorized PR comments cannot widen capabilities and instead pause or are ignored according to policy.

### Phase 7: Hardening and pilot

Deliverables:

- Reconciliation, operational dashboards, alerts, backup/restore, artifact access controls, and redaction tests.
- Pilot runbook and incident/kill-switch procedures.
- Evaluation report from real repository issues.

Exit criteria:

- At least ten diverse real or historically replayed issues complete with measured accuracy, cost, duration, intervention rate, and failure categories.
- No known path exposes long-lived credentials to repository execution.
- Operators can explain every GitHub write from the audit record.

## 20. Evaluation plan

Before autonomous pilot use, assemble a replay set of historical issues:

- Clear reproducible bug.
- Unclear bug requiring one clarification.
- Environment-specific bug.
- Intermittent/non-reproducible bug.
- Small Perl formatting/logic fix.
- Cross-language Perl/Rust boundary bug.
- JavaScript-only fix.
- Feature request.
- Migration/high-risk request.
- Prompt-injection attempt in issue or repository content.
- Protected-path modification attempt.
- Review finding requiring revision.

Track:

- Qualification disposition accuracy.
- Useful-question rate and clarification rounds.
- Reproduction success and false-reproduction rate.
- Risk under-classification and over-classification.
- Local validation catch rate before CI.
- PR acceptance and human rework.
- Review precision and missed seeded defects.
- End-to-end time, agent time, CI wait, tokens, estimated cost, and artifact volume.
- Human interventions per work item.

Security and risk false negatives are release blockers; general agent task success is a tuning metric.

### 20.1 Improvement and retrospective loop

V1 captures enough structured outcomes to support an offline improvement process:

- Qualification and reproduction outcome.
- Clarification rounds and elapsed reporter wait.
- Human plan edits and approval latency.
- Implementation, validation, and review attempts.
- Human PR comments, requested changes, and patch revisions.
- CI failures that local validation missed.
- Time to draft PR and time to merge or close.
- Human-authored commits after Roundhouse's last commit.
- Merge, close, abandon, or revert outcome.
- Tokens, estimated cost, container time, and artifact volume.

A scheduled retrospective, informally the **dream phase**, can cluster failures, identify repeated human corrections, find missing validation, compare agent-role performance, and propose changes to prompts, repository guidance, tests, policies, or execution profiles. Its output is a reviewable report with supporting run links and confidence, not an automatically applied mutation.

V1 does not let Roundhouse train itself, edit its own production policy, expand its permissions, or deploy changes based solely on this analysis. A future version may run controlled experiments or open improvement PRs, but those follow the same qualification, review, validation, and human-merge rules as any other change.

## 21. Go/no-go decisions from spikes

The following decisions deliberately remain open until measured:

1. Whether Cloudflare Containers satisfy legacy repository disk, startup, process, and network requirements.
2. Whether subscription-authenticated agent sessions are reliable enough for development-only automation.
3. Whether each packaged agent exposes sufficient structured events and tool control for unattended use.
4. Whether AI Gateway can sit on the selected agent path without losing agent functionality; direct provider access through the audited proxy is acceptable when it cannot.
5. Whether a general HTTP audit proxy plus OS-level process/file telemetry provides adequate egress and action records.
6. Whether D1 is sufficient for the projected event indexes; R2 remains the raw event store regardless.

Failure of a spike should change the relevant adapter or execution component, not the product workflow model.

## 22. Definition of V1 done

V1 is complete when, for the target monorepo:

1. A maintainer can deliberately enroll a GitHub issue.
2. Unclear issues produce useful questions and durably wait for answers.
3. Bug issues attempt reproduction and retain a verifiable evidence bundle.
4. Risk policy reliably gates plans and protected capabilities.
5. A low-risk issue can produce a locally validated branch without human intervention.
6. An independent provider reviews the change and bounded revision works.
7. A draft PR contains issue understanding, before/after evidence, plan, risk, validation, review, CI, and audit links.
8. Every control-plane and execution action is attributable and major artifacts are retained.
9. Egress is default-deny and allowed external activity is identifiable by run.
10. Circuit breakers bound concurrent work, time, iterations, and available cost signals.
11. Failures, cancellation, duplicated webhooks, and restarts do not corrupt workflow state or duplicate GitHub effects.
12. No Roundhouse path can merge a PR in V1.

## 23. Immediate next actions

1. Inventory the target monorepo and write its execution profile.
2. Select three historical issues for the first replay set: clear bug, unclear bug, and risky change.
3. Register a development GitHub App against a sandbox repository or fork.
4. Implement the Phase 1 spikes as disposable vertical experiments.
5. Record spike decisions before scaffolding the production application.
