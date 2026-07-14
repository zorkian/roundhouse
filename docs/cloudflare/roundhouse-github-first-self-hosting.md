<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# GitHub-first self-hosting pilot

Roundhouse uses a GitHub issue as the development request and its generated
pull request as the reviewable result. A human should not need direct D1 SQL,
manual Queue messages, Wrangler database commands, or a separate Codex task to
follow ordinary progress.

## Operator path

An enrolled issue receives a compact live-run comment plus a bounded timeline
of meaningful milestones. Planning, a human action request, publication, each
independent-review cycle, a failure, and merge completion remain visually
distinct so the operator does not have to reconstruct overwritten history.
The live comment and milestones link to the aggregate workflow page:

`/repositories/OWNER/REPOSITORY/issues/NUMBER`

The page collects the immutable plan, source and remediation runs, generated
pull request, review cycles, exact reviewed heads, finding counts, and retained
evidence links. Detailed plan, run, revision-history, review, and evidence
pages remain available for diagnosis. Successful CI observations stay quiet;
they do not create issue comments merely because a check was observed.

Independent review is projected as one comment per review cycle on the issue
and generated pull request. The comment starts as “review in progress,” then is
updated with Claude's summary, exact reviewed head, substantive findings,
recommendations, Roundhouse dispositions, and retained-review link. A completed
review makes the pull request ready for human review; bounded remediation keeps
it draft until the next exact-head review finishes.
The existing GitHub App installation has read-only Checks permission, and this
milestone does not expand app scope. The exact-head Check adapter therefore
remains contract-tested but disabled until a future permission review. Durable
D1 outboxes make duplicate delivery and ambiguous GitHub responses
reconcilable.

## Repository identity and future tenancy

GitHub issue numbers are not globally unique. New status contracts therefore
use the tuple `(repository_full_name, issue_number)`, and review Checks use
`(repository_full_name, review_id)` with an exact head SHA. Routes and external
URLs carry the owner and repository explicitly.

V1 enrolls only `zorkian/roundhouse`. Older plan and issue-run tables were
built as a single-repository adapter and still use an issue number internally.
The HTTP boundary rejects unenrolled repositories, and new work must not add
another issue-number-only dependency. A multi-tenant milestone will migrate
those older tables behind repository and installation identities before a
second repository is enrolled.

## Recovery semantics

Status projections are latest-state records, not event logs. A newer revision
supersedes an older pending projection, and a stale durable claim cannot mark
itself sent. Only one expiring delivery claim is valid at a time. A failed or
interrupted delivery returns to pending, while the next attempt reconciles by
the stable HTML marker or GitHub Check external ID before creating anything.
There remains a bounded race in which an already-claimed older projection can
briefly reach GitHub before the durable CAS rejects it; the next projection
self-corrects the display. Closing that external display race is deferred to
post-POC hardening because it does not change authoritative workflow state.

Immutable workflow events, evidence, approvals, exact bases, patch hashes, and
publication bindings remain in their existing durable stores. Updating a
status projection never changes or weakens those authoritative records.

The trusted implementation lease is forty minutes: five minutes beyond the
combined bounded twenty-minute agent and fifteen-minute validation budgets.
This prevents scheduled recovery from duplicating a still-active Container
attempt. A future heartbeat lease can shorten crash-recovery latency without
changing the coordinator or evidence contracts.

## Pilot procedure

1. Open a bounded issue whose requested paths are accepted by the reviewed
   Roundhouse profile.
2. Post `/rh start`, inspect the proposed immutable plan, then post the exact
   approval command supplied by Roundhouse.
3. Follow the rolling status link while the cloud Container implements and
   validates the change.
4. Post the exact patch approval command after independently checking its base,
   patch SHA-256, and evidence set.
5. Let Roundhouse publish the approved commit and run independent review on
   the exact pull-request head.
6. If substantive in-scope findings are accepted, approve the bounded
   remediation patch and inspect the final exact-head review projection.

## Demonstration record

Pilot issue `zorkian/roundhouse#23` exercised implementation, exact approval,
publication, independent review, bounded remediation, a second exact approval,
and final independent review entirely through the GitHub-first path:

- plan `plan_a218e7a92e18d6df75a70753532319cae8af9b36`, based on
  `0529c8ba3b172b02c676961af7fbf0602a07c879`;
- source run `run_a4a3df825bc5b9887be497dfcc14dcf23be6b22f`, patch
  `158a10ec121e947d84527c504974049966dba975462d3da24418cc9b610f4732`;
