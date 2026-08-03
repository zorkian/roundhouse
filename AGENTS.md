# AGENTS

## Cursor Cloud specific instructions

Roundhouse is a pnpm monorepo of Cloudflare Workers (see `README.md` for the
product overview and `docs/v2-plan.md` for the architecture). Standard commands
live in the root `package.json` scripts and `README.md`; prefer those instead of
inventing new ones.

### Node version (important gotcha)

The repo requires Node 24 (`.node-version` pins `24.18.0`), but the VM's default
`node` on `PATH` (`/exec-daemon/node`) is v22 and is a sandbox-internal binary
that must not be modified. Node 24 is installed via `nvm`, and the interactive
login shell (`~/.bashrc`) is configured to prepend it to `PATH`. Run tooling
through a login shell so you get Node 24 — e.g. `bash -lc 'pnpm check'` — or
otherwise confirm `node --version` reports `v24.x` before running builds/tests.
Plain non-login shells may still resolve the v22 binary first.

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
| Public UI / control plane | `https://roundhouse-dev.rm-rf.rip`                                                                          |
| Control-plane workers.dev | `https://roundhouse-v2-control-plane.default-07f.workers.dev`                                               |
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
bash -lc 'gh run list --workflow=ci.yml --limit 20'

# Inspect a run: Deploy development is success on merge deploys, often
# skipped on ordinary PR checks
bash -lc 'gh run view <run-id> --json jobs,displayTitle,conclusion,url,headBranch,createdAt \
  --jq "{title: .displayTitle, conclusion, url, branch: .headBranch, createdAt, jobs: [.jobs[] | {name, conclusion, status, completedAt}]}"'

# Failed job logs
bash -lc 'gh run view <run-id> --log-failed'

# Recent merges into main (what should have triggered deploy)
bash -lc 'gh pr list --state merged --base main --limit 10'
```

Cross-check the live Worker version timestamps:

```bash
bash -lc 'pnpm exec wrangler deployments status --config apps/control-plane/wrangler.jsonc'
bash -lc 'pnpm exec wrangler deployments list --config apps/control-plane/wrangler.jsonc'
bash -lc 'pnpm exec wrangler deployments status --config apps/runtime-host/wrangler.jsonc'
bash -lc 'pnpm exec wrangler deployments status --config apps/model-broker/wrangler.jsonc'
```

A successful merge deploy should show a **Deploy development** job conclusion
of `success` (not `skipped`), and the control-plane deployment timestamp
should be at or after that job's completion.

#### Wrangler CLI

`wrangler` is a root `devDependency` (pinned in `package.json`). It is usually
**not** on global `PATH`; invoke it via `pnpm exec wrangler` or the `pnpm
deploy:development*` scripts. Auth in this Cloud environment is typically an
Account API Token from `CLOUDFLARE_API_TOKEN` (confirm with `pnpm exec
wrangler whoami`). Always use a login shell so Node 24 is first on `PATH`.

Useful read-oriented commands:

```bash
bash -lc 'pnpm exec wrangler whoami'

# Live logs (Ctrl-C / kill when done; use --format=json for scraping)
bash -lc 'pnpm exec wrangler tail --config apps/control-plane/wrangler.jsonc --format=json'
bash -lc 'pnpm exec wrangler tail --config apps/control-plane/wrangler.jsonc --status=error'
bash -lc 'pnpm exec wrangler tail --config apps/runtime-host/wrangler.jsonc --format=json'
bash -lc 'pnpm exec wrangler tail --config apps/model-broker/wrangler.jsonc --format=json'

# Remote D1 (read-only SELECTs preferred unless the user asked for a write)
bash -lc 'pnpm exec wrangler d1 execute roundhouse-v2-development --remote \
  --config apps/control-plane/wrangler.jsonc \
  --command "SELECT id, status, stage, current_node_id, updated_at FROM runs ORDER BY updated_at DESC LIMIT 20;"'

bash -lc 'pnpm exec wrangler d1 execute roundhouse-v2-development --remote \
  --config apps/control-plane/wrangler.jsonc \
  --command "SELECT id, status, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 20;"'
```

Schema for those tables lives under `apps/control-plane/migrations/`.

Cloudflare MCP servers (`Cloudflare-observability`, `Cloudflare-builds`,
`Cloudflare-bindings`) may be present but often require separate IDE auth.
When `CLOUDFLARE_API_TOKEN` works, prefer **wrangler** over those MCPs for
deployments, tails, and D1. `Cloudflare-docs` search is fine for platform
questions. Repo `gh` access in Cloud agents is **read-only** (list/view runs
and logs; do not expect `gh` write operations to succeed).

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
install script should only ensure the CLI is present; regenerating on every
build dirties the reused git checkout. Recommended install snippet:

```bash
bash -lc "corepack enable"
bash -lc "pnpm install --frozen-lockfile"

# Graphify CLI only — graph artifacts are committed in-repo
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"
uv tool install "graphifyy[mcp]"
```

If the Cloud environment install still runs `graphify update` / `graphify
extract`, update it in the Cursor dashboard to match the snippet above.

### Other notes

- The runner test suite creates `.runner-test-workspaces/` at the repo root. If a
  run is interrupted it may be left behind and cause `ENOTEMPTY` on the next run;
  `rm -rf .runner-test-workspaces` before retrying.
- `pnpm install` prints "Ignored build scripts" (esbuild, workerd, sharp, etc.).
  This is intentional (`onlyBuiltDependencies: []` in `pnpm-workspace.yaml`); do
  not run the interactive `pnpm approve-builds`.
