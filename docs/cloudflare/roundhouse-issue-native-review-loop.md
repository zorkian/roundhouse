<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Issue-native independent review loop

Roundhouse starts an independent Claude review only after an exactly approved
implementation has become a verified GitHub commit and draft pull request. The
review is a new durable workflow, not hidden work inside publication. Its D1
record binds the issue, plan, source run, base commit, pull-request head, patch
SHA-256, retained implementation evidence, attempt, and review cycle.

## Execution boundary

The existing Container checks out the exact public pull-request head while
access to `github.com` is enabled. The Worker then replaces checkout access
with the single measured model-transport host, `api.anthropic.com`. Claude Code
`2.1.142` runs with an isolated home, no tools, no MCP servers, no browser,
bounded output, and a maximum fifteen-minute attempt. The Worker revokes model
transport before collecting the result and verifies denied HTTP and non-HTTP
probes.

The development setup token reaches the reviewer only as the in-memory
`CLAUDE_CODE_OAUTH_TOKEN` environment variable. It is not a process argument or
file and is removed before evidence capture. The Container receives no GitHub,
Cloudflare, or Codex credential. Review evidence is rejected if it contains the
token and is stored at the immutable R2 key
`reviews/REVIEW_ID/attempts/ATTEMPT_ID/review.json`. D1 retains the exact key,
SHA-256, byte size, media type, producing attempt, and reviewed head.

## Findings and bounded remediation

Claude emits schema-validated findings. Roundhouse derives each finding ID
from the review ID, head commit, and normalized finding, making retries and
duplicate Queue delivery harmless. The V1 policy accepts only critical, high,
or medium findings on the plan's literal allowed paths. Low-severity and
out-of-scope findings remain visible but deferred.

Accepted first-cycle findings create one fresh Codex task whose base is the
reviewed pull-request head and whose path set, plan, validation profile, issue,
branch, and publication policy are inherited unchanged. Review text is
untrusted input and cannot widen those boundaries. The remediation task stops
at the existing exact approval gate. Once approved, publication can advance
the existing dogfood branch only when its current remote head still equals the
reviewed commit; the update is non-force. A new verified commit triggers the
second and final independent review. Findings from that final cycle are
retained and deferred rather than causing an unbounded loop.

## Recovery and inspection

Review reservation, dispatch state, exclusive lease, attempts, findings,
dispositions, remediation identity, and events survive Worker restart.
Scheduled recovery re-enqueues stranded pending reviews and expired leases.
Only one lease is valid; an expired lease reclaims the same attempt identity,
so immutable evidence can be reconciled instead of duplicated. Infrastructure
failures retry at most three times. Contract or credential-boundary failures
are terminal.

The Access-protected dashboard lists plans, runs, and independent reviews.
Issue, commit, pull-request, plan, remediation-run, and exact evidence
identities are links. Review pages show findings, dispositions, and revision
history. The following authenticated routes are useful during development:

- `/reviews/REVIEW_ID` and `/v1/reviews/REVIEW_ID`;
- `/v1/reviews/REVIEW_ID/evidence`;
- `/v1/runs/RUN_ID/evidence/EVIDENCE_ID`;
- `/v1/plans/PLAN_ID/evidence`.

Every evidence response rereads the retained R2 bytes and checks the D1-bound
SHA-256 and size before returning them. Routine successful CI observations are
still durable in D1 but no longer produce issue comments. Review state changes
post one concise issue update with a direct status link.

## Deployment and rollback

The approved deployment adds D1 migration `0008_independent_review.sql`, the
encrypted `ROUNDHOUSE_CLAUDE_AUTH_JSON` Worker secret, the pinned Claude Code
binary in the existing execution image, and the two review feature variables
in the existing Worker. It creates no Cloudflare or GitHub resource.

Rollback remains dry-run only: deploy the preceding Worker version and
immutable execution image, then remove the Claude secret only under fresh
authorization. Retain the additive tables, events, findings, runs, R2 objects,
issues, pull requests, and demonstration evidence.

## Current V1 limitations

- The review policy is deterministic and intentionally favors functional V1
  progress over automatically fixing low-severity hardening suggestions.
- Review findings are visible in Roundhouse but are not yet published as
  native GitHub inline review threads.
- A human must approve each remediation patch before publication.
- The operator UI polls every five seconds and does not stream Container logs.
- The Claude and Codex subscription credentials are narrow development
  exceptions, not the production credential architecture.
- Only the public `zorkian/roundhouse` repository and fixed dogfood branches
  are supported.