- source commit `9e8e6edfc4a8bfca5c6ed35ac243f064cec4cd53` on generated
  pull request `zorkian/roundhouse#26`;
- first review `review_d94b36a97cc07f86b3119cfcfb3564a21e4fedba`
  accepted one test-isolation finding for bounded remediation;
- remediation run `run_265a0efe5b9474f5cdb92eb17d2b8b9cd89972f1`, patch
  `159af16c8b5bd350d4643be5f986b5e441a294c5bcf0350fccdb131f7099877f`;
- remediated head `2f568676da87a3ee9aa3a8666d74b113548fe1fe`, with
  GitHub CI successful;
- final review `review_ffab993a726341d9d61768582e937a4141eabedd`
  completed with zero findings. Its retained review evidence is
  `reviews/review_ffab993a726341d9d61768582e937a4141eabedd/attempts/review_ffab993a726341d9d61768582e937a4141eabedd-attempt-1/review.json`,
  SHA-256
  `47154c9d66f5e5fe64220b87b0cf7a59bae455c43150bd6ec24ee8797b24aac7`.

The first source attempt also exposed that a five-minute coordinator lease was
shorter than the bounded agent-plus-validation budget. The corrected
forty-minute lease then allowed the exact retry to finish without concurrent
ownership. A transient GitHub publication failure after remediation approval
left the run safely at `awaiting_publication`; replaying the exact idempotent
command published only the already-approved patch.

Pilot issue `zorkian/roundhouse#24` exercised an interrupted retry followed by
the complete implementation, approval, publication, CI, and independent-review
path:

- plan `plan_2d09e909f75963b83b22b84a0dfc0873ac836611`, based on
  `0529c8ba3b172b02c676961af7fbf0602a07c879`;
- source run `run_583a5d82f2f82a6600a579e48c422b82f9bb6f60`, whose first
  three attempts durably retained their `container_interrupted` failures;
- successful attempt `run_583a5d82f2f82a6600a579e48c422b82f9bb6f60-prepare-4`,
  patch `dbaec29e091c21f5fb36268ee9298b5ef26fd51c4fd031937c809d46978220fd`;
- implementation evidence
  `runs/run_583a5d82f2f82a6600a579e48c422b82f9bb6f60/attempts/run_583a5d82f2f82a6600a579e48c422b82f9bb6f60-prepare-4/trusted-implementation.json`,
  48,708 bytes with SHA-256
  `b9e798f0cc4109c2bb7beacaea76ec3e57a34b2fbb34fde975a9564f151396a0`;
- source commit `98e184b4887402e71148ff2093c8850da6a0e485` on generated
  pull request `zorkian/roundhouse#27`, with GitHub CI successful;
- review `review_33cd79f0501f095878ff2aad99e87f9e4f2c2e5c` completed on
  that exact head. Its one low-severity test-diagnostic suggestion was deferred
  under the functionality-first V1 policy; no security, correctness, or
  production finding remained;
- review evidence
  `reviews/review_33cd79f0501f095878ff2aad99e87f9e4f2c2e5c/attempts/review_33cd79f0501f095878ff2aad99e87f9e4f2c2e5c-attempt-1/review.json`,
  2,677 bytes with SHA-256
  `f90408e8b9b9b54fd757a688c0b3af02adf92cd62a7c8b2af7e7d474d28bbd7e`.

Both pilots kept their requested change to one predeclared test path. Reusing
Miniflare removes repeated lifecycle setup inside those files, but cold test
process startup, D1 calls, and whole-repository validation still dominate wall
clock time. Further harness profiling remains useful V1 follow-up work rather
than a reason to withhold these bounded changes.

## Current V1 limitations

- only the public `zorkian/roundhouse` installation is enrolled;
- plan and issue-run persistence still has a single-repository adapter beneath
  the repository-qualified boundary;
- the UI polls every five seconds and does not stream Container output;
- marker reconciliation is bounded to one GitHub API page of up to 100 issue
  comments; normal updates use the retained exact GitHub comment ID, while
  unusually noisy issues may require a later paginated recovery improvement;
- the Codex and Claude subscription credentials remain narrow development
  exceptions rather than the production credential architecture;
- pilot pull requests require a human merge decision;
- reliability hardening beyond the fundamental security and publication
  invariants is intentionally deferred in favor of reaching a useful V1.
