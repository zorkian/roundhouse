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

Roundhouse has two entry paths. An authorized operator can still start delivery
directly on a GitHub issue. Or a signed-in user can begin in the Roundhouse UI
with a read-only conversation, refine a delivery brief, and explicitly promote
that brief into a GitHub issue and the normal delivery run. Conversations may
also end with an answer and no delivery work.

Once a delivery run starts:

1. Roundhouse qualifies the report, asks focused questions when needed, and
   attempts to reproduce bugs before planning a fix.
2. When the plan is ready, an agent implements it inside the repository's
   supported Dev Container, nested within an isolated Cloudflare Sandbox, and
   creates a durable Git checkpoint.
3. Roundhouse validates and promotes that checkpoint, then opens a draft pull
   request.
4. When the implementation includes visual evidence, a repository operator
   reviews its before-and-after screenshots. Feedback returns to the same
   durable implementation workspace; acceptance continues the workflow.
5. Independent reviewers inspect the exact candidate commit. Actionable
   findings send the change back through implementation and validation.
6. The candidate is integrated with the current target branch, then repository
   CI must pass for that same commit before Roundhouse can merge it
   automatically or leave it ready for a maintainer, according to the
   repository profile.

GitHub remains the source of truth for issues, pull requests, CI, and merged
code. A Cloudflare control-plane Worker coordinates each run, D1 stores
workflow state, and Cloudflare Artifacts carries Git checkpoints between
isolated containers. A separately deployed runtime-host Worker owns the
Sandbox Durable Objects and container image, so ordinary control-plane deploys
do not replace active coding environments. A private model broker selects
models without exposing provider credentials to the agent container.

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
validation commands, repository-wide instructions, and the conversation model
used by the read-only conversational entry surface. The repository-owned
`.roundhouse/workflow.yaml` defines the lifecycle graph and each agent node's
typed inputs, result schema, model, prompt, capabilities, and transitions.
Review nodes define any number of always-on or conditionally selected
reviewers, their blocking/advisory/shadow mode, model, prompt, and severity
policy. Long instructions live in explicitly referenced files under
`.roundhouse/prompts/`.

Roundhouse loads the profile and every referenced instruction from one exact
default-branch commit, hashes their normalized contents, and snapshots them
onto the run. Roundhouse cannot modify `.roundhouse/**` or the selected Dev
Container configuration. Fixed Roundhouse isolation, tool, read-only, and
result-submission rules take precedence over repository instructions.

The lifecycle now runs through that declarative graph rather than a compiled
stage switch. Agent and review fan-out/join nodes are repository-composable.
Human nodes wait for participant prose or an operator decision, including
repository-configured visual feedback before review and merge. Named
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
that visualizes nodes, routes, and authority from the current default-branch
profile. It serializes that graph back to repository YAML, validates edits with
the same compiler, and uses GitHub's authenticated editor to create the
proposed branch and pull request. Existing runs keep their original immutable
workflow snapshots. D1 never becomes workflow configuration authority.

## Project status

Roundhouse is an active V2 prototype. The end-to-end development workflow can
qualify and investigate an issue, plan and implement a change, validate and
review the exact commit, run repository CI, and merge it. A separate
read-only conversational entry surface can explore a repository question,
prepare a delivery brief, and promote that brief into the same issue-to-merge
workflow. It is not ready for general production use.

The Phase 7 workflow-graph foundation, operator visual feedback, and
conversational entry v0 are deployed in development. The foundation can accept
future typed adapters for organizational context, scanners, deployment
observation, alert triage, and audit export; those integrations are not
implemented or approved merely because the extension points exist.

V1 is preserved at the `v1-poc-final` tag. The [V2 plan](docs/v2-plan.md) is
the normative product and architecture document. Conversational entry details
live in [`docs/conversational-entry-proposal.md`](docs/conversational-entry-proposal.md)
and
[`docs/conversational-entry-implementation-plan.md`](docs/conversational-entry-implementation-plan.md).

## Repository layout

| Path                          | Purpose                                                           |
| ----------------------------- | ----------------------------------------------------------------- |
| `apps/control-plane`          | Cloudflare Worker that handles GitHub intake and coordinates runs |
| `apps/runtime-host`           | Independently deployed Sandbox and Container host                 |
| `apps/model-broker`           | Private model routing and credential boundary                     |
| `containers/agent-runner`     | Isolated coding-agent runtime                                     |
| `packages/core`               | Shared workflow state, contracts, and repository profiles         |
| `packages/response-observer`  | Streaming model-response observation                              |
| `docs/v2-plan.md`             | Product contract, architecture, and acceptance criteria           |
| `docs/conversational-entry-*` | Conversational entry product contract and v0 implementation plan  |
| `docs/future-improvements.md` | Deferred ideas that are not approved implementation work          |
| `AGENTS.md`                   | Cursor Cloud agent notes for this repository                      |

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
workspace, syntax-checks `containers/agent-runner/runner.mjs`, and runs the
test suite.

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

`pnpm deploy:development` deploys the runtime host, model broker, D1
migrations, and control plane. The merged-PR workflow deploys the runtime host
only when its image, host code, or direct shared dependencies changed; every
merge can deploy the model broker, D1 migrations, and control plane without
replacing active Sandboxes. The deployment requires an authenticated
Cloudflare development environment and is not needed for local checks.

The model broker's provider-native OpenAI, Anthropic, and Google routes require
an account-scoped AI Gateway token with `AI Gateway Run` permission. Store it as
the `AI_GATEWAY_TOKEN` Worker secret before deploying the broker:

```sh
wrangler secret put AI_GATEWAY_TOKEN --config apps/model-broker/wrangler.jsonc
```

## License

Roundhouse is licensed under the [Apache License 2.0](LICENSE). See
[NOTICE](NOTICE) for attribution information.
