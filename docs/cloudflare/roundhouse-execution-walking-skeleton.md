<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Cloudflare execution walking skeleton

## Outcome

The Access-protected development control plane now dispatches an explicit run
attempt to one isolated Cloudflare Container, checks out an exact public
Roundhouse commit, revokes checkout egress, runs a fixed repository-profile
command, and stores immutable JSON evidence in R2. D1 retains the evidence
identity and state transition after the Container is destroyed.

This is execution, not agent automation. No model, GitHub credential, arbitrary
submitted command, patch approval, commit, push, or publication exists in this
path.

## Architecture

The coordinator depends on `ExecutionDispatcher` and
`RepositoryExecutionBackend`, not Cloudflare. The Worker selects the Cloudflare
adapter only when `EXECUTION_MODE=cloudflare-container`.

1. D1 grants the Queue consumer an exclusive run lease and starts a numbered
   attempt.
2. The adapter derives a deterministic Container name from run, stage, and
   attempt number.
3. A SQLite Durable Object starts the `roundhouse-dev-execution` image with
   internet disabled.
4. Runtime policy allows only `github.com` through an audited Worker outbound
   handler. The runner fetches the exact commit and verifies `HEAD`.
5. The Durable Object removes the handler and allowed host. The runner requires
   denied HTTPS and non-HTTP TCP probes before executing `pnpm license:check`.
6. The runner records bounded output, timings, checkout identity, changed files,
   disk and memory observations. The Durable Object destroys the Container.
7. The adapter conditionally writes
   `runs/<run>/attempts/<attempt>/execution.json` to R2. A pre-existing object is
   read and verified rather than overwritten.
8. D1 records object key, SHA-256, byte size, media type, producing attempt, and
   creation time. The public inspection projection exposes only this reference
   and classified attempt state.

The exact-base request, deterministic attempt identity, conditional R2 write,
and D1 compare-and-set transition form one replay-safe chain. An interruption
after R2 upload reuses the object. An R2 upload interruption is retryable.

## Recovery semantics

- A duplicate delivery cannot claim a live lease.
- An ordinary revision mismatch is acknowledged without execution.
- The original revision-bound delivery may adopt the current revision only when
  the same run has an expired lease and its latest attempt is still `running`.
  Reclaim records the abandoned attempt as `lease_expired` before starting the
  next numbered attempt.
- Container interruption is retryable and destroys the failed instance.
- Timeout and nonzero exit are terminal, classified failures with retained
  evidence.
- All completed paths destroy their Container. Final inventory showed every
  demonstration instance as inactive.

## Demonstration evidence

All runs targeted exact commit
`a1c696e6ee5e67bb484f5b08f55e3c3a816d90db`.

| Run                                         | Result                            | Evidence SHA-256                                                   |
| ------------------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `run_remote_execution_success_20260712_02`  | one successful attempt            | `890dc67db0160e868c60a2d06da98e83518370ed38dc3eb0f87930c8ed6db938` |
| `run_remote_execution_nonzero_20260712_01`  | terminal `command_failed`         | `d57c7ad4753c2a8244311141bf5a74ab00021aa743567c67e68527ae1dc24019` |
| `run_remote_execution_timeout_20260712_01`  | terminal `execution_timeout`      | `4bbe21704b85eb53f48599052b71244755862364f9be94e4553e953b5c057fa8` |
| `run_remote_execution_recovery_20260712_01` | `lease_expired`, then one success | `d772e1db95412f43f967f216c76e5fcc96b958ddd46e05e646c1c7bdc8b4fd99` |
| `run_remote_execution_teardown_20260712_01` | one success and explicit teardown | `59411796d91b57b364d2e7da48a315ab6f28eb22e83c2b1a56ea5c8ac6c1c8e6` |

The complete final evidence run
`run_remote_execution_final_20260712_01` recorded:

- Container startup: 971 ms;
- exact checkout: 1,274 ms;
- fixed validation: 1,128 ms, exit 0;
- workspace disk: 5,782,175 bytes;
- runner resident memory: 66,899,968 bytes;
- changed files: none;
- checkout egress: three audited requests, all to `github.com`;
- execution internet: disabled;
- denied HTTPS and non-HTTP TCP probes: passed;
- evidence: 766 bytes, SHA-256
  `eeb55cd8fa21928cbbc56ce62f3d2140274a56f42c8d090ed6612a8adfee3919`.

Independent retrieval recomputed each inspected R2 hash and compared it with
D1. A Worker redeployment retained all D1 states and R2 objects.

Three pre-fix diagnostic runs are intentionally retained. They durably show the
bounded three-attempt failure caused by incorrect outbound-handler registration;
they created no evidence object. The fix uses the Containers package's static
handler registry rather than shadowing its accessor.

## Authentication and smoke injection

The existing Cloudflare Access application and exact human policy were not
changed. Unauthenticated `/health`, `/ready`, and run inspection requests each
received HTTP 302 from Access. The Worker independently verifies the Access JWT
and the local integration suite covers authenticated submission and redacted
inspection.

Remote demonstrations were inserted with authenticated administrative D1 calls
and delivered through the authenticated Cloudflare Queue API. This deliberately
avoided creating a temporary Access token or policy outside the authorized
resource envelope. A browser-authenticated HTTP submission/inspection remains
the final manual surface check; it does not affect the demonstrated execution,
durability, isolation, or evidence path.

## Operations

The retained deployment configuration is `success`. Apply migrations before
deployment:

```sh
wrangler d1 migrations apply roundhouse-dev-coordination --remote \
  --config apps/control-plane-worker/wrangler.deploy.jsonc
wrangler deploy --config apps/control-plane-worker/wrangler.deploy.jsonc \
  --containers-rollout=immediate
```

Inspect exact resources with `wrangler containers info`, `wrangler containers
instances`, `wrangler queues info`, `wrangler d1 execute`, and `wrangler r2
object get --remote --pipe`. Never print credential environment variables or
attach them to a Container.

An authenticated `DELETE /v1/runs/<run-id>` destroys a currently running
deterministic Container, removes the lease, closes any running attempt as
`cancelled`, and records a durable `run.cancelled` event. Repeated cancellation
and later Queue delivery are harmless.

## Cost and retention

The account already had the Workers Paid plan required by Containers; this
milestone made no billing-plan change. The bounded demonstrations used far less
than the included monthly 25 GiB-hours memory, 375 vCPU-minutes, and 200 GB-hours
disk. R2 retained only small JSON objects and remained far below its included
10 GB-month, one million Class A, and ten million Class B operations. Estimated
incremental charge is USD 0 and remains below the authorized USD 5 ceiling.

The Container application, image, Durable Object class, R2 bucket, D1 rows,
egress audit rows, and evidence objects are retained for development. Container
instances are inactive after each run.

## Remaining limitations

- The only executable profile command is the fixed license check.
- Only the public Roundhouse repository and exact commits are accepted.
- There is no coding agent, private-repository capability, patch capture,
  approval, publication, UI, alerting, or automatic evidence retention policy.
- Resource observations are runner measurements, not platform peak telemetry.
- Administrative smoke injection is development tooling, not a product ingress
  path.

Rollback is the exact, unapplied sequence in the authorized resource manifest.
It requires fresh approval for every destructive operation and never matches a
resource by a partial name.
