# AGENTS

## Cursor Cloud specific instructions

Roundhouse is a pnpm monorepo of Cloudflare Workers (see `README.md` for the
product overview and `docs/v2-plan.md` for the architecture). Standard commands
live in the root `package.json` scripts and `README.md`; prefer those instead of
inventing new ones.

### Scope: diagnose vs build

Do **not** write code, open PRs, or spend tokens on implementation unless the
user explicitly asks you to build, fix, change, or land something.

- **Debug / investigate / explain** requests are read-only: use D1, wrangler,
  GitHub, and the codebase to report what happened and why. Stop after the
  diagnosis. Do not “helpfully” implement a fix, retry policy, UI copy, or
  speculative hardening.
- **Build / fix / implement / land** requests are the signal to create a
  branch, change code, run checks, and open or update a PR.
- When unsure, ask or default to diagnosis only. Prefer answering with
  evidence over shipping unsolicited changes.

### Node version

The repo requires Node 24 (`.node-version` pins `24.18.0`). That is configured
in the Cursor Cloud environment install (dashboard), including beating
`/exec-daemon/node` (v22) on `PATH`. Use plain commands (`pnpm check`,
`pnpm exec wrangler …`) — do not wrap them in `bash -lc`. If
`node --version` is not `v24.x`, fix the Cloud environment, not individual
commands.

### There is no local dev server

This product has no `pnpm dev` / local run mode. The documented local
end-to-end path is `pnpm check` (README). Workers run in the shared Cloudflare
**development** deployment; use GitHub Actions + wrangler (below) to inspect
that environment rather than trying to boot the product locally.

`wrangler dev` cannot boot the control-plane Worker locally: `workerd` rejects
`apps/control-plane/src/index.ts` because it exports a non-function constant
(`controlPlaneService`) and treats every named export as an entrypoint
(`Incorrect type for map entry 'controlPlaneService': ... not of type 'function
or ExportedHandler'`). This is a local-runtime limitation only; the Worker
deploys fine to Cloudflare. Validate Worker logic through the test suite, not
`wrangler dev`. To exercise real core logic directly, the compiler in
`@roundhouse/core` (`parseProfile` / `compileWorkflow`) can be run against the
repo's own `.roundhouse/profile.yaml` + `workflow.yaml`.

### Development environment, GitHub Actions, and wrangler

Use these tools when asked to debug the live development deployment, check
whether `main` has shipped, inspect Worker logs, or query development state.

#### Topology

| Piece                     | Value                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Public UI / control plane | `https://roundhouse-dev.rm-rf.rip` (Cloudflare Access — agents cannot sign in)                              |
| Control-plane workers.dev | `https://roundhouse-v2-control-plane.default-07f.workers.dev` (also Access-gated for UI routes)             |
| Workers                   | `roundhouse-v2-control-plane`, `roundhouse-v2-runtime-host`, `roundhouse-v2-model-broker`                   |
| Wrangler configs          | `apps/control-plane/wrangler.jsonc`, `apps/runtime-host/wrangler.jsonc`, `apps/model-broker/wrangler.jsonc` |
| D1 database               | `roundhouse-v2-development` (id in control-plane wrangler config)                                           |
| GitHub Actions workflow   | `.github/workflows/ci.yml` (`CI`)                                                                           |
| Deploy GitHub Environment | `roundhouse-development`                                                                                    |

Deploy scripts (root `package.json`):

- `pnpm deploy:development` — build + runtime host + model broker/D1
  migrations/control plane
- `pnpm deploy:development:runtime` — runtime host only
- `pnpm deploy:development:control-plane` — model broker, remote D1
  migrations, then control plane

#### How development gets deployed

There is no continuous deploy-from-`main` push workflow. Development deploys
when a pull request is **merged into `main`**:

1. Workflow `CI` (`.github/workflows/ci.yml`) runs on `pull_request`.
2. Job **Check** always runs `pnpm check` (and also runs for the merge-commit
   checkout when a PR closed into `main` is merged).
3. Job **Deploy development** runs only when
   `github.event.action == 'closed'`, the PR is merged, and
   `base.ref == 'main'`. It uses GitHub Environment `roundhouse-development`
   and Cloudflare credentials from that environment.
