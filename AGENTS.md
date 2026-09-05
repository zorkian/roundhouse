# AGENTS

## Cursor Cloud specific instructions

Roundhouse is a pnpm monorepo of Cloudflare Workers (see `README.md` for the
product overview and `docs/v2-plan.md` for the architecture). Standard commands
live in the root `package.json` scripts and `README.md`; prefer those instead of
inventing new ones.

### Scope: diagnose vs build

Do **not** write code, open PRs, or spend tokens on implementation unless the
user explicitly asks you to build, fix, change, or land something.

- **Debug / investigate / explain** requests are read-only: use D1, Wrangler,
  GitHub, and the codebase to report what happened and why. Stop after the
  diagnosis. Do not “helpfully” implement a fix, retry policy, UI copy, or
  speculative hardening.
- **Build / fix / implement / land** requests are the signal to create a
  branch, change code, run checks, and open or update a PR.
- When unsure, ask or default to diagnosis only. Prefer answering with
  evidence over shipping unsolicited changes.

### Node version

The repo requires Node 24 (`.node-version` pins `24.20.0`). That is configured
in the Cursor Cloud environment install (dashboard), including beating
`/exec-daemon/node` (v22) on `PATH`. Use plain commands (`pnpm check`,
`pnpm exec wrangler …`) — do not wrap them in `bash -lc`. If `node --version`
is not `v24.x`, fix the Cloud environment, not individual commands.

### There is no local dev server

This product has no `pnpm dev` / local run mode. The documented local
end-to-end path is `pnpm check` (README). The release path deploys directly to
production after a commit reaches `main`; use tests for local validation and
GitHub Actions + Wrangler for authorized live inspection.

`wrangler dev` cannot boot the control-plane Worker locally: `workerd` rejects
`apps/control-plane/src/index.ts` because it exports a non-function constant
(`controlPlaneService`) and treats every named export as an entrypoint
(`Incorrect type for map entry 'controlPlaneService': ... not of type 'function
or ExportedHandler'`). This is a local-runtime limitation only; the Worker
deploys fine to Cloudflare. Validate Worker logic through the test suite, not
`wrangler dev`. To exercise real core logic directly, the compiler in
`@roundhouse/core` (`parseProfile` / `compileWorkflow`) can be run against the
repo's own `.roundhouse/profile.yaml` + `workflow.yaml`.

### Production environment, GitHub Actions, and Wrangler

Use these tools when asked to check whether `main` has shipped, inspect Worker
logs, or query live state.

#### Topology

| Piece                     | Value                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Public UI / control plane | `https://roundhouse.rm-rf.rip` (Cloudflare Access — agents cannot sign in)                                                                   |
| Workers                   | `roundhouse-prod-control-plane`, `roundhouse-v2-runtime-host-production`, `roundhouse-v2-model-broker-production`                            |
| Generated configs         | `apps/control-plane/wrangler.production.jsonc`, `apps/runtime-host/wrangler.production.jsonc`, `apps/model-broker/wrangler.production.jsonc` |
| D1 database               | `roundhouse-v2-production`                                                                                                                   |
| GitHub Actions workflow   | `.github/workflows/ci.yml` (`CI`)                                                                                                            |
| Deploy GitHub Environment | `roundhouse-production`                                                                                                                      |

The checked-in `wrangler.jsonc` files contain `env.production` templates.
`pnpm render:production-config` validates GitHub Environment variables and
writes ignored `wrangler.production.jsonc` files with the live identifiers.

#### How production gets deployed

`.github/workflows/ci.yml` is the only release workflow:

1. Pull requests run **Check** (`pnpm check`) and never deploy.
2. A merge or direct push to `main` runs **Check** again on that exact commit.
3. **Deploy production** runs only after the `main` check succeeds. It uses the
   `roundhouse-production` GitHub Environment, serializes deployments, and
   never cancels an in-progress deployment.
4. The job builds, renders production config, verifies retained Worker secrets
   and Cloudflare Secrets Store bindings, deploys the model broker and runtime
   container, applies remote D1 migrations, deploys the control plane, checks
   `/health` through Cloudflare Access, and uploads a production receipt.

There is no shared-development deployment or manual promotion in the active
release path. Old development resources may still exist in Cloudflare; do not
modify or delete them without explicit authorization.

#### Checking whether `main` has deployed

Prefer GitHub Actions first, then corroborate with Wrangler if needed.

