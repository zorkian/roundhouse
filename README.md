<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Roundhouse

![Roundhouse orchestration hub: coding-agent engines routed through a human-controlled software delivery workflow](docs/assets/roundhouse-banner.png)

Roundhouse is an open-source bug-fixing agent for GitHub repositories. Its job
is to turn an issue into a validated change while involving a maintainer only
when information or judgment is genuinely required.

> [!CAUTION]
> Roundhouse is experimental, pre-release software intended for explicitly
> enrolled public repositories. Generated code and automated reviews can be
> wrong. Do not use it with private data or credentials that cannot be revoked.

## How it works

1. An authorized maintainer starts Roundhouse on a GitHub issue.
2. It qualifies the report, asks focused questions when needed, and attempts to
   reproduce bugs before planning a fix.
3. An agent implements the accepted plan in an isolated container and runs the
   repository's validation commands.
4. Roundhouse validates and promotes the resulting Git checkpoint, then opens
   a draft pull request.
5. Independent reviewers inspect the exact candidate commit. Actionable
   findings send the change back through implementation and validation.
6. Repository CI must pass for that same commit before Roundhouse can merge it.

GitHub remains the source of truth for issues, pull requests, CI, and merged
code. A Cloudflare Worker coordinates each run, D1 stores workflow state, and
Cloudflare Artifacts carries Git checkpoints between isolated containers. A
private model broker selects models without exposing provider credentials to
the agent container.

The credential boundary is central to the design: implementation agents do not
receive GitHub App, Cloudflare administration, deployment, or model-provider
credentials. Promotion happens separately, with a short-lived GitHub token,
only after the candidate checkpoint has been validated from a clean clone.

## Project status

Roundhouse is an active V2 prototype. The end-to-end development workflow can
qualify and investigate an issue, plan and implement a change, validate and
review the exact commit, run repository CI, and merge it. It is not ready for
general production use.

V1 is preserved at the `v1-poc-final` tag. The [V2 plan](docs/v2-plan.md) is
the normative product and architecture document.

## Repository layout

| Path                          | Purpose                                                           |
| ----------------------------- | ----------------------------------------------------------------- |
| `apps/control-plane`          | Cloudflare Worker that handles GitHub intake and coordinates runs |
| `apps/model-broker`           | Private model routing and credential boundary                     |
| `containers/agent-runner`     | Isolated coding-agent runtime                                     |
| `packages/core`               | Shared workflow state, contracts, and repository profiles         |
| `packages/response-observer`  | Streaming model-response observation                              |
| `docs/v2-plan.md`             | Product contract, architecture, and acceptance criteria           |
| `docs/future-improvements.md` | Deferred ideas that are not approved implementation work          |

## Development

You need Git, Node.js 24 (the exact version is in `.node-version`), Corepack,
and pnpm 10.13.1.

```sh
corepack enable
corepack prepare pnpm@10.13.1 --activate
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` verifies formatting and Apache-2.0 headers, typechecks the
workspace, and runs the test suite.

Useful individual commands are:

```sh
pnpm test
pnpm typecheck
pnpm format:check
```

`pnpm deploy:development` deploys the development model broker, applies D1
migrations, and deploys the control plane. It requires an authenticated
Cloudflare development environment and is not needed for local checks.

## License

Roundhouse is licensed under the [Apache License 2.0](LICENSE). See
[NOTICE](NOTICE) for attribution information.
