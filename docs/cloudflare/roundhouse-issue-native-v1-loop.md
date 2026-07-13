<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Issue-native V1 self-development loop

Roundhouse's development POC starts from a GitHub issue, but treats issue text
as untrusted requirements rather than executable authority. The control plane
captures an immutable issue snapshot, resolves the exact public `main` commit,
and produces a repository-policy-qualified plan before it can create a run.

## Operator path

1. Write an issue with a `Scope is exactly:` section containing one literal
   repository-relative path per bullet.
2. Post `/rh start`. Roundhouse stores the issue snapshot, plan JSON, and
   immutable R2 plan evidence. It posts a link to the live plan page.
3. Review the base commit, exact paths, profile, limits, risk, plan SHA-256, and
   evidence identity. Approve from the Access-protected plan page or post the
   exact `/rh implement PLAN REVISION SHA256` command shown by Roundhouse.
4. Follow the run link. The page polls every five seconds and displays durable
   state, revision, attempts, classifications, evidence objects, patch identity,
   and publication state. Cancel and retry use the exact displayed revision.
5. At `awaiting_approval`, independently review the patch and evidence. Existing
   `/rh approve` and `/rh publish` commands retain their exact base, patch,
   evidence-set, revision, actor, and verified-publication bindings.

The HTML dashboard is at `https://roundhouse-dev.rm-rf.rip/`. Human pages and
their JSON APIs remain behind the existing Cloudflare Access application. The
only Access-bypassed path remains the exact signed GitHub webhook endpoint.

## Planning policy

The reviewed profile is `roundhouse-self-development-v1@1`. It permits no more
than twelve literal files under `apps/`, `packages/`, or `docs/`. It rejects
traversal, globs, repository policy/configuration, workflows, licensing files,
container definitions, D1 migrations, and paths outside the enrolled prefixes.
The current bounded limits are a 512 KiB patch, 900 seconds, 256 model requests,
three automatic attempts, and ten explicit operator attempts.

Plan identity is a SHA-256 binding over the issue snapshot, base commit, exact
paths, profile, validation level, risk, and limits. D1 holds the durable plan
state and R2 object identity; R2 holds the immutable plan bytes. Approval uses a
compare-and-swap revision and records the authenticated actor. A rejected plan
cannot run. A changed issue requires a new plan. Duplicate webhooks, commands,
UI requests, and Queue deliveries are idempotent.

## Execution and security boundary

Approved plans materialize the existing platform-neutral task contract. The
existing Queue and resumable coordinator lease one run attempt to the existing
Cloudflare Container. The Container clones the exact public commit through the
measured checkout allowlist, removes checkout network access, and then gives the
trusted coding agent only the schema-validated task and exact path list. It has
no GitHub or Cloudflare credential. The temporary development Codex credential
remains confined to the previously authorized Container boundary and is never
evidence.

Only the reviewed profile commands execute. Patch and validation evidence are
immutable in R2 and hash-bound into D1. Publication uses the GitHub App in the
Worker, never in the Container, and can create only the approved commit from the
approved patch on the verified base.

## Operations and recovery

The dashboard lists the fifty most recently updated plans and runs. JSON remains
available at `/v1/dashboard`, `/v1/plans/PLAN_ID`, and `/v1/runs/RUN_ID`.
Existing alert, recovery, retention, evidence, cancellation, retry, approval,
and publication APIs remain available. Scheduled recovery repairs stranded
outbox delivery and expired leases without duplicating completed stages.

The additive migration is `0007_issue_native_planning.sql`. Rollback for this
development milestone is dry-run only: redeploy the prior Worker version and
retain the additive tables, R2 evidence, runs, issues, and pull requests.

## Current V1 limitations

- Planning is deterministic repository policy, not a separate planning model.
- The UI is intentionally small and polling-based; it is an operator console,
  not a multi-tenant product interface.
- Most displayed identities are not yet navigable. A follow-up should link
  issues, commits, plans, revision history, full evidence, actors, pull requests,
  and check observations to their authenticated or public detail views.
- Issue edits do not mutate an existing plan. The operator starts a new plan.
- The reviewed profile supports Roundhouse's public repository only.
- The subscription-backed Codex credential is a development exception, not the
  production identity architecture.
- Destructive retention and cleanup remain disabled.
- Reliability hardening beyond demonstrated restart, replay, leases, and exact
  bindings is deferred so V1 functionality can be evaluated first.

## Demonstration record

The approved manifest was applied to the existing development resources. D1
migration `0007_issue_native_planning.sql` completed successfully. The final
demonstrated Worker version was `b89eef8f-3f4a-4296-95a1-23dd2b9df2b6`. The
initial milestone deployment was `584db4d4-6f16-4116-91b4-93638a97c964`;
review-scoped fixes were deployed without changing the resource envelope. No
Container rollout was performed.

Successful issue [#16](https://github.com/zorkian/roundhouse/issues/16)
produced:

- plan `plan_83b84097fb5a0a242134e0c22e686213882d16b7` at immutable plan
  SHA-256 `4653c48d581cbe20234448fc4f1a20666ac34bdd47d3c9e8b7726f903cb4ea36`;
- exact base `f2ddd29b7b9eedc0104a79cf8f46d36858da3376` and exact-path-set
  SHA-256 `28c2c3ca083d8e8a2adba03e8bc5a232b0a61d4070a0f1c380b26c179107d7a4`;
- run `run_b11a44d0296a4d7eae86488f10c77d6700f041da`, one successful
  Container attempt, and immutable evidence object
  `runs/run_b11a44d0296a4d7eae86488f10c77d6700f041da/attempts/run_b11a44d0296a4d7eae86488f10c77d6700f041da-prepare-1/trusted-implementation.json`;
- independently verified evidence SHA-256
  `fbe5b20ff2395736e6270892ec88b117df7972010d0861ab1135fa3a1e21ed32`
  over 27,037 retained bytes;
- approved patch SHA-256
  `c44c5527030c0bf0aa1103b4e0eee8a21174fa820a398f24e0492b5a9bd8247e`;
- one verified commit `bc87ca4525f1d43208274cf19b98c2dab1dc6bfa`, whose sole parent is the
  exact base and whose canonical full-index binary diff matches the approved
  patch SHA-256;
- draft dogfood pull request
  [#19](https://github.com/zorkian/roundhouse/pull/19), containing exactly the
  two approved files with its exact-head GitHub check successful.

Negative-policy issue [#17](https://github.com/zorkian/roundhouse/issues/17)
produced rejected plan `plan_0f4cabd2039990f00960393a85637e3f4367a41a` for the protected
workflow path. It created no run. Its 696-byte retained plan evidence at
`plans/plan_0f4cabd2039990f00960393a85637e3f4367a41a/plan.json` independently
matched SHA-256
`fb957e956ad3003d1da6dfb3494acf05daf4bfba6d811ff37e853f3c58082ba1`.

The Access-authenticated dashboard and JSON APIs survived repeated Worker
deployments with D1 and R2 state intact. The deployed HTML was independently
verified to bind its script and style to a per-response CSP nonce, omit
`unsafe-inline`, parse successfully, and poll durable state every five seconds.
