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
that path namespace because GitHub cannot complete an interactive Access login.
The Worker exposes only the exact endpoint, returns `404` for child paths, and
accepts only `POST` there before authenticating GitHub independently:

1. Read at most 1 MiB of exact request bytes.
2. Verify `X-Hub-Signature-256` with HMAC-SHA-256 before JSON parsing.
3. Require the configured installation ID and `zorkian/roundhouse` repository.
4. Persist the delivery ID, event, payload hash, installation, repository, and
   sender before effects.
5. Grant operator authority only to the configured development maintainer
   (`zorkian`). Other issue prose remains untrusted input.

The five configured GitHub subscriptions are `issues`, `issue_comment`,
`pull_request`, `check_run`, and `check_suite`. GitHub's implicit signed `ping`
event is also accepted for webhook health verification and has no workflow
effect.

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

Every run status comment includes an Access-protected inspection URL keyed by
run ID. The current target is the structured JSON inspection endpoint. A richer
human-readable live timeline is intentionally left to the next operator-UI
milestone without changing the durable run API.

Queue consumers post status after durable stage transitions. Awaiting-approval
status includes the exact copyable command. Completed publication status
includes the draft PR URL. Check-run and check-suite events are stored by pull
request and exact head SHA; events for another head never satisfy that head.

The development execution image bakes the repository's locked workspace
dependencies at image-build time. A fresh exact-commit checkout receives that
dependency overlay only when its `pnpm-lock.yaml` SHA-256 matches the image
binding. Validation therefore runs with network disabled and without a runtime
package installation; a lock mismatch fails before agent execution.

## Applied cloud demonstration

The approved manifest was applied without creating another hostname, DNS
record, Worker, D1 database, Queue, R2 bucket, or Container application:

- GitHub App `roundhouse-dev`: app `4281837`, installation `146147681`, scoped
  only to `zorkian/roundhouse`;
- Access application `Roundhouse GitHub webhook`:
  `47c28288-e6d1-4625-9df6-5b1ca8216621`;
- additive migration: `0006_github_native_operator.sql`;
- Worker `roundhouse-dev-control-plane` version
  `e4450372-0f5c-4229-ace5-aeffd5b232f4`;
- Container application version `21`, immutable image
  `sha256:1d62376c2d19ac11040ae4ca57402a51f270b1a8676d52a28bdb005f3596330a`.

Live boundary probes returned an empty `404` for
`/v1/github/webhook/extra`, `405` for `GET /v1/github/webhook`, `401` for a
structurally valid delivery with an invalid HMAC, and an Access login redirect
for `/v1/operations/alerts`. A signed GitHub App `ping` was accepted without a
workflow effect.

Dogfood issue [#14](https://github.com/zorkian/roundhouse/issues/14) started
run `run_72e8989151d68ed991bfbe356e2e452e453955fc` at exact base
`510fae10d48396d80751a277bcb99d6c07d906e8`. Earlier attempts exposed and then
demonstrated recovery from an expired lease, safe bounded retry, precise
validation-failure classification, and the missing offline dependency boundary.
After dependencies were baked into the immutable image, attempt
`run_72e8989151d68ed991bfbe356e2e452e453955fc-prepare-8` succeeded with:

- patch SHA-256
  `675b83cbf528d08480b6ee8c90cfca258bc0b573c10f19817c1a9a1ef0d2a0da`;
- evidence object
  `runs/run_72e8989151d68ed991bfbe356e2e452e453955fc/attempts/run_72e8989151d68ed991bfbe356e2e452e453955fc-prepare-8/trusted-implementation.json`;
- evidence SHA-256
  `a79052f9a3c8c5e1714a80d40a9a6fa185ab9521b18f86fbc719f8bc6c78fb2e`,
  57,505 bytes;
- evidence-set SHA-256
  `d390e16e7e1cf50696942111595eb3cd15d123c47e43834f3bc8cbb2474c23c2`;
- successful diff, format, Apache-2.0 header, typecheck, and 157-test gates;
- denied HTTP and raw TCP probes after credential removal.

The exact GitHub approval at revision 35 produced only commit
`75337bb3dca4f728e022375e98cdefa074b129bb`, whose sole parent is the approved
base. The two published blob SHA-256 values exactly match the retained
publication manifest. Draft dogfood PR
[#15](https://github.com/zorkian/roundhouse/pull/15) passed CI, and signed
`check_suite` and `check_run` deliveries for that exact head were durably
observed and reported back on issue #14.

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
