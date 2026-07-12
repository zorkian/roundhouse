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

## Remaining limitations

This is a development operator surface. It uses the existing human Access
boundary and the previously accepted temporary Codex credential exception.
There is no external machine Access credential, destructive retention, private
repository support, notification delivery, or multi-Container concurrency.

The retained local `cloudflare-access-api-token` is a Cloudflare management API
token, not an Access application JWT. It cannot authenticate operator requests.
The remote authenticated transcript therefore requires a fresh human Access
session; creating a service token is intentionally outside this milestone.
