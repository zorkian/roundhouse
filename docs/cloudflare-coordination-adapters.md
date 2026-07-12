<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Local-first Cloudflare coordination adapters

The Cloudflare driver delivers a run ID and expected revision. The unchanged
platform-neutral coordinator claims that exact run rather than scanning local
directories. Duplicate Queue deliveries are harmless: only the delivery whose
expected revision matches can acquire the lease, while stale duplicates are
acknowledged without executing a stage.

## Authority decision

Local Miniflare tests exercise the production D1 binding API. An optimistic
`UPDATE ... WHERE revision = ?` compare-and-set grants exactly one claim under
concurrent requests, preserves attempt history, and safely reclaims expired
leases. D1 is therefore sufficient for V1 authoritative coordination state.
Durable Objects remain reserved for future live streaming or workloads needing
long-lived per-run in-memory coordination, consistent with ADR 0002.

## Local verification

Tests create an entirely local Miniflare D1 database, apply the checked-in
schema string, race two claims, expire and reclaim a lease, reconstruct the
store over the same binding, and replay duplicate Queue messages. No Wrangler
remote mode, Cloudflare account resource, credential, domain, or route is used.

## Operational boundary

The proposed resource manifest is documentation only. Before deployment it
requires separate approval of names, account, bindings, migrations, retention,
budgets, and rollback. R2 evidence and Container execution are intentionally
outside this milestone.
