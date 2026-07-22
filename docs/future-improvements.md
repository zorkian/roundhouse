<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Deferred feature improvements

- Status: Ideas to revisit; none are approved to start
- Audience: Maintainers and future implementers
- Last updated: 2026-07-22

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

The current preview transport renders the initial HTML response and blocks all
subsequent browser requests. This is sufficient for self-contained pages, but
not for applications that load relative stylesheets, JavaScript bundles,
images, fonts, or same-origin API responses. Screenshots are evidence; there
is also no explicit pre-merge state in which Roundhouse waits for a maintainer
to approve or request another visual revision.

### Improvement to revisit

Introduce a capability-protected preview origin that forwards only the active
run's same-origin browser requests to its Sandbox through the trusted control
plane. Browser Rendering would load the application normally from that origin,
while requests to every other origin remain blocked. This should preserve the
existing isolation boundary without installing a browser in the agent Sandbox
or giving either the application or browser general network access.

After the preview path works for a representative asset-built application,
consider a deliberate visual-feedback waiting point before merge. A maintainer
could inspect a screenshot, respond in ordinary GitHub prose, and receive a
new screenshot from the restored implementation workspace.

Do not start by building WebSocket support, multi-service routing, generic
public previews, scripted login flows, device farms, or a general reverse
proxy. Add only behavior required by the first real application used to
validate this slice.

## Operational metrics and possible warm Sandbox reuse

### Current evidence

Roundhouse records detailed workflow events in D1, but it does not emit
purpose-built time-series metrics for Sandbox creation, backup, restoration,
or destruction. In issue #399, the first implementation reached a ready
workspace in about 7 seconds. A later clean restored implementation reached
the runner in about 63 seconds and needed another 5 seconds to prepare its Git
workspace. The available events cannot separate queueing, container startup,
and backup restoration inside that 63-second interval. Earlier restored
attempts also encountered an independent Git-fetch recovery failure, so their
longer elapsed times are not useful restore benchmarks.

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
