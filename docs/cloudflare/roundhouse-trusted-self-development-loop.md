<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Cloud trusted self-development loop

Roundhouse now runs a bounded coding agent entirely in its existing Cloudflare
Container, retains immutable evidence in R2, pauses for exact approval, and
publishes only the approved patch from a separate supervisor-owned checkout.
The milestone uses the existing development Worker, D1 database, Queue, R2
bucket, Container application, Access hostname, and human policy.

## Architecture and trust boundary

An Access-authenticated task is stored in D1 and delivered by Queue with an
expected revision. The platform-neutral coordinator grants one lease and sends
an exact public commit, instructions, validation level, and exact file allowlist
to a deterministic Container identity. Checkout can reach only audited
`github.com` HTTPS requests. The Worker then switches the Container to audited
`chatgpt.com` model transport, injects the dedicated subscription credential at
runtime, and starts Codex with tool network disabled.

The credential is never an image layer or Container environment variable. It
is written to an owner-readable temporary Codex home, removed in `finally`
before validation, cleared from shared runtime state, and scanned out of patch
and summary evidence. Model and checkout handlers are removed before fixed
validation commands run. HTTP and raw TCP denial probes must both pass.

The Container returns a bounded patch and exact changed-file inventory. R2
conditional creation makes replay idempotent; D1 records the object key,
SHA-256, size, media type, and producing attempt. Approval binds the run, base,
patch, complete evidence list, approver, and durable revision. Trusted approval
enters the non-claimable `awaiting_publication` state. Publication reconstructs
the patch in a fresh exact-base checkout, verifies `origin`, `main`, approval,
evidence, revision, staged and committed diffs, and pushes one new branch.

## Recovery semantics

Queue duplication is harmless because claims use D1 compare-and-set revisions
and one unexpired lease. A crashed attempt remains inspectable until its lease
expires. A revision-bound recovery delivery closes it as retryable
`lease_expired`, creates the next numbered attempt, and reuses immutable R2
evidence if it already exists. Approval is write-once and cannot be claimed by
the worker. Publication requires the exact current revision and authenticated
actor mapping.

## Demonstration transcript

The successful publication run was `run_trusted_success_20260712_01`:

- exact base and checkout: `87a1b78076a0e53038e04fbc51542425e4268042`;
- one successful attempt, terminal revision 7, and state `completed`;
- exact file: `docs/dogfood/trusted-self-development-loop.md`;
- patch SHA-256: `d7e2f38ec7b2fb928bd58d3ef914f90ccbfec33afa76192f4b0174524330024d`;
- R2 object SHA-256: `5ddb387338c3ba4c7d64e315da13860595adcb1c41ea003d39e4ddb93eac27f3`,
  size 2,917 bytes;
- formatting, license, HTTP-denial, and TCP-denial checks passed;
- credential evidence records runtime installation, removal before validation,
  and absence from evidence;
- delegated approval `mark-smith-delegated-trusted-loop-dogfood` is bound to
  Access actor `zorkian@fastmail.fm` and revision 6;
- verified commit `30ddf2531bc86b34d82d5e27abd03e1548c854eb` is exposed by
  [draft PR #8](https://github.com/zorkian/roundhouse/pull/8).

Independent retrieval recomputed the R2 SHA and byte size from the downloaded
object. It also verified the Apache-2.0 header directly in the patch. Remote
branch and PR heads both matched the recorded commit before publication state
was appended to D1.

Run `run_trusted_interrupt_20260712_01` demonstrated recovery. Attempt 1 was
intentionally terminated and remained running until its five-minute lease
expired. A revision-3 delivery closed it as `failed/lease_expired`; attempt 2
succeeded and produced exactly one evidence object. The run stopped at
`awaiting_approval`. The retained deployment was restored to `success` mode.

Earlier diagnostic runs are retained. `run_trusted_dogfood_20260712_01`
recorded three bounded pre-transport failures. After adding redacted diagnostics,
`run_trusted_diagnostic_20260712_01` identified Cloudflare interception CA trust
as the cause. Passing `SSL_CERT_FILE` to Codex fixed transport without widening
the allowlist or disabling TLS interception.

Successful run timing was 822 ms startup, 1,031 ms checkout, 23,413 ms agent,
and 2,269 ms validation. Codex recorded 60,926 input and 493 output tokens;
peak observed memory was 67,735,552 bytes and disk use 5,892,173 bytes. D1
audited only `github.com` and `chatgpt.com` traffic. Unauthenticated inspection
received HTTP 302 from Access.

## Operations

Apply additive migrations, create the secret without displaying it, and deploy:

```zsh
npx --yes --package node@24.4.1 --package wrangler@4.110.0 \
  wrangler d1 migrations apply roundhouse-dev-coordination --remote \
  --config apps/control-plane-worker/wrangler.deploy.jsonc

npx --yes --package node@24.4.1 --package wrangler@4.110.0 \
  wrangler secret put ROUNDHOUSE_CODEX_AUTH_JSON \
  --config apps/control-plane-worker/wrangler.deploy.jsonc \
  < "$ROUNDHOUSE_CODEX_AUTH_PATH"

npx --yes --package node@24.4.1 --package wrangler@4.110.0 \
  wrangler deploy --config apps/control-plane-worker/wrangler.deploy.jsonc
```

Inspect a run through the Access-protected API or query its redacted D1
projection by run ID. Retrieve R2 evidence by the exact object key recorded in
D1 and independently compare SHA-256 and size. Never print the Worker secret,
attach Cloudflare/GitHub credentials to a Container, or approve a different
base, patch, evidence set, path, revision, or actor.

Rollback remains dry-run only: deploy the prior Worker version and remove the
secret binding only with fresh approval. Retained D1 rows, audit rows, R2
objects, Queue, Container application, hostname, and Access policy are not
deleted by rollback.

## Cost and remaining limitations

The demonstrations used one `standard-1` Container at a time and small D1/R2
objects. Estimated incremental Cloudflare charge is USD 0 and remains below the
authorized USD 10 ceiling. Subscription-backed Codex use is bounded by the
recorded attempts and is not API-billed per request.

This remains a development boundary. The Worker temporarily handles the
subscription credential, model transport is limited to the measured
`chatgpt.com` host, and administrative D1/Queue injection was used because no
temporary Access service policy was authorized. Production needs a managed
credential broker, first-class authenticated automation identity, automated
retention/alerts, typed directory scopes, and a publication CLI/API that writes
approval and publication audit rows without administrative SQL.
