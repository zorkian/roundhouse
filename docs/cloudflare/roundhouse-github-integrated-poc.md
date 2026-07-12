<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# GitHub-integrated self-development POC

Roundhouse demonstrated a complete development loop from a GitHub issue to an
exactly approved draft pull request. GitHub credentials remained in the
control-plane Worker; none entered the coding Container, task prompt, D1, R2,
or retained evidence.

## Architecture

GitHub issue text is untrusted requirements input. The authenticated Worker
selects the enrolled repository, current base commit, fixed validation profile,
single allowed path, publication branch, and GitHub App installation. D1 owns
the durable run, approval, and publication intent. The Queue delivers the run
to one deterministic Container attempt. The Container clones the public base,
revokes checkout access, runs Codex with only measured model transport, disables
tool Internet, validates the patch, removes the temporary credential, and puts
immutable evidence in R2.

After authenticated human approval, the Worker rereads and hashes the exact R2
bytes, verifies the approval, manifest, base, patch, and evidence bindings, then
mints a short-lived installation token. The gateway creates Git blobs, a tree,
an exact-parent commit, a new branch, and a draft pull request. It verifies the
result before D1 records the terminal publication.

## Deployment

- Worker: `roundhouse-dev-control-plane`
- Worker version: `3a562209-0947-411e-9d57-c09060ccfb16`
- Container application: `roundhouse-dev-execution`, version 17
- Execution image digest:
  `sha256:3281c0276bd8079670698ed1fdfc729522214b72af3986d84f0526d6e77c1c0d`
- D1 migration: `0005_github_integrated_poc.sql`
- R2 bucket: `roundhouse-dev-evidence`
- GitHub App ID: `4281837`
- GitHub installation ID: `146147681`
- Installation repository selection: exactly `zorkian/roundhouse`

The only new secret is `ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY`. The key was
converted locally to PKCS#8, submitted directly to the Worker secret store, and
never printed or committed.

## Dogfood transcript

GitHub issue [#11](https://github.com/zorkian/roundhouse/issues/11) was enrolled
through the Access-authenticated operator API with idempotency key
`github-poc-issue-11-submit-20260712-01`. It created run
`run_599c9f4b27233871cd876c0ca23543709045b365` at exact base
`ecbb732c520fc50701361263ec34bae18fdb5b93`.

Three initial Container attempts retained classified, retryable
`container_interrupted` failures. An authenticated operator retry moved the
same durable run from revision 13 to 14. Attempt 4 succeeded without replacing
the run or duplicating completed evidence:

- Attempt: `run_599c9f4b27233871cd876c0ca23543709045b365-prepare-4`
- Startup: 864 ms
- Checkout: 1,126 ms
- Agent: 21,901 ms
- Validation: 2,277 ms
- Disk observation: 6,120,960 bytes
- Memory observation: 67,751,936 bytes
- Model usage: 61,749 input tokens and 558 output tokens
- Checkout HEAD: `ecbb732c520fc50701361263ec34bae18fdb5b93`
- Changed path: `docs/dogfood/github-integrated-poc.md`
- Patch SHA-256:
  `9fe10532dad6dc3068c0bb9ee0ad9f0df38c869d80bed8bcd0abefbd348681c9`
- Published file SHA-256:
  `039002ea8effbdf598f6385c917cfe7e935023170fb226ccbabe89121fcb857b`

The evidence object is
`runs/run_599c9f4b27233871cd876c0ca23543709045b365/attempts/run_599c9f4b27233871cd876c0ca23543709045b365-prepare-4/trusted-implementation.json`.
It is 4,121 bytes with SHA-256
`15133ab5711ad09f7ff760bd748d932bde7b154e86de7d1e48b43241e166d631`.
An independent Wrangler download matched both values exactly.

Evidence records that the runtime credential was installed temporarily, removed
before validation, and absent from evidence. Checkout reached only
`github.com`. Model transport reached measured ChatGPT/OpenAI hosts. Agent-tool
and validation Internet were disabled, and both HTTP and non-HTTP denial probes
passed. Diff, formatting, and Apache-2.0 validation passed; typechecking and
tests were correctly skipped because the patch changed only Markdown.

The Access-derived actor `zorkian@fastmail.fm` approved revision 18, bound to
the exact base, patch, and evidence above. Publication at revision 19 produced:

- Tree: `1b3ef71b105671eb43cc900bd9dbb14bcb0f8e65`
- Commit: `a9a6143c84e44cf63ba6df110bcb8019706c8907`
- Parent: `ecbb732c520fc50701361263ec34bae18fdb5b93`
- Branch: `codex/dogfood-issue-11`
- Draft pull request:
  [#12](https://github.com/zorkian/roundhouse/pull/12)

GitHub reports the PR author as `app/roundhouse-dev`, one added file, and the
exact expected head. Independently downloaded GitHub file bytes matched the
approved manifest hash. Replaying the publication request returned the same
commit and PR; exactly one PR exists for the branch. The durable run completed
at revision 20.

## Remaining POC limitations

This remains a development proof of concept. The Container uses the accepted
temporary subscription credential exception. GitHub publication is limited to
the public enrolled repository and one fixed dogfood path. Publication leases
do not yet renew during a long request. Some gateway fallback paths still map
to a generic safe 500 rather than the closed diagnostic taxonomy. Manifest
snapshot race diagnostics, automated issue lifecycle updates, installation
rotation, multi-repository enrollment, and production credential brokerage are
deferred. The dogfood and milestone pull requests remain unmerged.
