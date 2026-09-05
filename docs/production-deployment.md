<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Production deployment

Production is an explicit promotion, not a continuous deployment target. Do
not provision resources, change GitHub or Access settings, run migrations, or
dispatch the production workflow until the production owner approves the
cutover.

The current `roundhouse.rm-rf.rip` hostname serves the V1 Worker
`roundhouse-prod-control-plane`. The V2 deployment replaces that Worker in
place so it can retain the existing production GitHub App's write-only private
key and webhook secret. V2 still uses fresh data and execution resources; it
does not migrate or delete V1 data.

## Production topology

| Resource                   | Production value                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| Public hostname            | `roundhouse.rm-rf.rip`                                                                            |
| Control-plane Worker       | `roundhouse-prod-control-plane`                                                                   |
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

5. Reuse the existing production GitHub App (`GITHUB_APP_ID=4290654`). Keep its
   installation, repository permissions, subscribed events, private key, and
   webhook secret. The V2 Worker accepts the existing `/v1/github/webhook`
   path as well as `/github/webhook`, so the existing webhook URL can remain
   unchanged if it already uses the legacy path. Configure the App's user
   authorization callback URL:

   `https://roundhouse.rm-rf.rip/auth/github/callback`

   Record the App's OAuth client ID. GitHub does not reveal an existing OAuth
   client secret after creation, so use an operator-held copy or create a new
   client secret for V2.

6. Keep the existing Cloudflare Access application on the production hostname.
   Before cutover, verify the GitHub App's current webhook URL and create an
   exact path-specific Access bypass for that path if one is not present. The
   current Cloudflare inventory has no separate webhook-path Access
   application. Keep all UI paths protected. Confirm the production Access
   service token can request `/health` using `CF-Access-Client-Id` and
   `CF-Access-Client-Secret` headers.

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
   - `ROUNDHOUSE_GITHUB_CLIENT_SECRET`

The existing `ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY` and
`ROUNDHOUSE_GITHUB_WEBHOOK_SECRET` bindings stay attached to
`roundhouse-prod-control-plane`. The promotion workflow verifies both names
before its first deployment and deliberately omits them from its secret file;
Cloudflare preserves omitted secrets from the Worker's previous version. Use a
new random callback-signing secret. Do not copy Worker secrets into checked-in
config or workflow logs.

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
on `main`, reruns the complete local checks, renders production config, and
verifies the two retained GitHub App secrets. It then deploys the model broker,
deploys the runtime host and container, applies D1 migrations, and finally
replaces the existing control-plane Worker with V2. A
service-token-authenticated `/health` request must succeed before the workflow
records a production deployment receipt.

After the health check succeeds, send a test webhook from the existing GitHub
App. Verify the webhook response and Worker logs before announcing the cutover.
