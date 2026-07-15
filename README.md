<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Roundhouse

![Roundhouse orchestration hub: coding-agent engines routed through a human-controlled software delivery workflow](docs/assets/roundhouse-banner.png)

Roundhouse is a working V1 dogfood system for turning a GitHub issue into a
reviewable draft pull request. It qualifies untrusted issue text against
repository policy, runs a bounded coding agent in an isolated container,
validates the result, publishes it through a credentialed control plane, and
asks Claude to review the exact pull-request head. GitHub remains the place
where a human reviews and merges or rejects the change.

> [!CAUTION]
> Roundhouse is experimental, pre-release software for enrolled public
> repositories. Generated code may be incorrect or insecure even when checks
> pass. Do not use it with production data or credentials you cannot revoke.

## Dogfood workflow

1. An authorized maintainer writes an issue and posts `/rhd start` in
   development or `/rh start` in production.
2. Roundhouse snapshots the issue, resolves an exact base commit, and creates a
   bounded plan. It requests clarification or explicit approval when policy
   requires it.
3. Codex implements only the approved scope in an ephemeral Cloudflare
   Container and runs repository validation. The container has no GitHub,
   Cloudflare, or deployment authority.
4. The Worker verifies the result and opens a draft pull request through the
   GitHub App. Higher-risk work can require approval before publication.
5. Claude independently reviews the exact published head. Roundhouse reports
   findings and may run a bounded remediation pass before marking the pull
   request ready for human review.
6. A human reviews the diff, checks, and Claude findings, then merges or rejects
   the pull request. Roundhouse has no merge command or merge authority.

Use `/rhd` (or `/roundhouse-dev`) only for the development deployment. Use
`/rh` (or `/roundhouse`) only for production. Each deployment ignores the
other command family and keeps its plans, runs, branches, and comments separate.
Follow-up commands include the correct prefix and required identifiers; copy
the exact command Roundhouse posts rather than constructing one by hand.

After a human merge to `main`, the `Release development` GitHub workflow runs
checks, builds the release once, and deploys that commit to development.
Production is not updated by the merge. `Promote production` reuses the exact
successful development artifacts and is a separate action protected by the
`roundhouse-production` GitHub environment and human approval.

## Local development

Prerequisites are Git, Node.js 24 or newer, Corepack, and pnpm 10.13.1. No
Cloudflare or GitHub credentials are needed for the local checks.

```sh
corepack enable
corepack prepare pnpm@10.13.1 --activate
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` verifies formatting and Apache-2.0 headers, typechecks the
workspace, and runs the full test suite. Useful focused commands are:

```sh
pnpm format:check
pnpm typecheck
pnpm test -- apps/control-plane-worker/src/control-plane-worker.test.ts
```

## Cloudflare architecture

- The control-plane Worker verifies GitHub webhooks, serves the operator UI and
  APIs, applies policy, coordinates publication, and holds external authority
  outside agent execution.
- Workflows and Queues drive durable execution and review stages, retries,
  recovery, and backpressure.
- D1 stores plans, run state, leases, approvals, and projections; R2 stores
  retained patches, validation, and other run evidence.
- Cloudflare Containers provide disposable, resource-bounded repository
  checkout, Codex implementation, validation, and independent Claude review.
- The GitHub App publishes constrained branches, comments, checks, and draft
  pull requests. Branch protection and the human merge decision remain outside
  Roundhouse.

Start with [ADR 0008](docs/decisions/0008-lean-open-source-poc-security-boundary.md)
for the V1 security boundary, [the current V1 architecture](docs/v1-plan.md),
[the issue-native V1 loop](docs/cloudflare/roundhouse-issue-native-v1-loop.md),
[the issue-driven live workflow](docs/cloudflare/roundhouse-issue-driven-live-operations.md),
and [the two-environment release design](docs/development/two-environment-release.md).

## Current limitations

- V1 is a single-tenant dogfood POC for explicitly enrolled public
  repositories, not a general multi-repository or private-source service.
- Roundhouse creates draft pull requests but cannot merge, modify a protected
  default branch directly, or deploy generated changes.
- Codex and Claude credentials are narrow development exceptions inside the
  trusted container boundary, not a production credential-broker architecture.
- The operator UI polls rather than streams, and recovery after interruption
  can take several minutes.
- Automated validation and Claude review are advisory; a human must evaluate
  every generated change and decide whether to merge it.
- Production promotion is never automatic and requires a separate protected
  approval after a successful development release.

## License

Roundhouse is licensed under the [Apache License 2.0](LICENSE). See
[NOTICE](NOTICE) for attribution information.
