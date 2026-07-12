<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Local control-plane Worker

Status: local V1 walking skeleton; no Cloudflare resources are provisioned or
deployed.

## Architecture

`apps/control-plane-worker` is the first production-shaped Cloudflare driver
around the platform-neutral self-development coordinator. The Worker owns HTTP
and Queue protocol concerns. `D1JobStore`, `ResumableCoordinator`, and the
execution-dispatch contract remain independent of Workers.

The Worker imports the dedicated `@roundhouse/self-development/cloudflare`
entrypoint. That entrypoint excludes Node-only workspace, process, agent, and
publication modules from the Workerd bundle; the control plane does not enable
broad Node compatibility to mask an unsafe dependency boundary.

```text
authenticated HTTP request
  -> schema and enrolled-repository policy
  -> D1 submission/outbox reservation
  -> D1JobStore.submit
  -> revision-targeted Queue delivery
  -> ResumableCoordinator
  -> ExecutionDispatcher
```

The submission table is a small durable outbox. A request retry repairs a crash
or Queue failure between D1 run creation and delivery. An idempotency key is
bound to the hash of the parsed task; reuse with different content is rejected.
The run ID and delivery ID are deterministic hashes of that key.

Retryable stage failures produce a new Queue message bound to the durable
post-release revision. Retries stop at the coordinator's per-stage limit.
Duplicates carrying an older revision are acknowledged without execution.
Malformed messages are also acknowledged so they cannot form an unbounded
poison-message loop. Infrastructure exceptions use Queue retry and the proposed
dead-letter queue.

The Queue helper schedules a required follow-up delivery before acknowledging
the current message. If that enqueue fails, the original delivery is retried.
Its now-stale revision cannot re-execute the stage, but the Worker reads the
durable retryable state and repairs the missing revision-bound follow-up before
acknowledging. Repeated repair sends are harmless under the same revision guard.

## API

| Method | Path                      | Authentication | Behavior                                |
| ------ | ------------------------- | -------------- | --------------------------------------- |
| GET    | `/health`                 | public         | Process liveness only                   |
| GET    | `/ready`                  | required       | Local D1 readiness                      |
| POST   | `/v1/runs`                | required       | Idempotent structured task              |
| GET    | `/v1/runs/{runId}`        | required       | Redacted state and evidence             |
| POST   | `/v1/runs/{runId}/cancel` | required       | Revision-bound, idempotent cancellation |

Submission requires `Content-Type: application/json`, an `Idempotency-Key`
header, and a body shaped as `{ "schemaVersion": 1, "task": ... }`. Bodies are
limited to 64 KiB. Only the configured repository path and remote URL are
accepted. There is deliberately no HTTP approval, commit, push, arbitrary
command, arbitrary repository, or network-destination endpoint.

Errors use a JSON `error` object with a stable code and safe message.

## Trust boundaries

The current `LocalBearerAuthorizer` is a port adapter for local development,
not a production identity system. The token is supplied at runtime and is never
committed or returned in evidence. A future Cloudflare Access adapter must
validate Access identity and authorization before producing the same decision.

The inspection projection is allowlisted. It omits instructions, repository and
remote locations, publication configuration, lease tokens, workspace paths and
references, raw attempt errors, and event detail. The local deterministic
dispatcher executes no repository command and uses no network. A future
Container adapter receives only the bounded `ExecutionDispatchRequest`, not the
Worker environment or Cloudflare/GitHub credentials.

## Local verification

The integration suite starts real local Miniflare D1 bindings and applies the
checked-in schema. It demonstrates authentication, malformed and unenrolled
requests, submission/outbox repair, idempotent replay, duplicate delivery,
redaction, bounded retries, terminal failure evidence, an expired lease left by
an interrupted worker, and recovery through a newly constructed Worker handler.

Run the automated demonstration:

```sh
pnpm test -- apps/control-plane-worker/src/control-plane-worker.test.ts
```

Wrangler may be exercised only in local mode:

```sh
npx wrangler d1 migrations apply roundhouse-dev-coordination \
  --local --config apps/control-plane-worker/wrangler.jsonc
npx wrangler dev --local \
  --config apps/control-plane-worker/wrangler.jsonc \
  --var LOCAL_API_TOKEN:replace-with-a-temporary-local-token
```

The Wrangler file binds only loopback development and uses an all-zero D1 ID to
make accidental remote use invalid. Do not run `wrangler deploy` or a remote D1
command from this configuration.

## Remaining V1 limitations

- The bearer adapter does not replace Cloudflare Access authentication.
- Execution is deterministic and does not start a Cloudflare Container.
- Queue tests use the Cloudflare message contract with real Miniflare D1; a
  remote at-least-once delivery test remains part of a separately approved
  development deployment.
- R2 immutable evidence and structured log redaction remain future milestones.
- No endpoint can approve or publish a run; existing exact approval, patch, and
  verified-push bindings remain authoritative.
- Resource names, routes, costs, retention, Access policy, and provisioning are
  still proposals requiring explicit review.
