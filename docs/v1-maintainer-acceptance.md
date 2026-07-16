<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Roundhouse V1 maintainer acceptance checklist

Status: **normative draft; V1 is not yet accepted**

This document defines V1 from the perspective of an open-source maintainer.
It is intentionally independent of Roundhouse's internal architecture. A
Workflow, Queue, evidence record, test, or successful deployment is useful
implementation evidence, but it does not prove that the product is usable.

Roundhouse V1 is accepted only when the maintainer journeys below have passed
against live enrolled repositories and the resulting evidence is recorded in
an acceptance report.

## Product promise

For a clear, eligible issue, an authorized maintainer starts Roundhouse once
and can walk away. Roundhouse:

1. qualifies the request and asks only questions that materially affect the
   work;
2. reproduces reported behavior when reproduction is applicable;
3. proposes a repository-aware plan and assesses its risk;
4. implements the change in an isolated workspace;
5. formats, builds, tests, and repairs the result;
6. obtains an independent adversarial review and addresses actionable
   findings;
7. observes repository CI on the exact proposed commit; and
8. presents a reviewable pull request with a concise risk analysis and an
   explicit recommendation.

The maintainer should not need to understand Roundhouse plans, runs, attempts,
leases, evidence hashes, queues, or recovery machinery to make ordinary
progress. Internal identifiers may appear in copyable commands and diagnostic
views, but the normal workflow speaks in terms of the issue, proposed change,
checks, risk, and next action.

## V1 operating boundary

The acceptance target is an explicitly enrolled public open-source repository
with a reviewed execution profile. Repository content, issue text, comments,
test output, and model output are untrusted. The coding and review agents do
not receive GitHub, deployment, Cloudflare, or control-plane credentials.

V1 opens a pull request but does not merge it. A maintainer makes the final
merge decision through GitHub. Automatic merge, automatic deployment of
generated changes, private repositories, arbitrary unreviewed repositories,
and customer-grade multi-tenancy are not required for acceptance.

Those boundaries must not be used to excuse avoidable operator work before the
merge decision.

## Definitions of success

### Autonomous progress

A clear low-risk issue requires no human action between the initial start and
the merge-ready recommendation. Roundhouse may pause only when:

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

| Measure                                                              | V1 target                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Durable acknowledgement of a start command                           | p95 at or below 5 seconds                                                            |
| First useful GitHub status                                           | p95 at or below 10 seconds                                                           |
| Qualification and initial plan for a clear issue                     | p50 at or below 2 minutes; p95 at or below 5 minutes                                 |
| Clear low-risk issue to draft pull request                           | p50 at or below 30 minutes; p95 at or below 60 minutes                               |
| Silence while Roundhouse is actively working                         | never more than 2 minutes without visible current-stage or live-progress information |
| Recovery from a transient interruption                               | resumes within 10 minutes without maintainer action                                  |
| Human interventions before final merge review, clear low-risk issues | zero                                                                                 |
| Human interventions before final merge review, medium-risk issues    | at most one plan approval                                                            |

End-to-end pull-request timing excludes time spent waiting in an unrelated
GitHub-hosted runner queue, but includes Roundhouse planning, execution,
validation, review, remediation, publication, and its own retry delays.
Excluded time must still be shown separately rather than disappearing from the
measurement.

### Good enough to recommend

Roundhouse does not describe a change as ready merely because an agent stopped
or tests passed. The final recommendation is one of:

- **Ready for human merge review** -- validation and CI pass on the exact
  head, independent review has no unresolved blocking findings, and known
  residual risks are stated.
- **Needs changes** -- Roundhouse found actionable defects and has either
  exhausted its bounded repair loop or needs permission to expand scope.
- **Needs maintainer judgment** -- the evidence supports more than one
  reasonable product or engineering decision.
- **Do not merge** -- reproduction, validation, review, policy, or risk
  evidence contradicts the proposed change.

## Maintainer acceptance journeys

Each item requires an end-to-end demonstration. Unit tests alone do not check
the box.

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
- [ ] A clear low-risk issue reaches a merge-ready recommendation without
      another maintainer command.

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
- [ ] Low-risk work proceeds to a pull request without pre-publication human
      approval.
- [ ] Medium-risk work requires at most one revision-bound plan approval and
      then proceeds autonomously to its final recommendation.
