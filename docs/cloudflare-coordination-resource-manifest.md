<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Proposed Cloudflare coordination resource manifest

Status: **proposal only; unapplied**.

| Resource          | Proposed development name      | Purpose                                       |
| ----------------- | ------------------------------ | --------------------------------------------- |
| Worker            | `roundhouse-dev-control-plane` | HTTP API and Queue consumer                   |
| D1 database       | `roundhouse-dev-coordination`  | Runs, leases, attempts, and submission outbox |
| Queue             | `roundhouse-dev-runs`          | At-least-once revision-targeted delivery      |
| Dead-letter queue | `roundhouse-dev-runs-dlq`      | Exhausted infrastructure-delivery inspection  |

No resource ID, account binding, route, domain, secret, or remote migration is
assigned by this milestone. Any provisioning requires a separate approval.
The all-zero D1 ID in local Wrangler configuration is deliberately invalid for
remote use and is not a resource assignment.
