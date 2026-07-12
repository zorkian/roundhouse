<!--
Copyright 2026 Mark Smith
SPDX-License-Identifier: Apache-2.0
-->

# Self-development walking skeleton

The walking skeleton turns a structured local task into a durable, inspectable
run. It deliberately keeps execution local while preserving the bindings that a
later control plane will need.

## Path

1. `start` validates the task, creates `runs/<run-id>/run.json`, clones an
   independent workspace, checks out the exact base commit, sets the declared
   remote and commit identity, and runs the repository bootstrap.
2. `implement` launches the bounded Codex adapter with a temporary home,
   workspace-write sandbox, network disabled, a scrubbed environment, output
   and time limits, and JSONL evidence. Changed paths must match the allowlist.
3. `validate` inventories the diff, selects commands from the repository
   profile, executes them without a shell, and records the patch, evidence, and
   their hashes under the run ID.
4. `approve` accepts only the recorded run ID, exact base commit, and exact
   patch SHA-256.
5. `commit` reconstructs and verifies the approved patch, refuses unrelated
   staged changes or a moved base, and commits only that patch.
6. `push` verifies local HEAD, the configured remote URL, and expected remote
   branch head. A force-with-lease tied to that exact expectation makes branch
   creation and fast-forward publication race-safe; the remote head is read
   back afterward.

Every operation is a separate CLI invocation and reloads state from disk. A
process restart between operations is therefore part of the normal path.

## Operator commands

Build once, then invoke
`packages/self-development/dist/walking-skeleton-cli.js` with one command and
the common `--root`, `--profile`, and `--run` arguments:

- `start --task <task.json>`
- `implement [--codex-home <path>] [--timeout-ms <milliseconds>]`
- `validate`
- `status`
- `approve --approval <approval.json>`
- `commit`
- `push --commit <sha>`

The root `pnpm skeleton -- <command> ...` script builds before invoking the
same CLI. Task publication declares the exact remote URL, output branch,
expected remote head (or `null` for creation), commit message, and author.

## Durable artifacts

`<root>/runs/<run-id>/` contains the authoritative `run.json`, isolated
workspace, normalized agent events, validation patch and evidence, manifest,
and approval. The event sequence records every state transition. Files are
written atomically and private by default.

## V1 limitations

- The file store assumes one writer per run ID; distributed locking and job
  claiming are not implemented.
- Local execution is a development backend. Production work still requires the
  designed container boundary and default-deny egress enforcement.
- Codex is the only implementation adapter exercised by this milestone.
- Approval remains an explicit operator action; identity is recorded but not
  yet backed by a remote authentication service.
- Draft pull-request creation is an external GitHub operation after verified
  push. Roundhouse does not hold ambient GitHub credentials.
- Failed validation records its state and command in the run log, but a complete
  failed-run artifact bundle is future work.

The next milestone should replace the local sequence driver with a resumable
job loop and authenticated control-plane approval while retaining these exact
base, patch, evidence, and publication invariants.
