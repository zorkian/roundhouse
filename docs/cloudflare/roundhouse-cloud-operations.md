<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Authenticated cloud operations

Roundhouse exposes authenticated run submission, inspection, exact evidence,
cancellation, retry, approval, publication recording, recovery, alerts, and a
dry-run retention report through the existing Access-protected Worker.

Every human mutation derives its actor from verified Access identity and uses
an `Idempotency-Key`. Mutation receipts bind the key to action, actor, run, and
request hash. Replays return the stored result; conflicting reuse is rejected.
Approval and publication retain their exact revision, base, patch, evidence,
actor, branch, and remote bindings.

The scheduled handler runs as `roundhouse:scheduler`, never as a human. Every
five minutes it repairs pending submission outboxes and requeues expired leases
with revision-bound delivery identities. Durable alerts deduplicate by key and
count recurrence. Recovery cycles retain their internal actor and repair totals.

The retention endpoint is reporting-only: it returns run-state, evidence, and
active-alert counts with `dryRun: true` and an empty deletion list.

## Development CLI

With a short-lived Access application JWT available only in the shell environment,
the CLI presents it to Cloudflare Access through `cf-access-token`. After Access
validates it, the proxy injects `cf-access-jwt-assertion` for the Worker authorizer:

```zsh
export ROUNDHOUSE_ORIGIN='https://roundhouse-dev.rm-rf.rip'
export ROUNDHOUSE_ACCESS_TOKEN='...'
node scripts/roundhouse-operator.mjs inspect RUN_ID
node scripts/roundhouse-operator.mjs evidence RUN_ID
node scripts/roundhouse-operator.mjs alerts
node scripts/roundhouse-operator.mjs recovery
node scripts/roundhouse-operator.mjs retention
```

Mutation commands accept a JSON file as the third argument and optionally use
`ROUNDHOUSE_IDEMPOTENCY_KEY` for deliberate replay:

```zsh
export ROUNDHOUSE_IDEMPOTENCY_KEY='operator-cancel-20260712-01'
node scripts/roundhouse-operator.mjs cancel RUN_ID /tmp/cancel.json
```

Tokens and request files containing credentials must remain outside the
repository. The CLI never persists them.

## Authenticated development demonstration

The 2026-07-12 demonstration used only the CLI and authenticated control-plane
routes for normal operations. It retained the following public-safe bindings:

- Successful run `run_35ca873b13c010890558ebb4098e244fc650c294` used base
  `3583ece2b7bb1431a078e730ec0a85c89607e010`, produced patch SHA-256
  `58ef4a32a5b64b3313528ccadd2cbeb40a512ab59cc7020453eebd9747e533bc`,
  and reached `awaiting_publication` after approval by the Access-derived actor.
  R2 evidence
  `runs/run_35ca873b13c010890558ebb4098e244fc650c294/attempts/run_35ca873b13c010890558ebb4098e244fc650c294-prepare-1/trusted-implementation.json`
  independently matched SHA-256
  `6229458782a320247e16064bb81ccb9ab81744155bc6c0fbfcfee14993964d52`
  and size 2,884 bytes. A faithful publication dry-run produced commit
  `cac78f438f249feff14e7f1d0cc578a429ab208c` without pushing it.
- Cancellation run `run_1afee505cbe69d2ca6d9df977b9e5f25894938a2`
  moved atomically from running revision 3 to cancelled revision 4. Replaying
  its idempotency key returned the byte-identical response.
- Retry run `run_400412566fd3cd656684e8f2967c67cfc3b6255f` retained three
  classified `container_interrupted` failures, accepted a revision-13 retry,
  and completed attempt 4 without duplicating prior attempts. Its evidence is
  SHA-256 `ed0c28ff9a60305234ac633a6b6254338e849c9fba1244a54e7ba8e98c08715d`.
- The controlled interruption deployment
  `41feb0b9-8539-4821-874e-064db34d112e` failed after durably reserving
  submission `cloud-ops-interruption-submit-20260712-01` but before Queue
  delivery. After normal configuration was restored, authenticated recovery
  cycle `4f39198b-7f42-4a2f-9256-6fdf614bb32c` repaired exactly one submission.
  Replaying the submission returned original run
  `run_d3b70687acdec4f1bea5f31c9c888c02538328b9` with `created: false`.
  It completed exactly one attempt and retained R2 evidence SHA-256
  `1d81adcbbbdd1ac58eaf862e9e23ba5076ee70986394ed2697b764dcc9d7e3a6`,
  independently verified at 2,795 bytes.
- Recovery history exposes scheduled actor `roundhouse:scheduler`, including
  expired/lease-less recovery cycle `de66d5fc-5bd2-418f-853f-0a44eb2752c1`
  and its deduplicated durable alert. The retention report remained dry-run
  with an empty deletion list.

Worker versions `951b4e30-1558-4b06-b519-460b7ad65be3` and final reviewed
version `8ed29b73-656a-4186-a07d-f3a219fc88bf` were deployed after the
interruption. Authenticated inspection after both redeployments returned the
same runs, evidence bindings, and approval, demonstrating durable survival.

## Remaining limitations

This is a development operator surface. It uses the existing human Access
boundary and the previously accepted temporary Codex credential exception.
There is no external machine Access credential, destructive retention, private
repository support, notification delivery, or multi-Container concurrency.
