# ADR 0002: Cloudflare-first modular monolith

Status: Accepted

## Context

The V1 plan requires durable workflows, immutable evidence, queryable projections, GitHub ingress, and isolated repository execution. Several Cloudflare capabilities still require measured spikes.

## Decision

Use Workers and Workflows for the control plane, D1 for projections and metadata, R2 for immutable payloads, Queues for buffering, and Containers for the initial execution-backend spike. Use Durable Objects only when serialized ownership or live streaming requires them.

Keep direct GitHub clone plus R2 checkpoints as the V1 workspace baseline. A failed infrastructure spike may replace an adapter or backend, but must not change the domain workflow.

## Consequences

- Domain and infrastructure contracts must remain separate.
- Queue consumers and GitHub effects must be idempotent.
- Container suitability, egress enforcement, and D1 scale remain explicit go/no-go decisions.