4. Runtime-host deploy is conditional: the workflow diffs the merge commit
   against its first parent and skips `pnpm deploy:development:runtime`
   unless runtime-related paths changed (see the workflow's path list).
   Control-plane deploy (`pnpm deploy:development:control-plane`) always runs
   on those merge deploys.

`workflow_dispatch` can run the workflow manually; it still only runs Check
unless the event matches the merge conditions above.

#### Checking whether `main` has deployed

Prefer GitHub Actions first, then corroborate with wrangler if needed.

```bash
# Recent CI runs (merge deploys and PR checks both appear as pull_request)
gh run list --workflow=ci.yml --limit 20

# Inspect a run: Deploy development is success on merge deploys, often
# skipped on ordinary PR checks
gh run view <run-id> --json jobs,displayTitle,conclusion,url,headBranch,createdAt \
  --jq '{title: .displayTitle, conclusion, url, branch: .headBranch, createdAt, jobs: [.jobs[] | {name, conclusion, status, completedAt}]}'

# Failed job logs
gh run view <run-id> --log-failed

# Recent merges into main (what should have triggered deploy)
gh pr list --state merged --base main --limit 10
```

Cross-check the live Worker version timestamps:

```bash
pnpm exec wrangler deployments status --config apps/control-plane/wrangler.jsonc
pnpm exec wrangler deployments list --config apps/control-plane/wrangler.jsonc
pnpm exec wrangler deployments status --config apps/runtime-host/wrangler.jsonc
pnpm exec wrangler deployments status --config apps/model-broker/wrangler.jsonc
```

A successful merge deploy should show a **Deploy development** job conclusion
of `success` (not `skipped`), and the control-plane deployment timestamp
should be at or after that job's completion.

#### Wrangler CLI

`wrangler` is a root `devDependency` (pinned in `package.json`). It is usually
**not** on global `PATH`; invoke it via `pnpm exec wrangler` or the `pnpm
deploy:development*` scripts. Auth in this Cloud environment is typically an
Account API Token from `CLOUDFLARE_API_TOKEN` (confirm with `pnpm exec
wrangler whoami`).

Useful read-oriented commands:

```bash
pnpm exec wrangler whoami

# Live logs (Ctrl-C / kill when done; use --format=json for scraping)
pnpm exec wrangler tail --config apps/control-plane/wrangler.jsonc --format=json
pnpm exec wrangler tail --config apps/control-plane/wrangler.jsonc --status=error
pnpm exec wrangler tail --config apps/runtime-host/wrangler.jsonc --format=json
pnpm exec wrangler tail --config apps/model-broker/wrangler.jsonc --format=json

# Remote D1 (read-only SELECTs preferred unless the user asked for a write)
pnpm exec wrangler d1 execute roundhouse-v2-development --remote \
  --config apps/control-plane/wrangler.jsonc \
  --command "SELECT id, status, stage, current_node_id, updated_at FROM runs ORDER BY updated_at DESC LIMIT 20;"

pnpm exec wrangler d1 execute roundhouse-v2-development --remote \
  --config apps/control-plane/wrangler.jsonc \
  --command "SELECT id, status, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 20;"
```

Schema for those tables lives under `apps/control-plane/migrations/`.
`D1RunRepository.detailsByIssue` in `apps/control-plane/src/d1-store.ts`
shows how the UI joins the same data.

Cloudflare MCP servers (`Cloudflare-observability`, `Cloudflare-builds`,
`Cloudflare-bindings`) may be present but often require separate IDE auth.
When `CLOUDFLARE_API_TOKEN` works, prefer **wrangler** over those MCPs for
deployments, tails, and D1. `Cloudflare-docs` search is fine for platform
questions. Repo `gh` access in Cloud agents is **read-only** (list/view runs
and logs; do not expect `gh` write operations to succeed).

#### Debugging a live issue / run (D1, not the browser)

The run-details links Roundhouse posts on GitHub issues
(`https://roundhouse-dev.rm-rf.rip/repositories/.../issues/N`) and the same
paths on workers.dev sit behind **Cloudflare Access**. Agents cannot complete
Access login and will only ever see the email-code sign-in page. Do **not**
fetch those URLs, chase mirrors, or try to automate Access codes — use remote
D1 (and optionally `wrangler tail`) instead.

GitHub issue/PR comments (`gh issue view N --comments`) are useful timeline
hints (stage reports, PR links, visual-feedback prompts), but **D1 is
authoritative** for whether a run is active, waiting, leased, or wedged.

**Find the current run for an issue** (replace `491`):

```bash
pnpm exec wrangler d1 execute roundhouse-v2-development --remote \
  --config apps/control-plane/wrangler.jsonc \
  --json --command "SELECT w.issue_number, w.current_run_id, r.status, r.stage,
    r.current_node_id, r.revision, r.lease_attempt_id, r.lease_expires_at,
    datetime(r.updated_at/1000, 'unixepoch') AS updated_utc,
    json_extract(r.document_json, '\$.waitingReason') AS waiting_reason,
    json_extract(r.document_json, '\$.candidateHead') AS candidate_head
  FROM work_items w
  JOIN runs r ON r.id = w.current_run_id
  WHERE w.issue_number = 491;"
```

**Attempt history** (failures, outcomes, current dispatch) and **recent
events** (liveness):

```bash
# attempts for a run id from the query above
pnpm exec wrangler d1 execute roundhouse-v2-development --remote \
  --config apps/control-plane/wrangler.jsonc \
  --json --command "SELECT id, run_revision, node_id, role, state,
    datetime(deadline_at/1000, 'unixepoch') AS deadline_utc,
    datetime(updated_at/1000, 'unixepoch') AS updated_utc,
    substr(COALESCE(outcome_json, ''), 1, 400) AS outcome,
    json_extract(result_json, '\$.review.status') AS review_status
  FROM attempts WHERE run_id = 'run_…' ORDER BY created_at ASC, id ASC;"

pnpm exec wrangler d1 execute roundhouse-v2-development --remote \
  --config apps/control-plane/wrangler.jsonc \
  --json --command "SELECT attempt_id, kind, substr(payload_json, 1, 300) AS payload,
    datetime(created_at/1000, 'unixepoch') AS created_utc
  FROM events WHERE run_id = 'run_…'
  ORDER BY created_at DESC, id DESC LIMIT 40;"
```

**Stuck vs progressing (quick read):**

- Progressing: `status='active'`, current attempt `state` in
  `created`/`dispatched`/`executed`, `lease_expires_at` still in the future,
  and recent `events` for that attempt (model/tool progress).
- Waiting on a human: `waiting_reason` set (e.g. `visual_feedback`) and the
  stage/node at an approval / human boundary — check GitHub comments for the
  operator prompt.
- Likely stuck / needs recovery: lease expired with no new events, attempt
  left in `dispatched`/`executed` without completion, or repeated
  `outcome_json` kinds such as `execution_interrupted`, `branch_superseded`,
  or `checkpoint_rejected`.

Key tables: `work_items`, `runs` (`document_json` snapshot), `attempts`
(`outcome_json` / `result_json`), `events`, `outbox`.

#### Safety when debugging the shared development environment

- Prefer read-only actions: `gh run …`, `wrangler whoami`, `deployments
list|status`, `tail`, and D1 `SELECT`s.
- Do **not** run `pnpm deploy:development*` / `wrangler deploy`,
  `wrangler rollback`, `wrangler secret …`, `wrangler delete`, destructive D1
  SQL, or queue/purge mutations unless the user explicitly asks for that
  change.
- Do not print secret values, API tokens, or `.dev.vars` contents into chat
  or commit them.
- This development deployment is shared: avoid write experiments that corrupt
  runs, conversations, or auth sessions.

### Graphify knowledge graph

The repo commits a Graphify code knowledge graph under `graphify-out/`.
`graphify-out/cache/` and dated `graphify-out/YYYY-MM-DD/` pre-overwrite
safety snapshots are gitignored; commit the live artifacts (`graph.json`,
`GRAPH_REPORT.md`, labels, manifest, and related sidecar files). Agents should
prefer `graphify query` / `path` / `explain` for codebase exploration when the
CLI is available — see `.cursor/rules/graphify.mdc`.

**Keep the graph in sync with code changes.** After modifying source files (and
before you finish the turn / open or update a PR):

1. Run `graphify update .` (AST-only, no API key).
2. Stage and **commit the resulting live `graphify-out/` artifacts with the
   same change set** (or a follow-up commit on the same branch) — do not leave
   a dirty tracked graph working tree. Leave ignored cache/backup folders
   untracked.

Do **not** regenerate the graph during Cursor Cloud environment install. The
install script (dashboard) should only ensure the Graphify CLI is present;
regenerating on every build dirties the reused git checkout. If install still
runs `graphify update` / `graphify extract`, remove that from the dashboard
config.

### Other notes

- The runner test suite creates `.runner-test-workspaces/` at the repo root. If a
  run is interrupted it may be left behind and cause `ENOTEMPTY` on the next run;
  `rm -rf .runner-test-workspaces` before retrying.
- `pnpm install` prints "Ignored build scripts" (esbuild, workerd, sharp, etc.).
  This is intentional (`onlyBuiltDependencies: []` in `pnpm-workspace.yaml`); do
  not run the interactive `pnpm approve-builds`.
