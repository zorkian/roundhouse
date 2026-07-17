<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Roundhouse V1 maintainer acceptance checklist

Status: **normative draft; V1 is not yet accepted**

This document defines V1 from the perspective of an open-source maintainer.
It is intentionally independent of Roundhouse's internal architecture. A
Workflow, Queue, evidence record, test, or successful merge is useful
implementation evidence, but it does not prove that the product is usable.

Roundhouse V1 is accepted only when the maintainer journeys below have passed
against live enrolled repositories and the resulting evidence is recorded in
an acceptance report.

## Product promise

For a clear, eligible issue, an authorized maintainer starts Roundhouse once
and can walk away. Roundhouse:

1. qualifies the request and asks only questions that materially affect the
   work;
2. selects the repository profile that applies to the authenticated actor;
3. reproduces reported behavior when reproduction is applicable;
4. proposes a repository-aware plan and assesses its risk;
5. implements the change in an isolated workspace;
6. formats, builds, tests, and repairs the result;
7. obtains an independent adversarial review and addresses actionable
   findings;
8. observes repository CI on the exact proposed commit; and
9. presents a reviewable pull request with a concise risk analysis and an
   explicit recommendation; and
10. merges the exact reviewed and passing head automatically when the configured
    risk policy permits it.

The maintainer should not need to understand Roundhouse plans, runs, attempts,
leases, evidence hashes, queues, or recovery machinery to make ordinary
progress. Internal identifiers may appear in diagnostic views and generated
audit records, but a maintainer never has to copy them into a command. The
normal workflow speaks in terms of the issue, proposed change, checks, risk,
and next action.

## V1 operating boundary

The acceptance target is an explicitly enrolled public open-source repository
with a reviewed execution profile. Repository content, issue text, comments,
test output, and model output are untrusted. The coding and review agents do
not receive GitHub, Cloudflare, or control-plane credentials.

Acceptance includes risk-aware merge. Low-risk work can merge automatically
after exact-head validation, CI, and independent review. Medium-risk work
pauses once for plan approval, then follows the same automatic merge path.
High-risk work pauses for plan approval and again for an exact-head final
approval after review findings and the final change summary are available.

Roundhouse's responsibility ends when the pull request is merged and closed.
Release, deployment, rollout, migration execution against project environments,
and post-deployment verification are owned by the repository and its existing
systems. Roundhouse may prepare code, migration files, runbooks, and risk
analysis for those systems, but it does not invoke or monitor them in V1.

Private repositories, arbitrary unreviewed repositories, and customer-grade
multi-tenancy are not required for acceptance. An enrolled repository may
configure a more conservative merge boundary.

Those boundaries must not be used to excuse avoidable operator work before the
merge decision.

## Maintainer interaction contract

Roundhouse is conversational, but consequential actions remain explicit. The
normal GitHub interaction uses the current issue or pull request as context:

- a concise command such as `/rh start` begins work;
- a maintainer answers clarification questions or asks follow-up questions in
  ordinary prose;
- Roundhouse interprets an authorized maintainer's unambiguous approval or
  change request in context, whether expressed through a suggested concise
  command, a GitHub control, or natural language such as "Roundhouse, this plan
  looks good; go ahead";
- explicit controls such as approve, reject, retry, cancel, and status do not
  require a plan ID, run ID, revision, commit hash, patch hash, or evidence hash;
  and
- Roundhouse performs exact revision and commit binding internally and displays
  the binding in its confirmation and audit trail.

If the request is ambiguous, multiple plans or pull requests could match, or an
approval would apply to a newer revision than the maintainer saw, Roundhouse
asks for confirmation rather than guessing. Authorization still comes from the
authenticated actor and repository policy, never from prose alone.

Current exact commands containing internal IDs, revisions, and hashes are
implementation scaffolding and do not satisfy this V1 interaction contract.

## Repository profiles and actor policy

An enrolled repository can define multiple named profiles and select one from
the authenticated GitHub actor and repository role. The selected profile is
visible on every plan and pull request in maintainer language.

A profile can govern at least:

- who may start work and which issue or pull-request actions they may take;
- allowed and protected paths or semantic change categories;
- allowed validation, database-development, and migration-authoring commands;
- resource, network, model, time, and retry limits;
- which risk levels the actor may approve or merge;
- whether automatic merge is permitted at each risk level; and
- whether the actor may change repository profile and risk policy.

The intended common shape is:

- **Repository administrator:** may change Roundhouse profiles and repository
  risk policy and may authorize any repository-scoped risk level, subject to
  Roundhouse's non-overridable global boundaries and the GitHub App's actual
  permissions.
- **Trusted committer:** cannot change profiles, but may be allowed to author
  database and migration code, approve plans, and merge low- or medium-risk
  changes. Repository policy may prohibit this profile from authorizing
  high-risk work.
- **Public contributor:** may start Roundhouse, but works inside a narrow
  change envelope such as visual-only paths. Even a low-risk result stops at a
  reviewed pull request until an authorized committer or administrator approves
  merge.

Repository risk policy supplies repository-specific signals in addition to
Roundhouse's baseline risk analysis. For example, a repository can declare
authorization, migration, billing, cryptography, or particular non-obvious
modules high risk. Risk classification examines both deterministic signals and
the semantic plan or diff, explains which rules matched, and chooses the more
restrictive result when uncertain. Repository content cannot silently lower a
non-overridable Roundhouse boundary.

