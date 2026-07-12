<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Resumable self-development job loop

The resumable job loop separates workflow policy from infrastructure. The
platform-neutral coordinator depends only on `JobStore`, `JobStageExecutor`,
and `Clock` contracts. It does not import filesystem, Git, process, Docker, or
Cloudflare APIs.

## Architecture

The coordinator claims one eligible run, records a stage attempt, calls the
stage executor, and atomically records success or classified failure. An opaque
`workspaceRef` crosses the coordinator boundary; only the local adapter knows
that `local:/...` refers to a directory.

| Port or concept             | Local adapter                | Intended Cloudflare adapter      |
| --------------------------- | ---------------------------- | -------------------------------- |
| Durable job and lease state | private JSON records         | D1 or Durable Objects            |
| Serialized claiming         | per-run atomic mutex         | D1 transaction or Durable Object |
| Buffered work notification  | directory scan               | Queue                            |
| Workflow driver             | resumable coordinator CLI    | Workflow or Queue consumer       |
| Immutable evidence          | private run directory        | R2                               |
| Workspace and commands      | isolated local clone/process | Container RPC                    |
| Publication                 | verified local Git           | capability broker/container      |

The same job-store contract suite is intended to run against future D1 or
Durable Object implementations. Cloudflare adapters may change persistence and
delivery mechanics but must preserve lease, attempt, state, approval, and
publication semantics.

## Recovery semantics

- Submission is durable before a worker can claim the run.
- A live lease has one opaque token and one worker owner.
- A second worker cannot claim a run until its lease expires.
- Reclaiming an expired lease marks the abandoned running attempt as a
  retryable `lease_expired` failure before starting another attempt.
- Every stage has a configured maximum attempt count. Non-retryable failures or
  an exhausted count make the run terminally failed.
- Preparing a workspace is repeatable and replaces an incomplete clone.
- Retrying implementation resets the isolated checkout to the exact base and
  removes untracked changes before invoking the agent again.
- Validation rewrites evidence from the current exact patch and persists both
  successful and failed validation evidence.
- Commit recovery recognizes an existing commit only when its diff hash equals
  the approved patch hash.
- Push recovery recognizes an already-published remote head only when it equals
  the approved commit.

The local worker uses a 30-minute lease by default, longer than the configured
agent and validation timeouts. V1 does not renew a lease during a stage;
production adapters should add heartbeat renewal for longer work.

## Approval and validation

The worker progresses through preparation, implementation, and validation, then
stops at `awaiting_approval`. Approval remains a separate operation bound to the
run ID, exact base commit, and exact patch SHA-256. Only an approved run becomes
claimable for commit and verified push.

Repository profiles may define a `validation.license` command. Roundhouse runs
`pnpm license:check` as a named validation step, so its exit status and output
hashes are part of approval evidence rather than an informal extra check.

## Local operation

The root `pnpm job` command builds and invokes the local driver:

```text
pnpm job submit --root <root> --profile <profile> --run <id> --task <task.json>
pnpm job status --root <root> --run <id>
pnpm job work-once --root <root> --profile <profile> [worker options]
pnpm job work-until-blocked --root <root> --profile <profile> --run <id>
```

Worker options include `--worker`, `--lease-ms`, `--max-attempts`,
`--codex-home`, and `--agent-timeout-ms`. Each invocation reconstructs the
store, coordinator, and adapters, making process restart the ordinary execution
model.

## Current limitations

- The local mutex is a development serialization mechanism, not a distributed
  lock. A Cloudflare store must use transactional compare-and-set semantics.
- Directory scanning substitutes for a real queue locally.
- Lease heartbeat renewal is not implemented during a stage.
- The dedicated subscription-backed Codex credential remains readable by the
  local agent sandbox under the explicitly accepted dogfood exception.
- Artifact storage is still filesystem-backed; the coordinator boundary is
  portable, but an R2 implementation does not yet exist.
- The legacy manual walking-skeleton CLI remains available while consumers move
  to the resumable driver.

The next milestone should implement the first Cloudflare-side persistence and
queue adapters behind these contracts without changing coordinator behavior.
