<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Deferred feature improvements

- Status: Ideas to revisit; none are approved to start
- Audience: Maintainers and future implementers
- Last updated: 2026-08-02

This document preserves promising improvements that arose while operating the
V2 prototype. It is not a roadmap, acceptance plan, or implementation queue.
An entry here must not cause Roundhouse or a maintainer to start work. We will
return to an item only when a maintainer explicitly chooses it as a slice.

The prototype-first rule in the [V2 plan](v2-plan.md) still applies. When an
item is selected, use the smallest design supported by observed behavior and
do not add adjacent hardening or generalized machinery without evidence.
The repository-defined workflow graph in Phase 7 and conversational entry v0
are approved architecture and therefore are not tracked here. Their extension
points do not approve any of the integrations that may eventually use them.
Deferred conversational follow-ons such as external adapters, shared
visibility, quotas, and deeper read tools live in the conversational-entry
docs.

## Operational metrics and possible warm Sandbox reuse

### Current evidence

Roundhouse records detailed workflow events in D1, including normal Sandbox
destruction, but it does not emit purpose-built time-series metrics. In the
Dreamwidth Dev Container pilot, cold environment preparation took about 286
seconds. Restoring the stateful workspace and recreating its Dev Container
took about 594 seconds before agent execution; saving the replacement
checkpoint took about 148 seconds. Restoration currently provides state
fidelity rather than a latency improvement.

### Improvement to revisit

Add a Cloudflare Workers Analytics Engine dataset for operational timings and
visualize it through the Analytics Engine SQL API, Grafana, or a small
Roundhouse dashboard. D1 should remain the durable per-run event record;
Analytics Engine would provide aggregate time-series analysis. It can consume
the canonical audit envelope planned for the workflow graph, but the sink and
dashboard remain deferred.

Initial measurements should cover:

- dispatch to runner availability;
- Sandbox creation and destruction;
- workspace backup duration and size when available;
- workspace restore duration;
- workspace preparation after restore;
- screenshot capture duration; and
- time between visual evidence and the next maintainer response.

Continue destroying Sandboxes after durable backup while collecting this
evidence. If real usage shows that maintainers commonly respond within a short
window and restoration latency materially disrupts the interaction, consider
keeping a Sandbox warm briefly as a latency cache. Always create the durable
backup first; warm compute must not become the durable workspace. Choose any
warm period from measured engagement and cost rather than setting one now.
