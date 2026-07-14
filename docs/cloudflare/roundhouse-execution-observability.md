<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Roundhouse execution observability

Roundhouse explicitly enables persisted Cloudflare Workers Observability for
the development and production control-plane deployments. Cloudflare
correlates Worker, Durable Object, and Container logs for the Container
application.

## Logging boundary

Operational logs record run and attempt identity, lifecycle phase, duration,
outcome, bounded failure classification, and bounded validation stdout and
stderr excerpts. Validation runs only after the temporary model credential is
removed and network access is disabled.

Complete prompts, model transcripts, patches, and command output remain in the
immutable execution evidence. They are deliberately not duplicated into the
general-purpose log index because evidence has stronger identity, integrity,
retention, and access semantics. Logs are diagnostic hints; evidence is the
authoritative record.

The logging implementation must never record environment variables,
credential payloads, authorization headers, webhook bodies, Access tokens, or
GitHub App tokens. New lifecycle fields require the same public-disclosure
review as committed source.

## Operator commands

Inspect the Container application and instances:

```zsh
pnpm exec wrangler containers list
pnpm exec wrangler containers info <application-id>
pnpm exec wrangler containers instances <application-id>
```

Tail new production events while reproducing a problem:

```zsh
pnpm exec wrangler tail roundhouse-prod-control-plane --format pretty
```

Retained logs are available in the Cloudflare dashboard under the production
Worker's Observability view and the Container application's Logs view. Filter
by `runId` or `attemptId` to correlate control-plane phases with Container
output.

The Roundhouse run page should eventually expose the safe lifecycle timeline
directly. Raw Cloudflare logs remain an operator interface rather than an end
user interface.
