<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Roundhouse

![Roundhouse orchestration hub: coding-agent engines routed through a human-controlled software delivery workflow](docs/assets/roundhouse-banner.png)

Roundhouse is a working dogfood POC for turning a GitHub issue into a
reviewable draft pull request. It qualifies untrusted issue text against
repository policy, runs a bounded coding agent in an isolated container,
validates the result, publishes it through a credentialed control plane, and
asks Claude to review the exact pull-request head. GitHub remains the place
where changes merge: eligible low-risk development work may merge automatically
after exact-head validation, repository CI, and independent review all pass;
other work waits for a human decision.

V1 is defined by the
[maintainer acceptance checklist](docs/v1-maintainer-acceptance.md), which is
not yet passing. Internal components, tests, and successful dogfood deployments
do not by themselves establish V1 acceptance.

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
   request ready.
6. Eligible low-risk development work merges automatically only when exact-head
   validation, repository CI, and independent review all pass. Medium- or
   high-risk work, and work that is not eligible under repository policy,
   pauses at the configured human boundary for a merge or rejection decision.

Use `/rhd` (or `/roundhouse-dev`) only for the development deployment. Use
`/rh` (or `/roundhouse`) only for production. Each deployment ignores the
other command family and keeps its plans, runs, branches, and comments separate.
Follow-up commands include the correct prefix and required identifiers; copy
the exact command Roundhouse posts rather than constructing one by hand.

After a merge to `main`, the repository's `Release development` GitHub workflow
runs checks, builds the release once, and deploys that commit to development.
This CI/CD reaction is repository-owned; deployment is outside Roundhouse's
product responsibility. Production is not updated by the merge. `Promote
production` reuses the exact successful development artifacts and is a separate
action protected by the `roundhouse-production` GitHub environment and human
approval.

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
  pull requests, and can merge eligible low-risk development work at its exact
  validated head. Branch protection and repository policy remain authoritative.

Start with [ADR 0008](docs/decisions/0008-lean-open-source-poc-security-boundary.md)
for the V1 security boundary, the
[maintainer acceptance checklist](docs/v1-maintainer-acceptance.md),
[the current V1 architecture](docs/v1-plan.md),
[the issue-native V1 loop](docs/cloudflare/roundhouse-issue-native-v1-loop.md),
[the issue-driven live workflow](docs/cloudflare/roundhouse-issue-driven-live-operations.md),
and [the two-environment release design](docs/development/two-environment-release.md).

## Current limitations

- The current system is a single-tenant dogfood POC for explicitly enrolled public
  repositories, not a general multi-repository or private-source service.
- Roundhouse's automatic merge authority is limited to eligible low-risk
  development work at the exact validated head after validation, repository CI,
  and independent review pass. Medium- and high-risk or policy-ineligible work
  requires a decision at the configured human boundary.
- Roundhouse does not deploy generated changes. Repository CI/CD may react to a
  merge, but deployment remains outside Roundhouse's product responsibility.
- Codex and Claude credentials are narrow development exceptions inside the
  trusted container boundary, not a production credential-broker architecture.
- The operator UI polls rather than streams, and recovery after interruption
  can take several minutes.
- Validation and independent review gate automatic merge for eligible work;
  passing them does not make medium- or high-risk or policy-ineligible work
  eligible for automatic merge.
- Production promotion is never automatic and requires a separate protected
  approval after a successful development release.

## License

Roundhouse is licensed under the [Apache License 2.0](LICENSE). See
[NOTICE](NOTICE) for attribution information.
