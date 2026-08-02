<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Roundhouse

![Roundhouse orchestration hub: coding-agent engines routed through a human-controlled software delivery workflow](docs/assets/roundhouse-banner.png)

Roundhouse is an open-source agent that helps turn a software request into a
validated GitHub change. It investigates the request, proposes a plan,
implements a fix in an isolated environment, reviews the candidate, waits for
repository CI, and merges only when the repository's policy allows it.

Maintainers stay in the loop for real questions and judgments. They should not
need to babysit every step.

> [!CAUTION]
> Roundhouse is experimental, pre-release software. Use it only with
> explicitly enrolled public repositories. Generated code and automated reviews
> can be wrong. Do not give it private data or credentials that cannot be
> revoked.

## Should you keep reading?

Roundhouse may be interesting if you:

- maintain a public GitHub repository and want help moving from issue to pull
  request without giving an agent broad production access;
- want a workflow you can inspect and configure in the repository, rather than
  a black-box coding bot; or
- care about clear authority boundaries: agents propose and implement;
  Roundhouse publishes and merges only after deterministic checks.

It is probably not what you want yet if you need a polished production product,
private-repository support, or a one-click install for arbitrary repos. Today
it is a working prototype for enrolled public repositories.

## What it does

You can start in two ways:

1. **Ask first.** In the Roundhouse UI, start a read-only conversation about one
   enrolled repository. Refine the request, review a delivery brief, and only
   then promote it into a GitHub issue and a delivery run. Some conversations
   end with an answer and no code change.
2. **Start from an issue.** An authorized operator starts Roundhouse on a
   GitHub issue that is already clear enough to work.

A delivery run then roughly follows this path:

1. Qualify the request and ask only material questions.
2. Investigate and reproduce the problem when possible.
3. Plan the change.
4. Implement it in the repository's development environment, inside an isolated
   sandbox.
5. Validate the candidate and open a draft pull request.
6. If there are screenshots, ask an operator to review the visual evidence.
7. Run independent reviewers on the exact candidate commit.
8. Integrate with the current target branch, wait for CI on that same commit,
   and merge automatically or leave the pull request for a maintainer.

GitHub remains the source of truth for issues, pull requests, CI, and merged
code. Roundhouse coordinates the work; it does not replace GitHub.

## How a repository opts in

An enrolled repository configures Roundhouse with files under `.roundhouse/`:

- `profile.yaml` — who may operate it, merge policy, validation commands,
  protected paths, and conversation settings
- `workflow.yaml` — the delivery lifecycle: nodes, models, prompts, reviews,
  and transitions
- `prompts/` — longer instructions referenced by that workflow

Roundhouse loads those files from one exact commit and snapshots them onto each
run, so an active run does not silently change when repository config changes
later. Repositories shape the workflow; they do not supply Roundhouse's
credentials or expand what agents are allowed to do.

## Trust boundaries, briefly

Coding agents do not receive GitHub App, cloud-admin, deployment, or
model-provider credentials. They work in isolated sandboxes. Publishing a pull
request and merging it happen in the trusted control plane, only after the
candidate has been validated.

That boundary is a core product claim, not an implementation footnote. The
architecture document explains how it is enforced.

## Project status

Roundhouse is an active V2 prototype. In development it can:

- explore a repository question in a read-only conversation and promote a brief
  into delivery;
- take an issue through investigation, planning, implementation, review, CI,
  and merge; and
- let repositories customize that journey through `.roundhouse/` configuration.

It is not ready for general production use.

V1 is preserved at the `v1-poc-final` tag.

## Go deeper

| Document                                                                               | Read it when you want…                                                  |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [V2 plan](docs/v2-plan.md)                                                             | the product contract, architecture, security kernel, and acceptance bar |
| [Conversational entry](docs/conversational-entry-proposal.md)                          | how the ask-first conversation surface works                            |
| [Conversational implementation plan](docs/conversational-entry-implementation-plan.md) | the v0 persistence, adapter, and test contracts                         |
| [Future improvements](docs/future-improvements.md)                                     | deferred ideas that are explicitly not approved work                    |
| [AGENTS.md](AGENTS.md)                                                                 | notes for automated agents working in this repository                   |

## Repository layout

| Path                      | Purpose                                                   |
| ------------------------- | --------------------------------------------------------- |
| `apps/control-plane`      | GitHub intake, conversations, coordination, and dashboard |
| `apps/runtime-host`       | Isolated sandbox and container host                       |
| `apps/model-broker`       | Private model routing and credential boundary             |
| `containers/agent-runner` | Coding-agent runtime                                      |
| `packages/core`           | Shared profiles, workflow compiler, and contracts         |
| `docs/`                   | Product and architecture documentation                    |

## Development

Roundhouse is a pnpm monorepo of Cloudflare Workers. There is no local product
dev server; the usual local path is install and check.

You need Git, Node.js 24 (see `.node-version`), Corepack, and pnpm 10.13.1.

```sh
corepack enable
corepack prepare pnpm@10.13.1 --activate
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` formats/license-checks, typechecks, syntax-checks the agent
runner, and runs tests. Individual commands: `pnpm test`, `pnpm typecheck`,
`pnpm format:check`.

Deploying to the Cloudflare development environment is separate and requires
authenticated Cloudflare, GitHub App, and AI Gateway credentials. See the
[V2 plan](docs/v2-plan.md) and `package.json` scripts if you need that path.

## License

Roundhouse is licensed under the [Apache License 2.0](LICENSE). See
[NOTICE](NOTICE) for attribution information.
