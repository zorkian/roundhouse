<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Issue-driven dogfooding and live operations

Production Roundhouse is the authoritative GitHub issue engine. It receives an
authorized `/rh start`, qualifies the issue, runs the bounded coding Container,
validates and publishes a draft pull request, and starts independent review.
It does not send the task to the development Roundhouse deployment.

After a human merges the generated pull request, the existing GitHub release
workflow builds the exact `main` commit and deploys it to development. The
signed pull-request event closes the loop in Roundhouse: the issue workflow
shows the merged commit and links directly to its checks and development
release.

## Operator experience

The issue reads as a short workflow timeline instead of one ever-growing
comment. Roundhouse keeps one compact live-run projection, while plans,
approval requests, publication, each independent-review cycle, failures, and
merge completion get distinct comments. A review comment is created when
Claude starts and updated in place with its verdict and substantive findings.
Every comment says whether the human needs to act.

The run page refreshes every five seconds and shows:

- durable run state, revision, base, plan, and publication;
- current and completed Container phases with elapsed time;
- attempt classification and actionable failure text;
- a bounded, cursor-polled live agent-output tail for active implementation and
  independent review attempts;
- exact retained implementation, changed files, diff, and validation;
- immutable evidence links;
- independent review status and findings; and
- safe retry and cancellation controls.

The live tail is an operator aid, not authoritative evidence. It is bounded in
the UI and stops polling after the attempt reaches a terminal state or output
remains unavailable. Retained implementation and review evidence remain the
durable basis for approval and diagnosis.

Trusted repository policy is the hard execution boundary. Approved issue
objectives and acceptance criteria express intent, while likely paths are only
advisory. A material topology difference is allowed only when repository policy
permits every resulting path. Roundhouse retains the exact changed-file
inventory and implementation summary so deterministic validation, independent
review of the exact published head, repository CI on that head, and human merge
review can evaluate the actual result.

The issue workflow links the GitHub issue, plan, source and remediation runs,
draft pull request, exact reviewed heads, merged commit, and post-merge checks.
Generated pull requests contain `Closes #NUMBER`; a signed merge webhook also
closes the bound source issue idempotently and posts the exact merge commit.
When an independent review completes without bounded remediation pending,
Roundhouse removes the draft flag so the pull request visibly becomes ready
for a human review and merge decision.

## Recovery semantics

The platform-neutral coordinator renews a healthy execution lease every minute.
The lease expires five minutes after the last successful heartbeat. A Worker
termination therefore becomes eligible for the existing scheduled recovery in
minutes instead of waiting for the former forty-minute fixed lease.

Heartbeat writes preserve the logical run revision. They cannot make a copied
revision-bound cancellation or retry command stale. Existing Queue delivery,
lease ownership, attempt idempotency, R2 evidence, retry limits, and exact
publication behavior are unchanged.

Operators should distinguish deterministic contract or repository-policy
failures, transient infrastructure failures, mechanical validation failures,
semantic independent-review findings, and repository CI failures. Retry
transient interruptions; correct policy or contract violations and mechanical
checks; address or disposition semantic findings; and inspect failed repository
checks on the exact head before merge.

## Operational verification

Before production promotion:

1. run formatting, Apache-2.0, typechecking, and the full test suite;
2. merge the reviewed milestone pull request;
3. require the ordinary development release to apply migration `0010` and
   smoke-test the Access-protected development deployment;
4. verify live phase rendering with one bounded development run; and
5. present the exact successful development release for protected production
   promotion approval.

After promotion, open one bounded Roundhouse issue and use the normal public
`/rh start` command. Verify production creates the draft pull request, the live
link shows phase progress, independent review is visible, a human merge starts
the development release, and the issue workflow links the exact merged commit
and checks.

## Remaining POC limitations

The live status projection and bounded agent tail are cursor-polled rather than
an unbounded stream. A Worker that dies may still take up to the five-minute
lease plus scheduled-trigger latency to be reclaimed. GitHub displays the
authoritative development check result; Roundhouse links to it rather than
duplicating workflow-run state in D1. Human-only merge and protected production
promotion remain explicit boundaries. Multi-repository enrollment, external
maintainers, private repositories, automatic merge, automatic production
promotion, and production model credential brokerage remain out of scope.
