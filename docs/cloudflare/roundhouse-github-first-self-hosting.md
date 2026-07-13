<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# GitHub-first self-hosting pilot

Roundhouse uses a GitHub issue as the development request and its generated
pull request as the reviewable result. A human should not need direct D1 SQL,
manual Queue messages, Wrangler database commands, or a separate Codex task to
follow ordinary progress.

## Operator path

An enrolled issue receives one rolling status comment. Roundhouse updates that
comment in place as planning, implementation, approval, publication,
independent review, and bounded remediation advance. The comment always links
to the aggregate workflow page:

`/repositories/OWNER/REPOSITORY/issues/NUMBER`

The page collects the immutable plan, source and remediation runs, generated
pull request, review cycles, exact reviewed heads, finding counts, and retained
evidence links. Detailed plan, run, revision-history, review, and evidence
pages remain available for diagnosis. Successful CI observations stay quiet;
they do not create issue comments merely because a check was observed.

Independent review is projected as one rolling comment on the generated pull
request. It names the exact reviewed head, links to the authenticated review
page, and reports running, success, failure, findings, and remediation state.
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
supersedes an older pending projection; stale delivery cannot overwrite it.
Only one expiring delivery claim is valid at a time. A failed or interrupted
delivery returns to pending, while the next attempt reconciles by the stable
HTML marker or GitHub Check external ID before creating anything.

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
   remediation patch and inspect the final exact-head Check.

## Current V1 limitations

- only the public `zorkian/roundhouse` installation is enrolled;
- plan and issue-run persistence still has a single-repository adapter beneath
  the repository-qualified boundary;
- the UI polls every five seconds and does not stream Container output;
- marker reconciliation is bounded to the newest 100 issue comments; normal
  updates use the retained exact GitHub comment ID, while unusually noisy
  issues may require a later paginated recovery improvement;
- the Codex and Claude subscription credentials remain narrow development
  exceptions rather than the production credential architecture;
- pilot pull requests require a human merge decision;
- reliability hardening beyond the fundamental security and publication
  invariants is intentionally deferred in favor of reaching a useful V1.
