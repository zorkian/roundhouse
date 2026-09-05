<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Production deployment

Production is an explicit promotion, not a continuous deployment target. Do
not provision resources, change GitHub or Access settings, run migrations, or
dispatch the production workflow until the production owner approves the
cutover.

The current `roundhouse.rm-rf.rip` hostname serves the archived V1 Worker
`roundhouse-prod-control-plane`. The V2 deployment deliberately uses fresh
resources. It does not migrate or delete V1 data, which keeps the V1 Worker and
its resources available as the cutover rollback path.

## Production topology

| Resource                   | Production value                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| Public hostname            | `roundhouse.rm-rf.rip`                                                                            |
| Control-plane Worker       | `roundhouse-v2-control-plane-production`                                                          |
| Runtime-host Worker        | `roundhouse-v2-runtime-host-production`                                                           |
| Model-broker Worker        | `roundhouse-v2-model-broker-production`                                                           |
| D1 database                | `roundhouse-v2-production`                                                                        |
| Wakeup queue / DLQ         | `roundhouse-v2-production-wakeups` / `roundhouse-v2-production-wakeups-dlq`                       |
| Conversation queue / DLQ   | `roundhouse-v2-production-conversation-turns` / `roundhouse-v2-production-conversation-turns-dlq` |
| R2 workspace backup bucket | `roundhouse-v2-production-workspaces`                                                             |
| Artifacts namespace        | `roundhouse-v2-production`                                                                        |
| Workflow                   | `roundhouse-v2-production-attempt-execution`                                                      |
| AI Gateway                 | `roundhouse-v2-production`                                                                        |
| GitHub comment command     | `/roundhouse start`                                                                               |

Production values live under `env.production` in each checked-in Wrangler
configuration. Dynamic public identifiers are committed as deliberately
non-working sentinels. `pnpm render:production-config` validates environment
variables and writes ignored `wrangler.production.jsonc` files alongside the
source configurations. Neither that command nor `pnpm check` contacts or
changes Cloudflare; `pnpm check` performs local Wrangler dry runs.

## One-time bootstrap

Perform this section only after an explicit production-change approval. Use a
Cloudflare token scoped to the named production resources and the capabilities
required by Wrangler. Do not reuse the V1 D1 database, queues, R2 bucket,
Artifacts namespace, Workflow, or AI Gateway.

1. Create the D1 database and record the returned UUID as
   `CLOUDFLARE_V2_D1_DATABASE_ID`:

   ```sh
   pnpm exec wrangler d1 create roundhouse-v2-production
   ```

2. Create the four queues:

   ```sh
   pnpm exec wrangler queues create roundhouse-v2-production-wakeups
   pnpm exec wrangler queues create roundhouse-v2-production-wakeups-dlq
   pnpm exec wrangler queues create roundhouse-v2-production-conversation-turns
   pnpm exec wrangler queues create roundhouse-v2-production-conversation-turns-dlq
   ```

3. Create the workspace backup bucket:

   ```sh
   pnpm exec wrangler r2 bucket create roundhouse-v2-production-workspaces
   ```

   Create a dedicated R2 API credential limited to this bucket. The access key
   and secret become the GitHub Environment secrets listed below.

4. Create the `roundhouse-v2-production` Artifacts namespace and AI Gateway in
   the Cloudflare dashboard. Wrangler 4.112.0 can inspect Artifacts namespaces
   but cannot create one. Configure the AI Gateway providers and Unified
   Billing access to match development, then create an AI Gateway token with
   account-level AI Gateway Run permission.

5. Create a dedicated V2 production GitHub App. Mirror the repository
   permissions and subscribed events from the development app, and configure:

   - callback URL:
     `https://roundhouse.rm-rf.rip/auth/github/callback`
   - webhook URL: `https://roundhouse.rm-rf.rip/github/webhook`
   - a new webhook secret

   Keeping V1 and V2 on separate Apps makes rollback unambiguous. Do not install
   the V2 App on repositories until the cutover is ready.

6. Keep the existing Cloudflare Access application on the production hostname.
   Before cutover, add a path-specific Access bypass for
   `roundhouse.rm-rf.rip/github/webhook`; the old V1 bypass for
   `/v1/github/webhook` does not cover the V2 endpoint. Keep all UI paths
   protected. Confirm the production Access service token can request
   `/health` using `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers.

7. Populate the protected GitHub Environment `roundhouse-production`. Keep its
   required reviewer and `main` deployment-branch policy.

   Variables:

   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_V2_D1_DATABASE_ID` (the fresh V2 UUID, not the legacy
     `CLOUDFLARE_D1_DATABASE_ID` value)
   - `CLOUDFLARE_WORKERS_SUBDOMAIN`
   - `ROUNDHOUSE_GITHUB_APP_ID`
   - `ROUNDHOUSE_GITHUB_CLIENT_ID`

   Secrets:

   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCESS_CLIENT_ID`
   - `CLOUDFLARE_ACCESS_CLIENT_SECRET`
   - `ROUNDHOUSE_AI_GATEWAY_TOKEN`
   - `ROUNDHOUSE_CALLBACK_SIGNING_SECRET`
   - `ROUNDHOUSE_R2_ACCESS_KEY_ID`
   - `ROUNDHOUSE_R2_SECRET_ACCESS_KEY`
   - `ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY`
   - `ROUNDHOUSE_GITHUB_CLIENT_SECRET`
   - `ROUNDHOUSE_GITHUB_WEBHOOK_SECRET`

Use independent random values for the callback-signing and GitHub webhook
secrets. Do not copy Worker secrets into checked-in config or workflow logs.

## Promotion and cutover

A merged pull request first passes `pnpm check` and deploys to the shared
development environment through `.github/workflows/ci.yml`. After that deploy
succeeds, CI emits a provenance-bound deployment receipt as the
`roundhouse-v2-development-<run-id>` Actions artifact.

To promote that exact merge commit after production approval:

1. Exercise it in development and record the successful CI run ID.
2. Manually dispatch **Promote production** with that run ID.
3. Review the pending `roundhouse-production` Environment deployment. Approval
   starts all production mutations; rejection leaves production untouched.

The workflow verifies the receipt and source commit, checks that the commit is
on `main`, reruns the complete local checks, and renders production config. It
then deploys the model broker, deploys the runtime host and container, applies
D1 migrations, and finally deploys the control plane. The final deployment
assigns `roundhouse.rm-rf.rip` to V2, so the hostname remains on V1 if an earlier
step fails. A service-token-authenticated `/health` request must succeed before
the workflow records a production deployment receipt.

After the health check succeeds, install or enable the V2 GitHub App on the
approved repositories and send a test webhook. Verify the webhook response and
Worker logs before announcing the cutover.

## Rollback

Do not roll back D1 migrations or copy V2 records into V1. For a cutover
rollback, reassign `roundhouse.rm-rf.rip` to the preserved
`roundhouse-prod-control-plane` V1 Worker, restore the V1 GitHub App delivery,
and disable V2 App delivery. Leave the isolated V2 Workers and data intact for
diagnosis. These are production mutations and require a separate explicit
approval.