Profile selection and version are bound to the plan and implementation. A
profile edit cannot retroactively broaden active work. Every consequential
action is authorized against the actor taking that action: a trusted committer
may approve merge of a public contributor's reviewed pull request without
granting the contributor committer authority. Any expansion of implementation
scope requires an explicit adoption or new revision under an authorized
profile.

Changing profiles, actor mappings, or risk policy is itself high risk. It
requires an administrator-authorized plan and final approval of the exact
reviewed policy change; a profile cannot authorize its own silent escalation.

## Definitions of success

### Autonomous progress

A clear low-risk issue started under a profile that permits low-risk automatic
merge requires no human action between the initial start and successful merge.
Roundhouse may pause only when:

- missing information materially changes the likely implementation;
- repository policy requires approval before a risky or protected change;
- validation or review exposes a decision that cannot be resolved within the
  approved scope;
- configured time, cost, or retry limits are exhausted; or
- continuing would be misleading or unsafe.

Every pause states one exact human action. If no action is needed, Roundhouse
says so explicitly.

### Fast

Speed is measured end to end, not as model runtime or webhook latency in
isolation. For the bounded V1 acceptance set:

A clear eligible issue states the observed or desired behavior, gives enough
context to identify the affected area, has bounded acceptance criteria, and
does not conceal a product decision that only a maintainer can make. An issue
does not become "unclear" merely because Roundhouse failed to inspect the
repository or ask a useful question.

| Measure                                                  | V1 target                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Durable acknowledgement of a start command               | p95 at or below 5 seconds                                                            |
| First useful GitHub status                               | p95 at or below 10 seconds                                                           |
| Qualification and initial plan for a clear issue         | p50 at or below 2 minutes; p95 at or below 5 minutes                                 |
| Clear low-risk issue to draft pull request               | p50 at or below 30 minutes; p95 at or below 60 minutes                               |
| Clear low-risk issue to successful merge                 | p50 at or below 45 minutes; p95 at or below 90 minutes                               |
| Silence while Roundhouse is actively working             | never more than 2 minutes without visible current-stage or live-progress information |
| Recovery from a transient interruption                   | resumes within 10 minutes without maintainer action                                  |
| Human interventions through merge, clear low-risk issues | zero                                                                                 |
| Human interventions through merge, medium-risk issues    | exactly one plan approval                                                            |

End-to-end pull-request timing excludes time spent waiting in an unrelated
GitHub-hosted runner queue, but includes Roundhouse planning, execution,
validation, review, remediation, publication, and its own retry delays.
Excluded time must still be shown separately rather than disappearing from the
measurement.

### Good enough to recommend

Roundhouse does not describe a change as ready merely because an agent stopped
or tests passed. The final recommendation is one of:

- **Merge automatically** -- the exact head passes validation, CI, and
  independent review; policy permits automatic merge; and known residual risks
  are stated.
- **Awaiting final high-risk approval** -- the exact head passes validation,
  CI, and independent review, but policy requires a maintainer to review the
  findings, final change summary, and residual risk before merge.
- **Needs changes** -- Roundhouse found actionable defects and has either
  exhausted its bounded repair loop or needs permission to expand scope.
- **Needs maintainer judgment** -- the evidence supports more than one
  reasonable product or engineering decision.
- **Do not merge** -- reproduction, validation, review, policy, or risk
  evidence contradicts the proposed change.

## Prioritized acceptance goals

The acceptance work is delivered as four concentric goals. Each goal is a
usable maintainer experience, not a collection of backend components. Goals
are cumulative: accepting a later goal requires every earlier goal to remain
green on the same release candidate.

The active product goal should be tracked explicitly. Work that only benefits
a later goal should not displace a broken earlier journey unless it is a
necessary foundation for that journey.

### User-filed issues as product research

Issues filed by the maintainer are evidence of real friction, including issues
that are closed or whose proposed implementation is no longer appropriate.
They inform the journeys and priorities; they are not frozen specifications
that must be implemented literally.