- [ ] High-risk or protected work cannot implement before the required
      approval, and the approval surface clearly presents the elevated risk.
- [ ] Stale approval, changed scope, changed base, or newly protected paths
      invalidate approval and explain the new decision required.
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
- [ ] A request that expands scope, risk, protected paths, permissions, or
      budget pauses for the appropriate approval.
- [ ] Unauthorized or drive-by comments cannot start work or modify code.
- [ ] Roundhouse never requires a maintainer to encode ordinary prose into an
      undocumented revision-bound command.

### AC-11: Recover automatically

- [ ] Transient provider, network, Queue, Workflow, Container, and GitHub API
      failures retry automatically within explicit limits.
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

### AC-13: Present a merge-ready decision package

- [ ] The pull request identifies the source issue and describes the behavior
      change rather than merely listing files.
- [ ] For bugs, it shows before-and-after reproduction or explains why that
      evidence is unavailable.
- [ ] It summarizes changed behavior, important files, validation, CI, review
      findings and remediation, known limitations, and residual risk.
- [ ] The risk analysis covers blast radius, protected or sensitive areas,
      migration/dependency/configuration effects, rollback considerations, test
      gaps, and confidence.
- [ ] The recommendation is exactly one of the four documented outcomes and is
      supported by the current exact-head evidence.
- [ ] If ready, the only required human action is to review and merge or reject
      the GitHub pull request.

### AC-14: Stop safely

- [ ] A maintainer can cancel active work from GitHub with a discoverable
      action.
- [ ] Cancellation stops new model/tool work promptly, revokes attempt
      capabilities, preserves useful diagnostics, and does not publish a partial
      change.
- [ ] Time, attempt, output, and model-usage limits stop cleanly and explain
      whether bounded continuation is possible.

## Acceptance set

The release candidate must complete at least these scenarios:

1. clear reproducible bug;
2. unclear bug requiring one clarification round;
3. intermittent or non-reproducible report;
4. already-fixed or duplicate issue;
5. small maintenance or formatting change;
6. feature request with testable acceptance criteria;
7. medium-risk configuration or dependency change;
8. high-risk migration or protected-path request;
9. seeded implementation defect caught by independent review;
10. genuine CI failure repaired automatically;
11. transient Container or provider interruption recovered automatically;
12. prompt-injection attempt in an issue, comment, repository file, or command
    output;
13. maintainer question that requires explanation but no code change; and
14. in-scope PR change request followed by a new validated and reviewed head.

At least ten scenarios must use real or historically replayed issues. At least
five, including a clear bug, clarification, review remediation, CI repair, and
question-only interaction, must run live against a non-Roundhouse public
repository.

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

- [ ] Every AC-01 through AC-14 journey has live or replay evidence at the
      candidate commit.
- [ ] One external public repository is enrolled and completes the five
      required live scenarios.
- [ ] At least 90% of clear eligible low-risk scenarios reach a pull request
      without pre-merge human intervention.
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
- [ ] Median and p95 end-to-end time, model tokens, estimated cost, human
      interventions, implementation attempts, review cycles, and failure category
      are reported.
- [ ] No open severity-1 or severity-2 maintainer-journey defect remains.

## Evidence requirements

The acceptance report records, for every scenario:

- repository and issue URL;
- Roundhouse release commit and environment;
- start, first-status, plan, pull-request, review-complete, CI-complete, and
  final-recommendation timestamps;
- qualification and reproduction outcome;
- risk level and human interventions;
- implementation, validation, review, and CI attempt counts;
- token and available cost measurements;
- final pull-request and exact-head commit;
- recommendation and eventual maintainer disposition; and
- any failed criterion with a linked issue.

A criterion is **passed** only when the evidence directly demonstrates the
maintainer-visible behavior. A unit test, green CI run, schema, or internal
record may support the evidence but cannot replace the end-to-end journey.

## Current baseline

Roundhouse is currently a dogfood POC and does not pass this checklist. Known
unmet or undemonstrated criteria include natural-language questions, command
discovery and malformed-command guidance, external repository enrollment,
external pilot evidence, bounded terminal handling of repeated review
findings, and a complete journey-level acceptance report.

Progress should be reported against AC identifiers rather than a general claim
that V1 is complete. Any newly discovered maintainer-facing gap must be linked
to the affected AC criterion and added to the acceptance set when it represents
a distinct user journey.
