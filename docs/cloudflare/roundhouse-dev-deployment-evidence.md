<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Roundhouse development deployment evidence

This records the approved 2026-07-11/12 deployment of the local control-plane
Worker milestone. Secrets and temporary credentials are intentionally omitted.

## Retained resource inventory

| Resource             | Recorded identity                                                      |
| -------------------- | ---------------------------------------------------------------------- |
| Worker               | `roundhouse-dev-control-plane`                                         |
| D1                   | `roundhouse-dev-coordination` / `87a4098a-a829-4e0b-80c6-43e2eaf34ddc` |
| Queue                | `roundhouse-dev-runs` / `3e87be91f056400e9ad08459aa8904db`             |
| Dead-letter Queue    | `roundhouse-dev-runs-dlq` / `a0eac1c4f1d44a6e84133bba58ccf780`         |
| Access application   | `3c5cb944-a45b-4ffc-ae84-db05a5b6bf15`                                 |
| Access AUD           | `93175877f79ccfad4f2d7b0ed35f9df6ec1901269474150486076320a74f141a`     |
| Worker Custom Domain | `68ad1ae95f1b3cdbbbb3289a8263cdaec365b485`                             |
| Certificate          | `a1f1ba34-59d4-433e-aa97-dd2b05b25075`                                 |
| DNS record           | `cc306b0dcbec5a4cec5c36ea4644f3cf`                                     |

The hostname is `roundhouse-dev.rm-rf.rip`. The generated DNS record is a
proxied AAAA record. `workers.dev` and preview URLs remain disabled. Final
inventory showed one producer and one consumer on the primary Queue, none on
the dead-letter Queue, and only the exact `Allow Mark` Access policy for
`zorkian@fastmail.fm`.

## Deployment and smoke transcript

1. Created D1 and both Queues, applied migration
   `0001_control_plane.sql`, and deployed without HTTP ingress.
2. Created the temporary 24-hour smoke token and exact Access policies, then
   redeployed with the returned team and AUD identifiers.
3. Attached the Custom Domain last. Before authenticated traffic, `/health`,
   `/ready`, and `/v1/runs` each returned the Access challenge (HTTP 302).
4. Authenticated `/ready` returned HTTP 200 with `ready: true`.
5. Run `run_0403d48ede028141660ea002688d9748f94c707a` demonstrated submission,
   exact idempotent replay, conflicting-replay rejection, Queue delivery, and
   terminal `workspace_ready` at revision 5 with one successful prepare
   attempt. Inspection contained no credential material.
6. Version `b1d6ec79-a661-4a4c-97eb-d2d0fecde912` temporarily selected the
   bounded retry dispatcher. Run `run_714967870a0e852231e274df4aa60ba88e592935`
   reached `failed` at revision 13 after exactly three retryable
   `dispatch_unavailable` prepare attempts. Inspection omitted the raw error.
7. Version `d92d1ccc-a7fc-4a7a-af76-67866e4fbf21` restored deterministic mode.
   Identical redeployment version `1da13001-8d39-4b9e-afdf-5f6aa5644891`
   demonstrated restart persistence: both prior runs retained their exact
   states and attempts in D1.
8. Deleted the temporary service policy and service token, removed its local
   credential file, and confirmed the former credential receives HTTP 302.
   The exact human policy remains.

Earlier no-ingress and authenticated deployments were
`b15c499a-567a-4bfc-8345-f610cbb45453` and
`51a3ac30-41c6-407a-bdff-dd77005627d5`, respectively.

## Rollback dry-run

Rollback was not executed. A future separately approved rollback must use
these exact targets, in this order:

1. Delete Custom Domain ID
   `68ad1ae95f1b3cdbbbb3289a8263cdaec365b485`, removing reachability first.
2. Delete Access application ID `3c5cb944-a45b-4ffc-ae84-db05a5b6bf15`.
3. Confirm certificate `a1f1ba34-59d4-433e-aa97-dd2b05b25075` and DNS record
   `cc306b0dcbec5a4cec5c36ea4644f3cf` are no longer needed before deleting
   either exact ID.
4. Delete Worker `roundhouse-dev-control-plane`.
5. Only with explicit data-deletion approval, delete Queues
   `roundhouse-dev-runs` and `roundhouse-dev-runs-dlq`, then D1 database
   `87a4098a-a829-4e0b-80c6-43e2eaf34ddc`.

Never select rollback targets by a partial name.

## Cost, retention, and limitations

The bounded demonstration is expected to remain within Cloudflare Free-plan
allowances; no billing-plan change was made. Development resources and both
demonstration rows are retained. Queue messages use the plan's 24-hour
retention.

This deployment proves authenticated control-plane submission, durable D1
state, Queue delivery, bounded retry, and restart-safe inspection. The remote
dispatcher is intentionally deterministic and executes no repository command,
Container, agent, Git operation, or publication. Human browser access depends
on Cloudflare Access login. Operational alerts, automated retention, production
secrets, and destructive rollback remain future work.
