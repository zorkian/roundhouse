<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Proposed Cloudflare coordination resource manifest

Status: **proposal only; unapplied**.

| Resource          | Proposed development name     | Purpose                                               |
| ----------------- | ----------------------------- | ----------------------------------------------------- |
| Worker            | `roundhouse-coordinator-dev`  | Queue consumer and coordination API                   |
| D1 database       | `roundhouse-coordination-dev` | Authoritative run, revision, lease, and attempt state |
| Queue             | `roundhouse-runs-dev`         | At-least-once run-targeted delivery                   |
| Dead-letter queue | `roundhouse-runs-dlq-dev`     | Exhausted delivery inspection                         |

No resource ID, account binding, route, domain, secret, or remote migration is
assigned by this milestone. Any provisioning requires a separate approval.
