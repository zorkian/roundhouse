# Roundhouse

![Roundhouse orchestration hub: coding-agent engines routed through a human-controlled software delivery workflow](docs/assets/roundhouse-banner.png)

> [!CAUTION]
> Roundhouse is completely untested, pre-release alpha software. It is under active design and may be incomplete, insecure, destructive, or simply wrong. Do not use it with production repositories, valuable data, or credentials you cannot revoke.

Roundhouse is a GitHub-native orchestration system for AI-assisted software development. Its goal is to turn GitHub issues into qualified, evidence-backed work and coordinate coding agents through planning, implementation, validation, and review under explicit safety, budget, audit, and human-approval policies.

Roundhouse is not a coding model. It is intended to be the durable workflow and policy layer around coding-agent runtimes such as Codex and Claude Code. GitHub remains the primary place where engineers initiate work, answer questions, review plans, inspect pull requests, and make merge decisions.

The project currently consists primarily of its proposed V1 product and technical design. There is no usable implementation yet, and none of the described security or safety properties should be assumed to exist.

## Status

- Experimental and completely untested
- Pre-release alpha; APIs and architecture may change without notice
- Not suitable for production use
- No warranty or expectation of data safety
- Human review is required for every generated change

## Design

See [docs/v1-plan.md](docs/v1-plan.md) for the proposed product scope, architecture, workflows, safety model, and implementation phases.

The [self-development walking skeleton](docs/self-development-walking-skeleton.md)
documents the durable local task-to-approved-publication path and its current
V1 boundaries.

The [resumable job loop](docs/resumable-job-loop.md) documents platform-neutral
coordination, leases, retries, crash recovery, and the local-to-Cloudflare
adapter map.

The [local-first Cloudflare coordination adapters](docs/cloudflare-coordination-adapters.md)
document run-targeted Queue delivery, D1 compare-and-set lease ownership, and
the unapplied development resource proposal.

## License

Roundhouse is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution information.
