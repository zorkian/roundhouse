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
3. An agent implements the accepted plan inside the repository's supported Dev
   Container, nested within an isolated Cloudflare Sandbox, and runs the
   repository's validation commands.
4. Roundhouse validates and promotes the resulting Git checkpoint, then opens
   a draft pull request.
5. Independent reviewers inspect the exact candidate commit. Actionable
   findings send the change back through implementation and validation.
6. Repository CI must pass for that same commit before Roundhouse can merge it
   automatically or leave it ready for a maintainer, according to the
   repository profile.

GitHub remains the source of truth for issues, pull requests, CI, and merged
code. A Cloudflare Worker coordinates each run, D1 stores workflow state, and
Cloudflare Artifacts carries Git checkpoints between isolated containers. A
private model broker selects models without exposing provider credentials to
the agent container.

D1 also records every active revision's wakeup before Queue delivery and binds
each attempt lease to its current Cloudflare Workflow instance. Queue messages
are therefore notifications rather than workflow state. A scheduled reconciler
redelivers pending wakeups, observes terminal or inactive Workflow instances,
and resumes recorded settlement work without invoking the model again.

The credential boundary is central to the design: implementation agents do not
receive GitHub App, Cloudflare administration, deployment, or model-provider
credentials. Promotion happens separately, with a short-lived GitHub token,
only after the candidate checkpoint has been validated from a clean clone.

The outer Cloudflare Sandbox VM is the security boundary. The nested Dev
Container provides the repository's development environment but is not a
second isolation boundary: repository lifecycle commands and the agent share
the outer Sandbox's filesystem and project network access. Investigation and
implementation may reach project-selected package, image, and public research
hosts when their snapshotted node capabilities allow it; qualification,
planning, and review remain allowlisted. The current prototype is therefore
limited to explicitly enrolled public repositories.

## Repository configuration

An enrolled repository owns its reviewed configuration in
`.roundhouse/profile.yaml`. Profile V2 defines allowed and protected paths,
operators, merge mode and method, the development container, canonical
validation commands, and repository-wide instructions. The
repository-owned `.roundhouse/workflow.yaml` defines the lifecycle graph and
each agent node's typed inputs, result schema, model, prompt, capabilities, and
transitions. Review nodes define any number of always-on or conditionally
selected reviewers, their blocking/advisory/shadow mode, model, prompt, and
severity policy. Long instructions live in explicitly referenced files under
`.roundhouse/prompts/`.

Roundhouse loads the profile and every referenced instruction from one exact
default-branch commit, hashes their normalized contents, and snapshots them
onto the run. Roundhouse cannot modify `.roundhouse/**` or the selected Dev
Container configuration. Fixed Roundhouse isolation, tool, read-only, and
result-submission rules take precedence over repository instructions.

The lifecycle now runs through that declarative graph rather than a compiled
stage switch. Agent and review fan-out/join nodes are repository-composable.
Human nodes wait for participant prose or an operator decision, while named
external adapters resume typed external nodes without gaining agent or GitHub
authority. Boundary events carry a common workflow, node, actor, source, and
exact-head audit envelope.
Repositories do not supply executable control-plane code or expand
Roundhouse's credential and capability boundaries.

Every attempt stores the effective capability set minted from its immutable
workflow node. The Sandbox network policy, runner tools, hosted research,
Artifact access, and screenshot route enforce that same set. Execution
interruptions, invalid checkpoints, and superseded pull-request branches are
typed executor outcomes that return to the coordinator automatically; they are
not presented as questions for a maintainer.

The development dashboard links each enrolled repository to a workflow page
that visualizes nodes, routes, and authority from an immutable run snapshot.
It serializes that snapshot back to repository YAML, validates edits with the
same compiler, and uses GitHub's authenticated editor to create the proposed
branch and pull request. D1 never becomes workflow configuration authority.

## Project status

Roundhouse is an active V2 prototype. The end-to-end development workflow can
qualify and investigate an issue, plan and implement a change, validate and
review the exact commit, run repository CI, and merge it. It is not ready for
general production use.

The Phase 7 workflow-graph foundation described in the V2 plan is deployed in
development. No post-Phase-7 integration is approved yet. The foundation can
accept future typed adapters for organizational context, scanners, deployment
observation, alert triage, and audit export; those integrations are not
implemented or approved merely because the extension points exist.

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

Tests should protect a user-visible outcome, an external or persisted
contract, an authority boundary, a concurrency guarantee, or a failure we
have actually observed. Keep exhaustive cases at the narrowest layer and use
representative equivalence classes at adapter and end-to-end boundaries. Do
not test TypeScript guarantees, constants, library behavior, or incidental
wording and markup. Roundhouse intentionally has no coverage or test-count
target; each test must justify the maintenance it adds.

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
