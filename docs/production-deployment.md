<!-- Copyright 2026 Mark Smith -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Production deployment

Production deploys automatically after a commit reaches `main` and passes the
same `pnpm check` suite used by pull requests. Do not provision resources,
change GitHub or Access settings, or run production mutations outside that
workflow unless the production owner explicitly requests it.

The `roundhouse.rm-rf.rip` hostname serves the V2 application through the
existing `roundhouse-prod-control-plane` Worker. The in-place cutover retained
the production GitHub App's write-only private key and webhook secret. V2 uses
its own data and execution resources; V1 data was not migrated.

That Worker already has the Durable Object migration tag
`execution-container-v1`. The production Wrangler environment retains that
history anchor, then applies `v2-production-control-plane-cutover` to delete the
unused `RoundhouseExecutionContainer` namespace and all of its V1 data. Do not
substitute the V2 development migration history: those short-lived
control-plane classes were never deployed on this Worker, and the final V2
Durable Object class belongs to the separately named runtime-host Worker. The
deployment workflow accepts the before- or after-cutover tag and rejects any
other deployed migration lineage before making production changes.

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

   Create a dedicated R2 API credential limited to this bucket. Store the
   access key and secret directly on the production runtime-host Worker during
   the pre-cutover bootstrap below. The Sandbox SDK reads these two bindings
   synchronously during Durable Object construction, so they cannot use an
   asynchronous Secrets Store binding.

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
   The `Roundhouse GitHub webhook` application already owns exact destinations
   for both development and production `/v1/github/webhook` paths and bypasses
   Access for those endpoints only. Keep all UI paths protected. Confirm the
   production Access service token can request `/health` using
   `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers.

7. Populate the account's existing Cloudflare Secrets Store
   (`default_secrets_store`, ID `ba2c9da053a64e33879014c5fa473a73`)
   with the following secrets, each scoped to `workers`. Enter values through
   the Cloudflare dashboard or Wrangler's interactive prompt; never pass a
   value with the `--value` flag.

   - `roundhouse-v2-production-ai-gateway-token`
   - `roundhouse-v2-production-callback-signing-secret`
   - `roundhouse-v2-production-github-client-secret`

   For example:

   ```sh
   pnpm exec wrangler secrets-store secret create \
     ba2c9da053a64e33879014c5fa473a73 \
     --name roundhouse-v2-production-github-client-secret \
     --scopes workers \
     --remote
   ```

   The callback value must be newly generated random key material. The
   production config binds these values directly from Secrets Store; their
   plaintext never enters GitHub Actions.

8. From the reviewed merge commit, render the production configuration and
   pre-deploy the non-public model-broker and runtime-host Workers. Then enter
   the R2 credentials directly into Wrangler's interactive secret prompts for
   the runtime-host Worker:

   ```sh
   pnpm render:production-config
   pnpm exec wrangler deploy --env production \
     --config apps/model-broker/wrangler.production.jsonc --strict
   pnpm exec wrangler deploy --env production \
     --config apps/runtime-host/wrangler.production.jsonc \
     --containers-rollout immediate --strict
   pnpm exec wrangler secret put R2_ACCESS_KEY_ID --env production \
     --config apps/runtime-host/wrangler.production.jsonc
   pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY --env production \
     --config apps/runtime-host/wrangler.production.jsonc
   ```

   Neither Worker has a public route. This bootstrap lets the deployment fail
   before updating the public control plane if Cloudflare-hosted secret
   metadata is incomplete.

9. Populate the GitHub Environment `roundhouse-production`. Keep its `main`
   deployment-branch policy. Do not configure required reviewers while
   production is intended to deploy continuously from `main`.

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

   After the Cloudflare-hosted replacements are verified, delete these obsolete
   GitHub Environment secrets:

   - `ROUNDHOUSE_AI_GATEWAY_TOKEN`
   - `ROUNDHOUSE_CALLBACK_SIGNING_SECRET`
   - `ROUNDHOUSE_GITHUB_CLIENT_SECRET`
   - `ROUNDHOUSE_R2_ACCESS_KEY_ID`
   - `ROUNDHOUSE_R2_SECRET_ACCESS_KEY`

The Cloudflare API token needs Workers deployment permissions and Secrets Store
Edit permission because attaching a secret to a Worker is a write against the
secret binding. The Access credentials are used only for the post-deploy health
check. No Worker-consumed secret belongs in the GitHub Environment.

The existing `ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY` and
`ROUNDHOUSE_GITHUB_WEBHOOK_SECRET` per-Worker secrets stay attached to
`roundhouse-prod-control-plane`; Cloudflare preserves omitted per-Worker
secrets from its previous version. The runtime host similarly retains its two
R2 per-Worker secrets after bootstrap. Do not copy Worker secrets into
checked-in config, GitHub, or workflow logs.

## Continuous deployment

`.github/workflows/ci.yml` is the only deployment workflow:

1. Pull requests run the **Check** job and do not deploy.
2. A merge or direct push to `main` runs **Check** again on the exact production
   commit.
3. A successful check starts **Deploy production** in the
   `roundhouse-production` GitHub Environment. Production deployments are
   serialized and never cancel an in-progress deployment.

The production job builds the application, renders the production configs,
verifies the retained Worker credentials and Cloudflare-hosted secret bindings,
deploys the model broker, deploys the runtime host and container, applies D1
migrations, and deploys the control plane. A service-token-authenticated
`/health` request must succeed before CI records a
`roundhouse-v2-production-<run-id>` deployment receipt.

The old shared-development deployment and manual receipt-promotion workflow are
not part of the release path. Their Cloudflare resources may remain until a
separate, explicitly authorized cleanup.