```bash
gh run list --workflow=ci.yml --limit 20

gh run view <run-id> --json jobs,displayTitle,conclusion,url,headBranch,createdAt \
  --jq '{title: .displayTitle, conclusion, url, branch: .headBranch, createdAt, jobs: [.jobs[] | {name, conclusion, status, completedAt}]}'

gh run view <run-id> --log-failed
gh pr list --state merged --base main --limit 10
```

A successful `main` run must show both **Check** and **Deploy production** as
successful. Ordinary pull-request runs show the deployment job as skipped.

When production configs have already been rendered for an authorized task,
cross-check live Worker timestamps with them:

```bash
pnpm exec wrangler deployments status --env production \
  --config apps/control-plane/wrangler.production.jsonc
pnpm exec wrangler deployments status --env production \
  --config apps/runtime-host/wrangler.production.jsonc
pnpm exec wrangler deployments status --env production \
  --config apps/model-broker/wrangler.production.jsonc
```

#### Wrangler CLI

`wrangler` is a root `devDependency` pinned in `package.json`; invoke it via
`pnpm exec wrangler`. Auth in this Cloud environment is typically an Account
API Token from `CLOUDFLARE_API_TOKEN` (confirm with `pnpm exec wrangler
whoami`). Set `WRANGLER_LOG_PATH` to a writable directory such as
`/tmp/roundhouse-wrangler-logs` for every command that may invoke Wrangler.

Useful read-only commands:

```bash
pnpm exec wrangler whoami

pnpm exec wrangler tail --env production \
  --config apps/control-plane/wrangler.production.jsonc --format=json
pnpm exec wrangler tail --env production \
  --config apps/runtime-host/wrangler.production.jsonc --format=json
pnpm exec wrangler tail --env production \
  --config apps/model-broker/wrangler.production.jsonc --format=json

pnpm exec wrangler d1 execute roundhouse-v2-production --env production \
  --remote --config apps/control-plane/wrangler.production.jsonc \
  --command "SELECT id, status, stage, current_node_id, updated_at FROM runs ORDER BY updated_at DESC LIMIT 20;"
```

Schema for live tables is under `apps/control-plane/migrations/`.
`D1RunRepository.detailsByIssue` in `apps/control-plane/src/d1-store.ts` shows
how the UI joins the same data.

Cloudflare MCP servers may require separate IDE auth. When
`CLOUDFLARE_API_TOKEN` works, prefer the repository-pinned Wrangler for
deployments, tails, and D1. Cloudflare docs search is fine for platform
questions.

#### Debugging a live issue / run

Run-detail URLs are behind Cloudflare Access. Agents cannot complete Access
login and should not try to automate Access codes. Use remote D1, Worker logs,
and GitHub issue/PR comments instead. D1 is authoritative for whether a run is
active, waiting, leased, or wedged.

Find the current run for an issue (replace `491`):

```bash
pnpm exec wrangler d1 execute roundhouse-v2-production --env production \
  --remote --config apps/control-plane/wrangler.production.jsonc \
  --json --command "SELECT w.issue_number, w.current_run_id, r.status, r.stage,
    r.current_node_id, r.revision, r.lease_attempt_id, r.lease_expires_at,
    datetime(r.updated_at/1000, 'unixepoch') AS updated_utc,
    json_extract(r.document_json, '\$.waitingReason') AS waiting_reason,
    json_extract(r.document_json, '\$.candidateHead') AS candidate_head
  FROM work_items w
  JOIN runs r ON r.id = w.current_run_id
  WHERE w.issue_number = 491;"
```

Key tables: `work_items`, `runs` (`document_json` snapshot), `attempts`
(`outcome_json` / `result_json`), `events`, and `outbox`.

#### Production safety

- Prefer read-only actions: `gh run …`, `wrangler whoami`, deployment
  `list|status`, `tail`, and D1 `SELECT`s.
- Do **not** run `wrangler deploy`, `wrangler rollback`, `wrangler secret …`,
  `wrangler delete`, destructive D1 SQL, queue mutations, or workflow dispatches
  unless the user explicitly asks for that production change.
- Do not print secret values, API tokens, or `.dev.vars` contents into chat or
  commit them.
- Read `docs/production-deployment.md` before production work. A request to
  prepare or validate repository code/config is not authorization to mutate
  production.

### Other notes

- The runner test suite creates `.runner-test-workspaces/` at the repo root. If a
  run is interrupted it may be left behind and cause `ENOTEMPTY` on the next run;
  remove that task-owned directory before retrying.
- `pnpm install` prints "Ignored build scripts" (esbuild, workerd, sharp, etc.).
  This is intentional (`onlyBuiltDependencies: []` in `pnpm-workspace.yaml`); do
  not run the interactive `pnpm approve-builds`.
