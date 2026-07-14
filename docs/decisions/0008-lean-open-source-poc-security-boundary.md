<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# ADR 0008: Lean open-source POC security boundary

## Status

Accepted.

## Context

Roundhouse has demonstrated a GitHub-native path from an issue through planning,
isolated agent execution, validation, draft pull-request publication,
independent review, and bounded remediation. In building that path, the project
also accumulated production-oriented provenance, approval, evidence,
reconciliation, release-attestation, and deployment controls.

Those controls answer real integrity and recovery questions, but they are now
ahead of the product risk and the product evidence. V1 still supports only a
small set of public-repository workflows, while implementation effort is being
spent proving that every internal artifact and transition is cryptographically
and durably bound.

The POC exists to learn whether open-source maintainers find issue-to-draft-PR
automation useful. It is not an automatic merger, deployment system, secret
repository processor, or adversarial public-code sandbox. A generated draft
pull request is a proposal, not an accepted change. GitHub review, branch
protection, required checks, and a human merge decision remain independent
controls outside the agent loop.

The GitHub App can create Git objects, branches, comments, and draft pull
requests. It therefore has meaningful repository authority, but Roundhouse
must not have a merge path and must not be able to modify a protected default
branch. The coding agent itself does not receive the GitHub App credential.

The project needs a narrower POC threat model so that security work is
proportionate to actual authority and does not prevent product learning.

## Decision

Optimize V1 for delivering useful, reviewable draft pull requests to enrolled
open-source repositories. Preserve a small set of hard security boundaries and
defer additional assurance machinery until an observed risk, external user, or
expanded capability justifies it.

This ADR changes implementation priority and the default product workflow. It
does not require immediately removing stable existing integrity or evidence
code. Existing machinery may remain behind internal interfaces while new work
uses the simpler user and operator model below.

### POC trust assumptions

The V1 POC assumes:

- enrolled repositories and their relevant source are public;
- repository maintainers deliberately opt in;
- issues, comments, repository contents, test output, and model output are
  untrusted inputs;
- only configured maintainers may start, retry, cancel, or otherwise spend
  project resources;
- implementation and validation run in disposable, resource-bounded
  Containers;
- the coding agent never receives GitHub, Cloudflare, deployment, or other
  control-plane credentials;
- the GitHub App creates work only on a constrained branch namespace and opens
  draft pull requests;
- the default branch is protected independently of Roundhouse;
- Roundhouse cannot merge or deploy a generated change;
- a human reviews every generated change before merge; and
- generated code may be incomplete, incorrect, insecure, or unsuitable even
  when all automated checks pass.

Processing private source, operating on arbitrary hostile repositories,
automatic merge, automatic deployment, and customer-grade isolation are
outside this POC threat model. Adding any of them requires a new threat-model
review.

### Required hard boundaries

The following controls remain required:

1. Verify GitHub webhook signatures before parsing or acting on their content.
2. Authorize actors for operations that spend resources or mutate workflow
   state.
3. Keep GitHub App, Cloudflare, deployment, and control-plane credentials out
   of agent and repository execution environments.
4. Use ephemeral execution with bounded time, attempts, output, disk, memory,
   and model usage.
5. Bind each run to an enrolled repository and a concrete base commit.
6. Prevent duplicate webhook delivery from starting duplicate agent work.
7. Constrain publication to an approved repository and branch namespace.
8. Create draft pull requests only; provide no Roundhouse merge operation.
9. Rely on GitHub branch protection and human review to authorize changes to
   the default branch.
10. Run repository-defined validation and report failures without presenting
    them as success.
11. Avoid persisting credentials, authorization headers, and known secret
    values in logs, artifacts, comments, or model-visible data.
12. Provide basic status, cancellation, retry limits, and an operator-visible
    record sufficient to diagnose a failed run.

The control-plane publication broker from ADR 0006 remains. Separating GitHub
authority from the coding agent materially limits prompt-injection impact and
is worth its architectural cost.

### Default POC workflow

The ordinary low-risk workflow becomes:

```text
authorized issue trigger
  -> bounded planning and repository policy
  -> isolated implementation
  -> local validation
  -> draft pull request
  -> required independent Claude review
  -> GitHub checks and human review
  -> human merge or rejection
```

A draft pull request is the normal human approval surface. Low-risk work does
not require a separate patch-hash approval before publication. The pull request
must clearly show the issue, base and head commits, changed files, validation
results, agent summary, and known limitations.

Pre-publication approval remains appropriate for changes that exceed the POC's
ordinary authority, including protected paths, repository or deployment
configuration, dependency or lockfile changes, migrations, credentials,
security policy, unusually large diffs, or an explicit repository rule.

