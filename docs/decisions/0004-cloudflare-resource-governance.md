# ADR 0004: Cloudflare development resource governance

Status: Accepted

## Context

The Cloudflare account hosts unrelated systems. Creating routes, custom domains, DNS records, or ambiguously named resources without an explicit review could disrupt or confuse existing operations.

## Decision

New persistent development resources use the `roundhouse-dev-*` naming prefix. Disposable, clearly scoped spike resources may retain their existing `roundhouse-*-spike` names when recreating them would add churn without reducing risk.

Before any Cloudflare provisioning or deployment, present and receive explicit approval for a resource manifest covering:

- Account, environment, region, names, and resource types.
- Existing-resource collision checks.
- `workers.dev`, route, custom-domain, and DNS behavior.
- Public exposure and authentication.
- Expected limits, costs, retention, and deletion plan.
- Exact external mutations to be performed.

No custom domain, zone route, or DNS mutation is implicit in approval to deploy a Worker. Those changes require separate, explicit approval.

## Consequences

- Local implementation and dry-run validation may proceed without a deployment review.
- Remote resource creation, deployment, routing, and deletion pause for the manifest review.
- Completed spike data is removed when it has no continuing diagnostic value; reusable schemas and explicitly retained development resources may remain.
