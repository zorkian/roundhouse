# ADR 0001: TypeScript monorepo

Status: Accepted

## Context

Roundhouse needs shared, strongly typed contracts across its Cloudflare control plane, local tools, execution broker, and operations console. The initial implementation should remain a modular monolith rather than create independently operated services.

## Decision

Use Node.js 24 LTS, TypeScript in strict mode, and pnpm workspaces. Organize deployable applications under `apps/` and reusable modules under `packages/`. Provider and infrastructure details stay behind contracts.

## Consequences

- Domain types and boundary schemas can be shared without copying definitions.
- Packages introduce boundaries for design and testing, not independent deployment requirements.
- Cloudflare compatibility must be checked for any dependency used by Worker code.
- Node 24 is required for supported development and CI, even if some tooling happens to run on older versions.