Every Codex-generated draft pull request receives an independent Claude review
of the exact published head. The review and its concrete findings must be
visible on the pull request before Roundhouse presents the work as ready for
human merge review. This is a required product-quality control, not an optional
security-hardening feature.

The reviewer remains advisory in the narrower authority sense: Claude cannot
approve publication, merge code, expand the plan, acquire new capabilities, or
override a maintainer. Substantive findings may request one bounded remediation
pass or leave the draft pull request awaiting maintainer direction. Low-severity
suggestions need not cause automatic revision. The review should not require a
separate cryptographic approval ceremony or an elaborate multi-cycle workflow
merely to prove that it occurred.

### Evidence and integrity policy

Retain enough information to understand and reproduce a run:

- repository, issue, and base commit;
- final patch or published commit;
- changed-file list;
- commands run, exit status, and bounded output;
- agent and reviewer summaries;
- timing and available usage information; and
- draft pull-request URL and final workflow outcome.

Content hashes may remain internal where they make retry, idempotency, or
publication reconciliation simpler. They are not a user-facing measure of code
quality and should not be required in routine maintainer commands.

Do not add new artifact hashes, evidence-set bindings, immutable-object layers,
or cross-system attestations unless they protect one of the required hard
boundaries or solve a demonstrated recovery failure. Git commit identity is the
primary durable identity for code presented in a pull request.

Evidence collection must be minimized as well as redacted. Retaining more
transcripts and output increases cost, operational complexity, and the chance
of retaining sensitive data. General logs are diagnostic, not authoritative
security evidence.

### Deferred POC work

Unless required to fix an observed failure, defer:

- additional cryptographic provenance layers beyond Git identity and the
  bindings required for safe publication or idempotency;
- mandatory evidence-set approval commands for ordinary draft PRs;
- byte-for-byte revalidation of every retained artifact on every read;
- production-grade release attestation and promotion evidence beyond protected
  GitHub Actions environments and human deployment approval;
- generalized credential brokerage when a narrow, revocable development
  credential is adequate for the enrolled public-repository POC;
- exhaustive network telemetry and denial proofs beyond a reviewed allowlist,
  ephemeral execution, and the absence of valuable control-plane credentials;
- automatic multi-cycle reviewer remediation beyond the required review and a
  bounded response to substantive findings;
- compliance-oriented retention, audit-search, and backup features; and
- hardening that improves theoretical assurance without improving task success,
  operator diagnosis, credential safety, resource control, or default-branch
  protection.

### Implementation direction

Until this ADR is superseded, implementation work should prioritize:

1. reducing issue-to-draft-PR time and operator steps;
2. enrolling at least one external open-source repository;
3. improving qualification, reproduction, patch quality, and repository-aware
   validation;
4. making progress and failures understandable in GitHub;
5. measuring success rate, maintainer intervention, latency, cost, review
   findings, and merge outcomes;
6. simplifying or bypassing mandatory pre-publication approval for low-risk
   work;
7. running one required independent Claude review for every Codex-generated
   pull-request head while keeping review authority and remediation bounded;
8. documenting which existing high-assurance components are retained,
   bypassed in POC mode, or candidates for later removal.

When choosing between another assurance mechanism and a bounded external POC
run, prefer the POC run unless the mechanism protects a required hard boundary
listed above.

## Prompt injection consequence

Roundhouse does not attempt to prevent untrusted requirements or repository
content from influencing the proposed patch; that influence is necessary for
the product to work. Instead, the POC security objective is:

> Prompt injection may affect a proposed draft change, but it must not grant
> credentials, expand repository authority, modify the protected default
> branch, merge code, or escape the human-reviewed pull-request boundary.

Bad code reaching a draft pull request is a product-quality failure, not a
security-boundary failure. Tests, required independent review, GitHub review,
required checks, and human merge judgment address that risk. No evidence hash
can establish that generated code is correct.

## Revisit triggers

Reassess this decision before adding any of the following:

- private or confidential repositories;
- repositories not controlled or explicitly trusted by the operator;
- automatic merge or deployment;
- write access to a default or protected branch;
- credentials or private data useful outside one attempt;
- arbitrary MCP tools or external destinations;
- multiple mutually untrusted organizations or tenants; or
- a demonstrated attack, data leak, publication race, or recovery failure that
  the lean boundary does not contain.

## Consequences

- Roundhouse accepts that some generated draft pull requests will contain bad
  code and treats human review as the final acceptance boundary.
- Maintainers interact primarily with GitHub issues and pull requests rather
  than hashes and evidence identities.
- Existing high-assurance code may temporarily exceed POC requirements, but it
  does not automatically justify further work of the same kind.
- Product breadth, external use, patch quality, and feedback speed take
  precedence over additional internal attestation.
- Expanding Roundhouse's authority or data sensitivity will require restoring
  stronger controls deliberately rather than assuming the POC boundary is
  sufficient.
