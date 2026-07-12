<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Local control-plane Worker demonstration

Date: 2026-07-11  
Runtime: Wrangler 4.110.0, Miniflare 4.20260708.1, local D1 only  
Branch: `codex/local-control-plane-worker`

No GitHub, Cloudflare, Codex, or other ambient credential was provided to the
Worker or execution dispatcher. Network-capable execution was not used.

## Migration transcript

```text
Resource location: local
Executing on local database roundhouse-dev-coordination
0001_control_plane.sql: 4 commands executed successfully
```

The generated `.wrangler` state was deleted after verification. The configured
D1 ID is the all-zero local placeholder; no remote resource exists.

## Integration transcript

```text
authenticated boundaries                         PASS
reservation -> crash -> run creation repair      PASS
run creation -> Queue outage -> outbox replay     PASS
same idempotency key and same task                one run, one delivery
same idempotency key and different task           409 idempotency_conflict
two identical Queue deliveries                    two acknowledgements, one execution
interruption with running prepare attempt         expired lease reclaimed
new Worker handler over the same D1 binding       run resumed to workspace_ready
malformed Queue delivery                          acknowledged, zero executions
retryable dispatcher failure                      three revision-bound attempts
attempt limit                                     durable terminal failed state
inspection                                        task, paths, lease, raw errors redacted
```

Deterministic demonstration run IDs are derived from SHA-256 idempotency-key
digests and contain no task content:

```text
outbox-recovery-01       run_6f8a0951a516a128bdc7f3f9ba84c28a9ec9d67a
reservation-recovery-01 run_64d00e93ff938418a789608556e5e4147d0f1183e
restart-reclaim-01      run_0c5b37c13eff620997a274e7c382eb491fe907cf
bounded-retries-01      run_ee714615f5928f41f1337f4063a04ca5ce45b9f5
terminal-failure-01     run_22c94535c7fdfe7511ded98d1129bad3771c90e9a
```

The automated evidence is the assertions in
`apps/control-plane-worker/src/control-plane-worker.test.ts`. A full repository
gate after the first implementation slice passed 23 test files and 76 tests;
the final gate is recorded in the pull request.

## Live Workerd transcript

The initial live bundle check correctly failed because the broad package barrel
included Node-only execution modules. The Worker was changed to import the
dedicated Cloudflare-safe entrypoint rather than enabling broad Node
compatibility. A second `wrangler dev --local` run produced:

```text
GET /health                                             200
GET /ready (temporary local bearer token)               200
POST /v1/runs                                           201
run ID                 run_1fa3d35ea5428c745f3eda48617d52372923be60
local Queue consumer state                              workspace_ready
durable revision                                        5
prepare attempts                                        1 succeeded
```

The live inspection response contained the run/task IDs, state, timestamps,
attempt status, and safe event envelope only. It did not contain instructions,
repository or publication paths, lease material, workspace references, event
detail, or raw errors. The temporary token existed only on the local Wrangler
command line. The server and local `.wrangler` state were terminated and removed
after the demonstration.