| Observed issues                                                                                                                                                                                                                      | Product signal                                                                                                                               | First goal affected |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| [#61](https://github.com/zorkian/roundhouse/issues/61)                                                                                                                                                                               | Risk-aware automatic merge, prompt acknowledgement, and one clear next action                                                                | Goals 1-3           |
| [#66](https://github.com/zorkian/roundhouse/issues/66), [#134](https://github.com/zorkian/roundhouse/issues/134)                                                                                                                     | Live execution visibility and truthful planning state must be obvious without drilling through internal records                              | Goal 1              |
| [#136](https://github.com/zorkian/roundhouse/issues/136)                                                                                                                                                                             | GitHub issue lifecycle is authoritative; stale internal artifacts must not create false attention                                            | Goal 1              |
| [#82](https://github.com/zorkian/roundhouse/issues/82), [#80](https://github.com/zorkian/roundhouse/issues/80), [#79](https://github.com/zorkian/roundhouse/issues/79)                                                               | Reproduction, complete review packages, correct CI/review semantics, and automatic remediation are core product behavior                     | Goals 1 and 3       |
| [#33](https://github.com/zorkian/roundhouse/issues/33), [#65](https://github.com/zorkian/roundhouse/issues/65), [#74](https://github.com/zorkian/roundhouse/issues/74), [#126](https://github.com/zorkian/roundhouse/issues/126)     | Qualification, replanning, and rejected commands must support natural recovery rather than silence or a new issue                            | Goal 2              |
| [#36](https://github.com/zorkian/roundhouse/issues/36), [#92](https://github.com/zorkian/roundhouse/issues/92), [#110](https://github.com/zorkian/roundhouse/issues/110), [#113](https://github.com/zorkian/roundhouse/issues/113)   | Retries and manual fallbacks must preserve intent, remain independently reviewed, and avoid brittle structural contracts                     | Goal 3              |
| [#83](https://github.com/zorkian/roundhouse/issues/83), [#107](https://github.com/zorkian/roundhouse/issues/107), [#120](https://github.com/zorkian/roundhouse/issues/120), [#128](https://github.com/zorkian/roundhouse/issues/128) | Latency, paid attempts, deterministic retries, and operator effort are acceptance metrics, not internal trivia                               | All goals           |
| [#133](https://github.com/zorkian/roundhouse/issues/133), [#135](https://github.com/zorkian/roundhouse/issues/135)                                                                                                                   | Repository onboarding and multiple actor-specific profiles must not require editing Roundhouse internals or escaping self-development policy | Goal 4              |

New maintainer-filed issues are reviewed during each goal. A newly observed
problem is mapped to the earliest affected goal and severity before more outer-
circle work is prioritized.

### Goal authorization and execution autonomy

This section governs the implementing operator building the Roundhouse MVP; it
is separate from Roundhouse's product authority over a maintainer's repository.

Before implementation begins, the maintainer reviews the goal's journeys,
exit gate, operating boundaries, and any goal-specific implementation plan.
When the maintainer approves that plan and says **go**, that decision grants
standing authority to complete the goal without further permission prompts.

Within that standing authority, the implementing operator may autonomously:

- create and update Roundhouse repository issues used to implement or dogfood
  the goal;
- use the Roundhouse development App through `/rhd` or `/roundhouse-dev` and
  use development resources;
- create worktrees, branches, commits, and pull requests;
- implement changes, run formatters and validation, and revise failed work;
- submit development-only Roundhouse commands and approvals that remain within
  the approved goal;
- request and evaluate independent reviews, address findings, and disposition
  non-blocking advice;
- investigate and repair CI, review, dogfood, and development-deployment
  failures;
- use manual implementation as a fallback when Roundhouse cannot progress its
  own development issue;
- merge reviewed, passing pull requests to `main` and verify the resulting
  automatic development deployment; and
- create or update non-destructive development resources, configuration, and
  additive development migrations required by the approved plan.

No additional approval is required for an individual implementation choice,
Roundhouse plan or patch approval, remediation cycle, pull request, merge, or
development deployment. Discovering that the goal needs more than one issue or
pull request does not invalidate the standing authority.

The operator continues until the goal's exit-gate evidence package is complete
or the maintainer says **stop**. A dogfood failure, review finding, CI failure,
transient infrastructure failure, or need for another in-scope PR is not by
itself a reason to pause.

Standing authority does **not** permit the operator to:

- approve, trigger, or perform a production deployment or production
  promotion;
- use the production `/rh` or `/roundhouse` command family for goal
  implementation or dogfooding;
- create, modify, or delete production resources, data, credentials,
  configuration, or protection rules;
- delete, truncate, reset, or destructively migrate development data;
- delete development resources unless separately authorized;
- contact people, organizations, repositories, or services outside the
  approved Roundhouse development scope;
- materially change the approved maintainer journeys, exit gate, security
  boundaries, or goal scope; or
- perform an otherwise destructive or irreversible action that was not
  included in the approved plan.

The operator pauses only when continuing requires one of those excluded
authorities, a material goal change, or an external decision that cannot be
resolved from the approved journeys and repository evidence. If bounded
automatic recovery is exhausted but safe in-scope manual work remains, the
operator uses that fallback instead of stopping.

Goal acceptance occurs after the evidence package is complete. It records the
maintainer's product judgment that the finished journeys feel good enough to
expand to the next circle; it is not a per-change approval gate and does not
interrupt autonomous execution within the current goal.

### Goal 1: Merge one clear low-risk issue

**Maintainer outcome:** "I start Roundhouse on a clear issue, walk away, and
come back to a tested, independently reviewed fix that is merged, with a useful
risk analysis and recommendation."

This is the smallest complete product loop. It includes the clear happy-path
parts of qualification, successful bug reproduction, low-risk planning,
implementation, formatting and validation, passing repository CI, one
independent adversarial review, visible progress, and the final decision
package, followed by exact-head merge.

Goal 1 deliberately does not require clarification, free-form questions,
medium/high-risk approval, automatic repair of seeded failures, fault-injected
recovery, multiple actor profiles, or external repository enrollment. It assumes
the existing Roundhouse administrator profile.

**Exit gate:**

- [ ] Three representative live clear low-risk issues reach a supported final
      recommendation and merge successfully. Bounded automatic recovery is
      allowed when it stays within the latency and cost targets and creates no
      duplicate paid or published work.
- [ ] At least one is a reproduced bug with a passing post-change regression
      and at least one is a small maintenance change.
- [ ] No human acts between the initial start and confirmed merge.
- [ ] Start, progress, plan, pull-request, review, and recommendation timing
      meet the speed targets.
- [ ] Each exact pull-request head passes repository CI and independent review
      before automatic merge.
- [ ] The final package states residual risk and the automatic-merge
      recommendation before merge, then reports the merge commit and closed pull
      request.
- [ ] No severity-1 or severity-2 Goal 1 defect remains.
- [ ] A maintainer reviews the three journeys and explicitly accepts that this
      basic delegation loop feels fast, clear, and worth using.

### Goal 2: Understand and steer ordinary work

**Maintainer outcome:** "When the request is not perfectly clear, I can answer
a question, ask my own question, approve proportionate risk, or request a
change without learning Roundhouse internals."

Goal 2 adds targeted clarification, feature qualification, plan and run
questions, discoverable help, medium-risk plan approval, question-only PR
conversation, and in-scope PR revisions. These interactions resume or inspect
the existing work item; they do not silently restart work or turn questions
into code changes.

**Exit gate:**

- [ ] One unclear issue completes after exactly one useful clarification
      round.
- [ ] One feature request becomes testable acceptance criteria and a supported
      recommendation.
- [ ] One plan or run question receives an evidence-backed answer without any
      workflow mutation or implementation spend.
- [ ] One medium-risk issue requires exactly one plan approval and then
      progresses autonomously through recommendation and successful merge.
- [ ] One PR question is answered without code changes, and one in-scope change
      request produces a new validated and reviewed exact head.
- [ ] Help is discoverable and malformed commands receive actionable guidance.
- [ ] No interaction requires the maintainer to construct or discover an
      internal identifier manually.
- [ ] Goals 1 and 2 have no open severity-1 or severity-2 defects, and a
      maintainer explicitly accepts the conversation and steering experience.

### Goal 3: Self-correct and stop safely

**Maintainer outcome:** "Roundhouse handles ordinary failure and iteration on
its own, and asks me for help only when it reaches a real decision or a bounded
limit."

Goal 3 adds non-reproduction dispositions, already-satisfied and duplicate
outcomes, automatic repair of mechanical validation failures, adversarial
review remediation, CI diagnosis and repair, transient infrastructure
recovery, high-risk and protected-path handling, cancellation, and bounded
terminal behavior. It is the point where the system must demonstrate that it
does not need routine babysitting when the happy path bends.

**Exit gate:**

- [ ] Non-reproducible and already-fixed reports stop with accurate evidence
      and a useful recommendation rather than a fabricated patch.
- [ ] Seeded formatter, compile, targeted-test, adversarial-review, and genuine
      CI failures each receive the correct bounded automatic repair behavior.
- [ ] A remediated patch is revalidated and independently reviewed on its new
      exact head.
- [ ] Repeated or already-dispositioned review findings terminate without a
      review treadmill.
- [ ] Transient execution/model unavailability, interrupted delivery or
      orchestration, lost-caller/deployment handoff, and transient GitHub
      operation scenarios recover within the recovery target without duplicate
      paid or published work.
- [ ] Exhausted, non-retryable, and ambiguous failures stop safely with one
      exact next action.
- [ ] A high-risk or protected-path request cannot proceed without the required
      plan approval; after exact-head review it requires a final approval bound
      to the findings and change summary from an actor whose profile may
      authorize that risk before merge.
- [ ] Stale approval, changed head, failed review, failing CI, or merge conflict
      fails closed with one exact next action.
- [ ] Prompt injection cannot grant authority, credentials, scope, network
      access, publication, or merge capability.
- [ ] Cancellation and exhausted limits stop new work promptly and preserve a
      useful diagnostic record.
- [ ] Goals 1 through 3 have no open severity-1 or severity-2 defects, and a
      maintainer explicitly accepts the failure and recovery experience.

### Goal 4: Prove the V1 on an external project

**Maintainer outcome:** "A maintainer who does not work on Roundhouse can
enroll a public repository and receive the same fast, low-babysitting
experience."

Goal 4 removes Roundhouse-specific assumptions, completes the external pilot,
proves actor-specific repository profiles, and applies the full release
scorecard. It is the V1 acceptance gate, not a new feature tier after V1.

**Exit gate:**

- [ ] A non-Roundhouse public repository is enrolled without source edits,
      direct database work, Queue manipulation, or manual Cloudflare resource
      changes.
- [ ] The repository configures administrator, trusted-committer, and public-
      contributor profiles, including repository-specific high-risk rules.
- [ ] An administrator changes the profile policy through an authorized,
      reviewed path; neither other profile can change it.
- [ ] A trusted committer can author migration code and merge permitted low- or
      medium-risk work but cannot authorize repository-defined high-risk work.
- [ ] A public contributor can start a constrained issue-to-PR journey but
      cannot expand its change envelope or cause automatic merge.
- [ ] Its maintainer completes the required live clear-bug, clarification,
      question-only, review-remediation, and CI-repair scenarios.
- [ ] The external runs meet the same autonomy, speed, safety, review, risk,
      and recommendation criteria as the Roundhouse runs, ending at the
      repository's configured merge boundary.
- [ ] The complete AC-01 through AC-16 evidence report and release scorecard
      pass at one candidate commit.
- [ ] The external maintainer explicitly accepts that the product saves more
      time than it consumes.

### Cross-cutting requirements

The goals prioritize product journeys, not security regressions. These
requirements apply from Goal 1 and cannot be deferred to a later circle:

- authenticate and authorize state-changing or resource-spending actions;
- select and bind the actor's repository profile before planning or spending
  work;
- authorize each later action against the actor taking that action without
  silently expanding the implementation profile;
- keep GitHub, Cloudflare, and control-plane credentials out of
  repository execution;
- constrain execution time, attempts, output, storage, network, and model use;
- prevent replay from duplicating paid work or GitHub writes;
- bind publication, CI, and review to the intended repository and exact head;
- publish only to constrained branches and pull requests; and
- merge only an exact reviewed and passing head under the configured risk
  policy, while retaining human authority to stop work.

### Criterion-to-goal map

Some criteria intentionally span more than one goal. The table identifies the
first required slice and when the full criterion becomes mandatory.

| Criterion                           | First required slice                                | Full criterion required |
| ----------------------------------- | --------------------------------------------------- | ----------------------- |
| AC-01 Repository enrollment         | Existing Roundhouse enrollment is assumed in Goal 1 | Goal 4                  |
| AC-02 Start and leave               | Clear low-risk path                                 | Goal 1                  |
| AC-03 Qualification                 | Clear bug and maintenance classification            | Goal 2                  |
| AC-04 Reproduction                  | Successful bug reproduction and regression          | Goal 3                  |
| AC-05 Understand and question       | Concise understandable plan                         | Goal 2                  |
| AC-06 Risk and approval             | Low-risk automatic progress                         | Goal 3                  |
| AC-07 Implementation and validation | Passing validation path                             | Goal 3                  |
| AC-08 Adversarial review            | One passing exact-head review                       | Goal 3                  |
| AC-09 Repository CI                 | Observe passing exact-head CI                       | Goal 3                  |
| AC-10 Maintainer conversation       | Questions and ordinary in-scope changes             | Goal 2                  |
| AC-11 Automatic recovery            | Cross-cutting replay safety only                    | Goal 3                  |
| AC-12 Understandable progress       | Clear low-risk path                                 | Goal 1                  |
| AC-13 Decision package              | Clear low-risk path                                 | Goal 1                  |
| AC-14 Stop safely                   | Hard resource limits apply from Goal 1              | Goal 3                  |
| AC-15 Risk-aware merge              | Low-risk automatic merge                            | Goal 3                  |
| AC-16 Actor-specific profiles       | Existing administrator profile is assumed           | Goal 4                  |

### Goal progress record

| Goal                                        | Status       | Candidate commit | Acceptance evidence | Goal acceptance |
| ------------------------------------------- | ------------ | ---------------- | ------------------- | --------------- |
| Goal 1: Merge one clear low-risk issue      | Not accepted | --               | --                  | --              |
| Goal 2: Understand and steer ordinary work  | Not accepted | --               | --                  | --              |
| Goal 3: Self-correct and stop safely        | Not accepted | --               | --                  | --              |
| Goal 4: Prove the V1 on an external project | Not accepted | --               | --                  | --              |

## Maintainer acceptance journeys

Each item requires an end-to-end demonstration. Unit tests alone do not check
the box. The criterion-to-goal map defines which slice is required at each
increment; checking the complete AC item is reserved for full V1 acceptance.

### AC-01: Enroll a repository without Roundhouse internals

- [ ] A maintainer can install and configure Roundhouse from documented
      repository-level prerequisites without editing Roundhouse source, D1 rows,
      Queue messages, or Cloudflare resources by hand.
- [ ] Enrollment validates required permissions, the default branch,
      repository guidance, validation commands, protected paths, resource limits,
      and supported runtime before accepting work.
- [ ] A failed enrollment names the missing prerequisite and the exact action
      needed to correct it.
- [ ] At least one public repository not owned by the Roundhouse implementation
      project completes this journey.

### AC-02: Start and leave

- [ ] A documented command or configured label starts work from a normal
      GitHub issue.
- [ ] GitHub receives a durable acknowledgement within the speed target while
      planning continues asynchronously.
- [ ] Duplicate webhook delivery or a repeated start cannot create duplicate
      plans, paid work, branches, pull requests, reviews, or comments.
- [ ] A clear low-risk issue merges successfully without another maintainer
      command.

### AC-03: Qualify the issue

- [ ] Roundhouse distinguishes a bug, feature, maintenance task, duplicate,
      already-satisfied request, unsupported request, and request requiring human
      judgment.
- [ ] It summarizes its understanding and testable acceptance criteria in
      maintainer language.
- [ ] It does not ask questions whose answers can be obtained from the issue,
      repository, history, tests, or configured profile.
- [ ] When information is missing, it asks a small set of targeted questions
      and explains why each answer matters.
- [ ] One maintainer response resumes the same work item without replaying
      completed work or requiring identifiers to be constructed manually.

### AC-04: Reproduce reported behavior

- [ ] For a bug, Roundhouse attempts a bounded reproduction before claiming to
      fix it unless the plan clearly explains why reproduction is inapplicable.
- [ ] The maintainer can see the command, relevant input, expected behavior,
      observed behavior, environment, repeatability, and confidence.
- [ ] A successful fix includes a post-change regression result tied to the
      original reproduction.
- [ ] If reproduction fails, Roundhouse distinguishes missing information,
      unsupported environment, intermittent behavior, expected behavior, and
      already-fixed behavior.
- [ ] It never invents a reproduction or presents an unverified patch as a
      demonstrated fix.

### AC-05: Understand and question the plan

- [ ] The plan explains what Roundhouse intends to change, why, expected user
      impact, validation strategy, important alternatives, and risk in concise
      language.
- [ ] Likely files are advisory implementation guidance, not a brittle second
      allowlist.
- [ ] A maintainer can ask a natural-language question about the issue, plan,
      run, validation, review, or risk analysis from GitHub.
- [ ] Roundhouse answers from retained evidence, distinguishes fact from
      inference, and links the relevant detail.
- [ ] Asking a question never changes code, approves work, expands scope, or
      spends an implementation budget.
- [ ] `/rh help` or an equivalent discoverable interaction explains available
      actions; malformed commands receive corrective guidance rather than silence.

### AC-06: Apply proportional risk and approval

- [ ] Every plan receives a low, medium, or high risk assessment with concrete
      reasons and identified blast radius.
- [ ] Low-risk work proceeds autonomously through implementation, exact-head
      validation, independent review, repository CI, and merge when the selected
      profile permits automatic low-risk merge; otherwise it stops at the
      reviewed pull request for an authorized actor.
- [ ] Medium-risk work requires exactly one revision-bound plan approval and
      then proceeds autonomously through the same implementation and merge path
      only when the selected profile permits medium-risk merge.
- [ ] High-risk or protected work requires a revision-bound plan approval
      before implementation and a final approval bound to the reviewed exact
      head, findings, change summary, and residual risk before merge.
- [ ] Stale approval, changed scope, changed base, or newly protected paths
      invalidate approval and explain the new decision required.
- [ ] The maintainer expresses approval in issue or pull-request context without
      copying internal identifiers or hashes; Roundhouse binds it to the exact
      revision internally and confirms that binding.
- [ ] Failed, incomplete, or stale validation, review, or CI prevents merge.
- [ ] Issue prose, repository text, test output, or review prose cannot grant
      authority or additional capabilities.

### AC-07: Implement and validate without babysitting

- [ ] Implementation uses the approved intent and repository policy while
      retaining freedom to choose the necessary policy-permitted files.
- [ ] The formatter runs in write mode before formatting validation when the
      repository profile provides that command.
- [ ] Roundhouse runs the repository's fast formatting, compile/static, and
      targeted-test ladder before spending time on full CI.
- [ ] Mechanical formatting, compilation, lint, and test failures trigger a
      bounded automatic repair attempt rather than immediate maintainer work.
- [ ] A repair reruns the relevant validation and cannot hide or relabel a
      failing command as success.
- [ ] Changed files, meaningful commands, exit results, and bounded diagnostic
      output remain inspectable without exposing credentials.

### AC-08: Perform independent adversarial review

- [ ] A reviewer independent of the implementation session reviews the exact
      proposed pull-request head.
- [ ] Review actively looks for incorrect behavior, missing tests, regressions,
      security problems, unsafe assumptions, scope drift, and misleading evidence;
      it is not merely a summary or style pass.
- [ ] Substantive in-scope findings trigger a bounded remediation and complete
      revalidation without maintainer intervention.
- [ ] The reviewer examines the remediated exact head before Roundhouse makes a
      final recommendation.
- [ ] Identical or already-dispositioned findings do not create an unbounded
      review treadmill.
- [ ] The final report distinguishes blocking findings, resolved findings,
      advisory observations, and explicit human dispositions.

### AC-09: Observe and repair repository CI

- [ ] Roundhouse binds CI observations to the exact current pull-request head.
- [ ] A genuine repository CI failure receives one bounded diagnosis and, when
      safely repairable within scope, an automatic revision and revalidation.
- [ ] Advisory review, duplicate check events, cancelled stale heads, and
      unrelated workflows do not appear as implementation failures.
- [ ] Exhausted or unsafe CI repair states identify the failed check, diagnosis,
      attempted repair, retained evidence, and one exact next action.

### AC-10: Handle maintainer conversation

- [ ] A question receives an answer rather than triggering code changes.
- [ ] An in-scope change request is interpreted, summarized, implemented,
      validated, and reviewed as a new exact head.
- [ ] An ambiguous request asks for clarification.
- [ ] An authorized maintainer can answer, approve, reject, retry, cancel, and
      request in-scope changes using concise contextual interaction rather than
      copying internal identifiers or hashes.
- [ ] A request that expands scope, risk, protected paths, permissions, or
      budget pauses for the appropriate approval.
- [ ] Unauthorized or drive-by comments cannot start work or modify code.
- [ ] Roundhouse never requires a maintainer to encode ordinary prose into an
      undocumented revision-bound command.

### AC-11: Recover automatically

- [ ] Transient execution/model unavailability, interrupted delivery or
      orchestration, lost-caller/deployment handoff, and transient GitHub
      operation failures recover automatically within explicit limits.
- [ ] Worker restart, webhook replay, callback replay, and lease expiry resume
      from durable state without duplicating external writes or paid attempts.
- [ ] A repeated provider callback does not restart a completed or still-active
      paid attempt.
- [ ] When automatic recovery is exhausted, the issue states what failed, what
      was preserved, whether retry is safe, and the single exact next action.
- [ ] A maintainer is not required to inspect raw D1 data, R2 objects, Queue
      messages, or provider transcripts for ordinary recovery.

### AC-12: Make progress understandable

- [ ] GitHub always shows the current stage, elapsed time, whether action is
      required, and either one next action or "no action needed."
- [ ] Active work exposes recent bounded progress without presenting live logs
      as authoritative evidence.
- [ ] Plans, runs, attempts, review cycles, pull requests, commits, checks, and
      retained evidence are navigable from the issue workflow.
- [ ] Terminal success, failure, cancellation, and already-satisfied outcomes
      are visually and semantically distinct.
- [ ] Internal hashes and identifiers do not dominate maintainer-facing labels
      or explanations.

### AC-13: Present a merge decision package

- [ ] The pull request identifies the source issue and describes the behavior
      change rather than merely listing files.
- [ ] For bugs, it shows before-and-after reproduction or explains why that
      evidence is unavailable.
- [ ] It summarizes changed behavior, important files, validation, CI, review
      findings and remediation, known limitations, and residual risk.
- [ ] The risk analysis covers blast radius, protected or sensitive areas,
      migration/dependency/configuration effects, rollback considerations, test
      gaps, and confidence.
- [ ] The recommendation is exactly one of the documented outcomes and is
      supported by the current exact-head evidence.
- [ ] Before merge, the package states whether policy permits automatic merge
      or requires final high-risk approval and gives the one exact action, if
      any.
- [ ] After merge, the final package reports the merge commit and closed pull
      request. It makes no claim about repository-owned release or deployment
      state.

### AC-14: Stop safely

- [ ] A maintainer can cancel active work from GitHub with a discoverable
      action.
- [ ] Cancellation stops new model/tool work promptly, revokes attempt
      capabilities, preserves useful diagnostics, and does not publish a partial
      change.
- [ ] Time, attempt, output, and model-usage limits stop cleanly and explain
      whether bounded continuation is possible.

### AC-15: Merge according to risk

- [ ] Low-risk work automatically merges the exact passing and reviewed head
      and confirms that the pull request is closed as merged when the selected
      actor profile permits it.
- [ ] Medium-risk work follows the same automatic merge path after exactly one
      valid plan approval when the selected actor profile permits it.
- [ ] High-risk work requires both a valid plan approval and a final approval
      bound to the reviewed exact head, findings, final change summary, and
      residual risk from an actor whose profile may authorize high-risk merge.
- [ ] Failed, incomplete, or stale review, validation, or CI cannot result in
      merge.
- [ ] Merge verifies the intended repository, base, and exact head; handles
      an already-merged commit idempotently; and stops on a merge conflict.
- [ ] Final status reports the merge commit and closed pull request.
- [ ] Repository-owned build, release, deployment, rollout, and migration
      execution remain outside Roundhouse's V1 workflow.

### AC-16: Apply actor-specific repository profiles

- [ ] A repository can define multiple named, versioned profiles and map
      authenticated actors or GitHub repository roles to them, with one explicit
      default for otherwise-unmatched actors.
- [ ] The applicable profile and its material restrictions are visible before
      Roundhouse spends implementation work.
- [ ] An administrator profile can change profiles and repository-specific risk
      policy through an authorized, reviewed change; profiles without that
      capability cannot do so.
- [ ] A trusted-committer profile can be allowed to author database and migration
      code and approve or merge configured low- and medium-risk work while being
      prohibited from authorizing high-risk work.
- [ ] A public-contributor profile can start work within a narrow configured
      envelope and reach a reviewed pull request, but cannot expand scope or
      automatically merge even low-risk work.
- [ ] A separately authorized committer or administrator can approve merge of a
      public contributor's exact reviewed head under their own authority without
      transferring that authority to the contributor.
- [ ] Repository-defined risk rules can elevate paths and semantic change
      categories, including non-obvious repository-specific concerns, and the
      final risk explanation identifies the matched rules.
- [ ] A plan and run retain their bound profile version. Profile changes do not
      retroactively broaden active work, and a newly restrictive policy is
      rechecked before merge.
- [ ] No repository profile can override Roundhouse's global resource,
      credential, publication, or repository-isolation boundaries.

## Acceptance scenario set by goal

The scenario set expands with the goals. A later goal reruns representative
earlier scenarios so new capabilities cannot regress the basic delegation
loop.

### Goal 1 scenarios

1. clear reproducible low-risk bug automatically merged successfully; and
2. small low-risk maintenance or formatting change automatically merged
   successfully.

At least three representative live runs are required, so one scenario type
must be repeated on a distinct issue. A bounded automatic recovery remains
eligible when it meets the journey budgets and creates no duplicate paid or
published work.

### Goal 2 scenarios

3. unclear bug requiring one clarification round;
4. feature request converted into testable acceptance criteria;
5. medium-risk change requiring exactly one plan approval and then automatic
   successful merge;
6. maintainer question requiring explanation but no code change; and
7. in-scope PR change request followed by a new validated and reviewed head.

### Goal 3 scenarios

8. intermittent or non-reproducible report;
9. already-fixed or duplicate issue;
10. high-risk migration or protected-path request requiring plan approval,
    exact-head final approval, and successful merge;
11. seeded implementation defect caught and remediated through independent
    review;
12. genuine CI failure repaired automatically;
13. transient execution or model unavailability recovered automatically;
14. interrupted delivery or orchestration recovered automatically;
15. lost-caller or development-deployment handoff reconnected to the same paid
    attempt;
16. transient GitHub operation recovered automatically;
17. exhausted, non-retryable, or ambiguous failure stopped safely;
18. prompt-injection attempt in an issue, comment, repository file, or command
    output; and
19. cancellation during active work.

### Goal 4 scenarios

Goal 4 reruns at least five scenarios live against a non-Roundhouse public
repository: a clear bug, clarification, question-only interaction, review
remediation, and CI repair. It also runs these profile scenarios:

20. repository administrator changes profile or risk policy through an
    authorized reviewed change;
21. trusted committer authors migration code and merges permitted medium-risk
    work but is denied a high-risk authorization; and
22. public contributor reaches a constrained reviewed pull request that remains
    unmerged until a trusted committer or administrator approves the exact head.

Across all goals, at least ten distinct scenarios must use real or historically
replayed issues. Fault injection may supplement but not replace live evidence
for ordinary maintainer journeys.

## Release scorecard

Acceptance defects use these severities:

- **Severity 1:** Roundhouse recommends unsafe or contradicted work, crosses a
  required authority boundary, exposes a credential, corrupts durable state,
  or cannot be stopped.
- **Severity 2:** an ordinary maintainer journey cannot complete, requires
  undocumented internal intervention, duplicates paid or published work, or
  materially misses the autonomy and speed targets.
- **Severity 3:** the journey completes safely, but avoidable friction,
  confusing presentation, or inefficient behavior remains.

V1 acceptance requires all of the following:

- [ ] Every AC-01 through AC-16 journey has live or replay evidence at the
      candidate commit.
- [ ] One external public repository is enrolled and completes the five
      required live scenarios.
- [ ] At least 90% of clear eligible low-risk scenarios reach successful
      merge without human intervention.
- [ ] Every eligible medium-risk acceptance scenario requires exactly one plan
      approval and no other human intervention through successful merge.
- [ ] At least 80% of eligible implementation scenarios reach a supported final
      recommendation; correct qualification stops do not count as failures.
- [ ] All start acknowledgements and progress visibility meet their targets.
- [ ] No duplicate paid attempt, branch, pull request, review, or authoritative
      GitHub comment occurs under replay tests.
- [ ] Every seeded security boundary and authorization test fails closed.
- [ ] Every proposed pull-request head receives independent review.
- [ ] No recommendation says ready while current CI is failing, review has an
      unresolved blocking finding, or required reproduction/regression evidence is
      contradicted.
- [ ] No automatic merge occurs unless validation, independent review, and
      repository CI pass for the exact merged head.
- [ ] Every automatic merge is recorded with the exact commit and closed pull
      request.
- [ ] Administrator, trusted-committer, and public-contributor profile journeys
      each demonstrate allowed behavior and denial of at least one prohibited
      action.
- [ ] Median and p95 end-to-end time, model tokens, estimated cost, human
      interventions, implementation attempts, review cycles, and failure category
      are reported.
- [ ] No open severity-1 or severity-2 maintainer-journey defect remains.

## Evidence requirements

The acceptance report records, for every scenario:

- repository and issue URL;
- Roundhouse release commit and environment;
- start, first-status, plan, pull-request, review-complete, CI-complete,
  recommendation, and merge-complete timestamps;
- qualification and reproduction outcome;
- initiating actor, acting approvers, selected profile and version, risk level,
  matched repository risk rules, required approvals, and actual human
  interventions;
- implementation, validation, review, and CI attempt counts;
- token and available cost measurements;
- final pull-request, exact-head commit, and merge commit;
- recommendation and eventual maintainer disposition; and
- any failed criterion with a linked issue.

A criterion is **passed** only when the evidence directly demonstrates the
maintainer-visible behavior. A unit test, green CI run, schema, or internal
record may support the evidence but cannot replace the end-to-end journey.

## Current baseline

Roundhouse is currently a dogfood POC and does not pass this checklist. Known
unmet or undemonstrated criteria include the complete risk-tiered automatic
merge workflow, contextual natural-language interaction without copied IDs or
hashes, multiple actor-specific repository profiles, repository-defined risk
rules, role-aware action authorization, command discovery and malformed-command
guidance, external repository enrollment, external pilot evidence, bounded
terminal handling of repeated review findings, truthful issue/dashboard
lifecycle projection, and a complete journey-level acceptance report.

The current profile schema describes one repository's runtime, validation,
network, protected paths, and artifacts. It does not define multiple actor
profiles or merge authority, and current GitHub authorization paths still assume
one hard-coded maintainer. AC-16 is therefore new product work rather than
acceptance evidence for an existing capability.

Progress should be reported against AC identifiers rather than a general claim
that V1 is complete. Any newly discovered maintainer-facing gap must be linked
to the affected AC criterion and added to the acceptance set when it represents
a distinct user journey.
