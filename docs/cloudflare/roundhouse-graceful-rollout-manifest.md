<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Graceful Cloudflare execution rollout manifest

Status: **authorized for implementation and development deployment on 2026-07-14**

This manifest records the exact resource and deployment-policy changes for the
graceful execution rollout. It changes no hostname, DNS record, Access policy,
database, Queue, R2 bucket, Durable Object class, Worker name, Container
application name, secret, or credential.

## Existing resources updated

The release configuration for both environments retains the existing resources:

| Environment | Worker                          | Container application       | Queue                  |
| ----------- | ------------------------------- | --------------------------- | ---------------------- |
| development | `roundhouse-dev-control-plane`  | `roundhouse-dev-execution`  | `roundhouse-dev-runs`  |
| production  | `roundhouse-prod-control-plane` | `roundhouse-prod-execution` | `roundhouse-prod-runs` |

Development deploys automatically after a merge to `main`. Production remains
behind the existing `roundhouse-production` GitHub environment approval and
continues to promote the exact development Worker bundle and Container digest.

## Container and Queue policy

- Instance type remains `standard-1`.
- `max_instances` increases from 1 to 10. This is a concurrency ceiling, not a
  prewarmed pool and not permission to duplicate one logical attempt.
- Distinct attempt identities may occupy up to ten Containers concurrently.
- Queue batches remain one message so each lease-bound run is acknowledged
  independently.
- Queue consumer concurrency is capped at 10 to match Container capacity and
  avoid deliberately driving requests beyond the upstream execution ceiling.
- New Container starts move immediately to the new image; there is no
  percentage-based mixed-version ramp for newly created attempts.
- Active instances receive a 2,400-second protection period, matching the
  existing whole-attempt budget for the bounded agent, validation, and recovery
  overhead. Their own command and lease timeouts remain authoritative.
- If an old instance is still active after that budget, Cloudflare sends
  `SIGTERM` and provides its separate 15-minute shutdown interval before
  `SIGKILL`.

## Handoff and readiness

The image contains the exact public source commit as non-secret release
identity. After each Worker deployment, the authenticated release workflow:

1. invokes a unique release-specific Durable Object identity;
2. starts a credential-free Container with network disabled;
3. waits for the runner port;
4. calls `/ping` inside the Container;
5. verifies the image reports the exact expected commit;
6. gracefully stops the canary Container;
7. verifies D1 readiness and outer Worker health; and
8. retains those exact responses as release evidence.

The canary receives no model, GitHub, Cloudflare, or other credential. It cannot
run a repository command or enable network access.

## Shutdown and recovery

The Container runner handles `SIGTERM` by refusing new HTTP work, draining its
active request, removing temporary model credentials, and exiting before
Cloudflare's hard shutdown deadline. Normal completed attempts request graceful
`stop()`; explicit cancellation and failed-instance cleanup may still use
immediate `destroy()`.

Durable Objects remain globally single-owner. A deployment may reset an
in-memory Durable Object even while old and new Container versions overlap.
Persisted D1 and R2 state remains authoritative. Implementation runs retain their
existing bounded durable retry, and planning retries only narrowly classified
Cloudflare reset, overload, and Container transport interruptions. Binding or
validation failures are never retried as infrastructure failures.

## Rollback

Rollback selects the preceding immutable Worker version and Container digest.
No migration is added by this change. A rollback must retain the forward- and
backward-compatible runner protocol while active instances drain. Reducing the
capacity or changing the active-attempt budget requires a new reviewed manifest;
it is not an automatic rollback action.
