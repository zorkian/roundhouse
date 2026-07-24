<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Deferred feature improvements

- Status: Ideas to revisit; none are approved to start
- Audience: Maintainers and future implementers
- Last updated: 2026-07-23

This document preserves promising improvements that arose while operating the
V2 prototype. It is not a roadmap, acceptance plan, or implementation queue.
An entry here must not cause Roundhouse or a maintainer to start work. We will
return to an item only when a maintainer explicitly chooses it as a slice.

The prototype-first rule in the [V2 plan](v2-plan.md) still applies. When an
item is selected, use the smallest design supported by observed behavior and
do not add adjacent hardening or generalized machinery without evidence.

## Asset-capable visual previews and human feedback

### Current capability

Reproduction and implementation agents can run an application in their
isolated Cloudflare Sandbox, request a viewport screenshot from Cloudflare
Browser Rendering, store the image and source provenance, and include it in
GitHub evidence. Implementation workspaces can be backed up, destroyed, and
restored for a later revision.

The current capability-protected preview origin forwards the active run's
same-origin and localhost browser requests through the control plane to its
private Sandbox port. Stylesheets, JavaScript, images, fonts, and same-origin
API responses therefore render normally, while requests to unrelated origins
are aborted. Screenshots are evidence; there is no explicit pre-merge state in
which Roundhouse waits for a maintainer to approve or request another visual
revision.

### Improvement to revisit

Consider a deliberate visual-feedback waiting point before merge. A maintainer
could inspect a screenshot, respond in ordinary GitHub prose, and receive a
new screenshot from the restored implementation workspace.

Do not start by building WebSocket support, multi-service routing, generic
public previews, scripted login flows, device farms, or a general reverse
proxy. Add only behavior required by the first real application used to
validate this slice.

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
Analytics Engine would provide aggregate time-series analysis.

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
