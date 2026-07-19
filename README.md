<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Roundhouse

![Roundhouse orchestration hub: coding-agent engines routed through a human-controlled software delivery workflow](docs/assets/roundhouse-banner.png)

Roundhouse is an open-source bug-fixing agent for GitHub repositories. Its job
is to turn an issue into a validated change while involving a maintainer only
when information or judgment is genuinely required.

The project is moving from its successful but overbuilt V1 proof of concept to
a deliberately smaller V2. V1 proved that Roundhouse can take low-risk issues
through implementation, validation, independent review, exact-head CI, and
automatic merge. It also accumulated too many overlapping state machines,
schemas, evidence mechanisms, and planning documents. V2 keeps the proven
security boundary and product lessons while replacing the orchestration.

The complete product contract, architecture, transition sequence, and
acceptance gates are in the [V2 plan](docs/v2-plan.md). That is the only
normative design document in this repository.

> [!IMPORTANT]
> V2 is a prototype whose immediate goal is a working end-to-end issue-to-merge
> journey. Build the simplest functional path, run it for real, and learn from
> what actually happens. Do not add limits, retry or recovery systems, abuse
> controls, generalized policy, approval gates, or other hardening for failures
> we have not observed. After real operation exposes a problem, add the
> smallest response that solves that problem. Credential, authority, and
> isolation boundaries remain required from the start.

> [!CAUTION]
> Roundhouse is experimental, pre-release software for explicitly enrolled
> public repositories. Generated code and automated reviews can be wrong. Do
> not use it with private data or credentials that cannot be revoked.

## Intended workflow

1. An authorized maintainer starts Roundhouse on a GitHub issue.
2. Roundhouse qualifies the report and asks focused questions in the issue when
   required.
3. For a bug, Roundhouse attempts to reproduce the behavior before proposing a
   fix.
4. Roundhouse posts its understanding, evidence, and implementation plan.
5. An isolated implementation agent changes the code and runs the relevant
   local validation.
6. A reviewer examines the exact candidate commit and actionable findings
   return through implementation and validation until the change works.
7. Exact-head repository CI gates the merge.

GitHub is the public source of truth for issues, pull requests, CI, and merged
code. D1 owns workflow state. Cloudflare Artifacts is V2's Git-native workspace
and handoff layer. The implementation container never receives GitHub App,
Cloudflare administration, deployment, or model subscription credentials. A
separate clean promotion container receives a short-lived GitHub App token only
after it has independently validated the candidate checkpoint.

## Repository status

Phase 0 froze the V1 proof of concept at the `v1-poc-final` Git tag and merged
the minimal V2 core, control-plane Worker, and agent runner into `main`. V1 code
and historical documents remain available from the tag and Git history rather
than as a parallel legacy tree. Phase 1 is deployed in isolated V2 development
resources and proves D1-owned lifecycle state, Queue wakeups, thin Container
Durable Objects, and Artifacts checkpoint handoff. Phase 2 has deployed real
development GitHub intake, read-only qualification and current-behavior
investigation,
unrestricted natural-language clarification, and evidence-backed planning
through a private model broker. Its current slice implements the accepted plan
in an isolated container, records the actual source commit in Artifacts,
validates that checkpoint from a clean clone, promotes the validated commit to
GitHub, and opens a draft pull request. The reviewer examines the promoted
candidate commit. A clean review advances it to CI; actionable findings return
the work to implementation, update the same draft pull request, and review the
newly promoted commit. Roundhouse accepts CI only when the clean review, active
run, pull-request head, and check runs all identify the same commit, then marks
the draft pull request ready. Immediately before merging, it rechecks those
exact-head gates and submits the merge for that specific SHA. Validation
commands and output remain durable Roundhouse evidence rather than issue or
pull-request commentary. The Access-protected development dashboard at
`roundhouse-dev.rm-rf.rip` provides a compact operational view of V2 runs and
links each run to its GitHub issue and recorded details.

## Local checks

Prerequisites are Git, Node.js 24.18.0, Corepack, and pnpm 10.13.1. CI and the
runner image use the version in `.node-version`.

```sh
corepack enable
corepack prepare pnpm@10.13.1 --activate
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` verifies formatting and Apache-2.0 headers, typechecks the
workspace, and runs the test suite.

## Development deployment

When a pull request is merged into `main`, GitHub Actions checks that exact
landed commit. After those checks succeed, it uses the
`roundhouse-development` environment to deploy the development model broker,
apply pending development D1 migrations, and deploy the control plane and agent
container. Open pull requests run checks but do not deploy, and the workflow
references only the development configuration and resources.

The same deployment can be run from an authenticated development machine with:

```sh
pnpm deploy:development
```

## License

Roundhouse is licensed under the [Apache License 2.0](LICENSE). See
[NOTICE](NOTICE) for attribution information.
