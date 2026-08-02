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

This product has no `pnpm dev` / local run mode. The Workers are deployed to
Cloudflare with `wrangler` (`pnpm deploy:development`), which needs an
authenticated Cloudflare account plus a GitHub App and AI Gateway token — not
available or needed for local development. The documented local end-to-end path
is `pnpm check` (README).

`wrangler dev` cannot boot the control-plane Worker locally: `workerd` rejects
`apps/control-plane/src/index.ts` because it exports a non-function constant
(`controlPlaneService`) and treats every named export as an entrypoint
(`Incorrect type for map entry 'controlPlaneService': ... not of type 'function
or ExportedHandler'`). This is a local-runtime limitation only; the Worker
deploys fine to Cloudflare. Validate Worker logic through the test suite, not
`wrangler dev`. To exercise real core logic directly, the compiler in
`@roundhouse/core` (`parseProfile` / `compileWorkflow`) can be run against the
repo's own `.roundhouse/profile.yaml` + `workflow.yaml`.

### Other notes

- The runner test suite creates `.runner-test-workspaces/` at the repo root. If a
  run is interrupted it may be left behind and cause `ENOTEMPTY` on the next run;
  `rm -rf .runner-test-workspaces` before retrying.
- `pnpm install` prints "Ignored build scripts" (esbuild, workerd, sharp, etc.).
  This is intentional (`onlyBuiltDependencies: []` in `pnpm-workspace.yaml`); do
  not run the interactive `pnpm approve-builds`.
