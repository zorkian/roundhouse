<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# GitHub-integrated self-development POC manifest

Status: applied and demonstrated on 2026-07-12.

This is the exact external mutation boundary authorized for the
GitHub-integrated self-development POC. All committed values are safe for
public disclosure; secret values are never recorded here.

## GitHub

- Create one development GitHub App named `roundhouse-dev`, owned by `zorkian`.
- Install it only on `zorkian/roundhouse`.
- Repository permissions are exactly:
  - Metadata: read
  - Contents: read and write
  - Pull requests: read and write
  - Issues: read
- No organization permissions, webhook, callback, or additional repository
  permission is configured.
- App ID: `4281837`.
- Installation ID: `146147681`.
- The installation API reported `selected` repository mode and exactly one
  accessible repository: `zorkian/roundhouse`.
- Create at most one dogfood issue, one `codex/dogfood-*` branch, one dogfood
  draft pull request, and one milestone pull request. Neither pull request is
  merged by this milestone.

The App ID and installation ID are non-secret deployment configuration. The
private key is installed only as `ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY` on the
existing Worker. Installation access tokens are minted in memory, used by the
GitHub gateway, and discarded. No GitHub credential enters a Container, D1,
R2, evidence, logs, or agent input.

The GitHub-generated PKCS#1 key is converted locally to an owner-readable-only
PKCS#8 file because the Worker signer uses WebCrypto. Both files remain outside
the repository. Only the PKCS#8 value is submitted to the Worker secret.

## Cloudflare

Retain and update only:

- Worker `roundhouse-dev-control-plane`
- D1 database `roundhouse-dev-coordination`
- Queue `roundhouse-dev-runs` and its existing dead-letter Queue
- R2 bucket `roundhouse-dev-evidence`
- existing `RoundhouseExecutionContainer` application and
  `roundhouse-dev-execution` image
- existing Access-protected hostname and five-minute schedule

Allowed mutations are one additive D1 migration, authenticated routes under
the existing hostname, new versions of the existing Worker and image, the new
Worker secret named above, and retained development evidence. No hostname,
route, Access policy, database, Queue, bucket, Worker, Container application,
webhook, or unrelated resource is created. Incremental Cloudflare usage is
bounded to USD 10.

## Data and publication

D1 may add tables for immutable GitHub issue snapshots and publication
attempts. R2 continues to hold immutable implementation evidence. The trusted
publisher verifies the exact approval and retained evidence before using a
short-lived installation token to create Git objects, a new bounded branch,
and a draft pull request. Existing refs are never overwritten.

Rollback is a Worker version rollback and removal of the new secret in a later
reviewed operation. Additive tables, retained evidence, the dogfood issue, and
the draft pull request remain inspectable. No destructive rollback is applied.

The completed deployment used Worker version
`3a562209-0947-411e-9d57-c09060ccfb16` and execution image digest
`sha256:3281c0276bd8079670698ed1fdfc729522214b72af3986d84f0526d6e77c1c0d`.
The complete demonstration transcript and immutable bindings are recorded in
`roundhouse-github-integrated-poc.md`.
