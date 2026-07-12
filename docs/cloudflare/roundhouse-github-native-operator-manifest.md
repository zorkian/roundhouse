<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# GitHub-native operator-loop manifest

Status: approved, unapplied.

This manifest is the exact external mutation boundary authorized for the
GitHub-native operator-loop milestone. Secret values are never recorded here.

## GitHub App

Retain the existing `roundhouse-dev` GitHub App (App ID `4281837`) and its
installation only on `zorkian/roundhouse` (installation ID `146147681`). Its
repository permissions become exactly:

- Metadata: read
- Contents: read and write
- Pull requests: read and write
- Issues: read and write
- Checks: read

Enable its webhook at
`https://roundhouse-dev.rm-rf.rip/v1/github/webhook` with one generated secret.
Subscribe only to `issues`, `issue_comment`, `pull_request`, `check_run`, and
`check_suite`. Do not configure a callback, setup URL, user authorization,
organization permission, or any additional installation.

Create at most one milestone pull request, one real-code dogfood issue, one
dogfood branch, and one dogfood draft pull request. Required Roundhouse status
comments on that dogfood issue and replies to verified Copilot review threads
are authorized. No human reviewer is requested and neither pull request is
merged by this milestone.

## Cloudflare

Retain and update only:

- Worker `roundhouse-dev-control-plane`
- D1 database `roundhouse-dev-coordination`
- Queue `roundhouse-dev-runs` and its existing dead-letter Queue
- R2 bucket `roundhouse-dev-evidence`
- existing `RoundhouseExecutionContainer` application and
  `roundhouse-dev-execution` image
- existing hostname `roundhouse-dev.rm-rf.rip`

Add one Worker secret named `ROUNDHOUSE_GITHUB_WEBHOOK_SECRET`, one additive D1
migration, and new versions of the existing Worker and execution image when
needed. Retain existing schedules, resources, audit records, and evidence.
Incremental Cloudflare usage is bounded to USD 10.

The existing hostname remains Access protected except for an exact bypass of
`/v1/github/webhook`. That route accepts only `POST`; all other methods fail.
The Worker verifies the GitHub HMAC-SHA-256 signature over the exact request
bytes before parsing, then verifies event, delivery, installation, repository,
and actor policy. No second hostname or broader public route is created.

## Data and rollback

D1 may add durable tables for webhook deliveries, commands, issue-to-run
bindings, recoverable GitHub comment intents, and observed check state. R2
continues to retain immutable execution evidence. Existing exact-base,
patch-hash, approval, evidence, actor, and verified-publication invariants are
unchanged.

Rollback is a Worker version rollback, removal of the exact Access bypass, and
removal of the webhook secret in a later reviewed operation. The additive
schema, retained deliveries, audit records, dogfood artifacts, and immutable
evidence remain inspectable. No destructive rollback is applied.
