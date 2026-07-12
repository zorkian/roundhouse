<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# GitHub-native operator loop

Roundhouse can use a GitHub issue as the development operator surface while D1
remains the workflow system of record. The development interface is deliberately
small: an authorized maintainer creates an issue and posts bounded `/rh`
commands. Roundhouse posts durable status updates and, after exact approval,
creates a draft pull request through its GitHub App.

## Trust boundaries

GitHub sends webhooks to
`https://roundhouse-dev.rm-rf.rip/v1/github/webhook`. Cloudflare Access bypasses
only that exact path because GitHub cannot complete an interactive Access login.
The Worker accepts only `POST` there and authenticates GitHub independently:

1. Read at most 1 MiB of exact request bytes.
2. Verify `X-Hub-Signature-256` with HMAC-SHA-256 before JSON parsing.
3. Require the configured installation ID and `zorkian/roundhouse` repository.
4. Persist the delivery ID, event, payload hash, installation, repository, and
   sender before effects.
5. Grant operator authority only to the configured development maintainer
   (`zorkian`). Other issue prose remains untrusted input.

Every other path on the hostname remains behind Access. The GitHub App private
key and webhook secret remain Worker secrets. Neither enters the execution
Container, D1, R2, comments, evidence, or logs. The Container still receives
only the narrow, temporary Codex development credential and has no GitHub or
Cloudflare credential.

## Commands

Only the first nonempty command line is interpreted. There is no arbitrary
command or shell escape.

| Command                                                      | Meaning                                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `/rh start`                                                  | Start the issue's fixed reviewed Roundhouse task, or report its existing run. |
| `/rh status [run]`                                           | Report the issue's current durable run.                                       |
| `/rh cancel <run> <revision>`                                | Cancel only the issue-bound run at the exact revision.                        |
| `/rh retry <run> <revision>`                                 | Retry only an eligible classified failure at the exact revision.              |
| `/rh approve <run> <revision> <base> <patch> <evidence-set>` | Approve the exact implementation and publish its draft PR.                    |

The Worker generates the approval command so a maintainer can copy it exactly.
`evidence-set` is the SHA-256 of the canonical ordered set of every retained
evidence binding (`evidenceId`, `objectKey`, `sha256`, and `size`). Approval is
therefore bound to the run, revision, base commit, patch SHA-256, and complete
evidence set. Publication continues through the existing trusted publisher and
cannot publish another patch.

For this milestone, `/rh start` selects a reviewed real-code profile limited to:

- `apps/control-plane-worker/src/github-gateway.ts`
- `apps/control-plane-worker/src/github-gateway.test.ts`

This is intentionally not an arbitrary repository profile selector. General
repository enrollment and profile selection remain later V1 work.

## Durability and recovery

`github_webhook_deliveries` makes exact delivery replay harmless and rejects a
delivery ID reused with different bytes or event type. Failed processing may be
retried from the same durable delivery. Issue-to-run binding makes repeated
start commands return the original run.

Issue comments use `github_comment_outbox`. A command or Queue transition first
records an idempotent comment intent keyed by run revision. GitHub delivery then
records the returned comment identity. A transient GitHub failure does not undo
the workflow mutation; the existing five-minute scheduled recovery flushes the
outbox after Worker restart or redeployment.

Queue consumers post status after durable stage transitions. Awaiting-approval
status includes the exact copyable command. Completed publication status
includes the draft PR URL. Check-run and check-suite events are stored by pull
request and exact head SHA; events for another head never satisfy that head.

## Local verification

Use Node 24, as required by the repository:

```zsh
npx --yes --package node@24.4.1 node node_modules/vitest/vitest.mjs run \
  apps/control-plane-worker/src/github-webhook.test.ts \
  apps/control-plane-worker/src/control-plane-worker.test.ts
```

The contract tests cover exact signature verification, invalid signatures,
installation and repository rejection, bounded command parsing, delivery
deduplication, issue binding, comment outbox idempotency, and the signed start
path through durable submission, Queue delivery, and GitHub comment creation.

## Operations and rollback

Normal development operation uses only issue comments. Existing Access APIs and
the local operator CLI remain available for diagnosis, but are not needed for
the demonstrated path. D1 inspection and manual Queue messages are not part of
normal operation.

Rollback is the prior Worker version plus removal of the exact webhook Access
bypass. The webhook secret may be removed afterward. Additive D1 tables and
retained audit/evidence rows stay intact. Do not apply destructive rollback SQL.

## Remaining V1 limitations

- The initial repository and actor policy is compiled development configuration.
- The reviewed profile is fixed to two GitHub-gateway files.
- Qualification, clarification, planning, independent model review, budgets,
  and multi-repository enrollment are not yet in the GitHub-native loop.
- Check observations are durable and exact-head-bound, but automatic CI repair
  and review-to-revision loops remain future milestones.
- The subscription-backed Codex credential exception is development-only and
  is not the production credential architecture.
