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
- Issue edits do not mutate an existing plan. The operator starts a new plan.
- The reviewed profile supports Roundhouse's public repository only.
- The subscription-backed Codex credential is a development exception, not the
  production identity architecture.
- Destructive retention and cleanup remain disabled.
- Reliability hardening beyond demonstrated restart, replay, leases, and exact
  bindings is deferred so V1 functionality can be evaluated first.
