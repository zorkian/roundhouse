// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse } from "jsonc-parser";

import {
  productionConfigs,
  renderProductionConfigs,
} from "./render-production-config.mjs";

const run = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputName = "wrangler.production.check.jsonc";
const scratch = await mkdtemp(join(tmpdir(), "roundhouse-production-config-"));
const secretStoreId = "ba2c9da053a64e33879014c5fa473a73";
const expectedSecretStoreBindings = {
  "control-plane": [
    {
      binding: "CALLBACK_SIGNING_SECRET",
      store_id: secretStoreId,
      secret_name: "roundhouse-v2-production-callback-signing-secret",
    },
    {
      binding: "ROUNDHOUSE_GITHUB_CLIENT_SECRET",
      store_id: secretStoreId,
      secret_name: "roundhouse-v2-production-github-client-secret",
    },
  ],
  "model-broker": [
    {
      binding: "AI_GATEWAY_TOKEN",
      store_id: secretStoreId,
      secret_name: "roundhouse-v2-production-ai-gateway-token",
    },
  ],
  "runtime-host": [
    {
      binding: "CALLBACK_SIGNING_SECRET",
      store_id: secretStoreId,
      secret_name: "roundhouse-v2-production-callback-signing-secret",
    },
  ],
};
let renderedConfigs = [];

try {
  renderedConfigs = await renderProductionConfigs({
    environment: {
      CLOUDFLARE_ACCOUNT_ID: "11111111111111111111111111111111",
      CLOUDFLARE_V2_D1_DATABASE_ID: "11111111-1111-4111-8111-111111111111",
      CLOUDFLARE_WORKERS_SUBDOMAIN: "production-config-check",
      ROUNDHOUSE_GITHUB_APP_ID: "1234567",
      ROUNDHOUSE_GITHUB_CLIENT_ID: "Iv1234567890abcdef12",
    },
    outputName,
  });

  for (const relativePath of productionConfigs) {
    const service = basename(dirname(relativePath));
    const config = resolve(
      dirname(resolve(repositoryRoot, relativePath)),
      outputName,
    );
    const parsed = parse(await readFile(config, "utf8"));
    assert.deepEqual(
      parsed.env.production.secrets_store_secrets,
      expectedSecretStoreBindings[service],
    );
    if (service === "control-plane") {
      assert.deepEqual(parsed.env.production.migrations, [
        {
          tag: "execution-container-v1",
          new_sqlite_classes: ["RoundhouseExecutionContainer"],
        },
        {
          tag: "v2-production-control-plane-cutover",
          deleted_classes: ["RoundhouseExecutionContainer"],
        },
      ]);
      assert.deepEqual(parsed.env.production.r2_buckets, [
        {
          binding: "BACKUP_BUCKET",
          bucket_name: "roundhouse-v2-production-workspaces",
          remote: true,
        },
      ]);
      assert.equal(parsed.env.production.vars.BACKUP_BUCKET_NAME, undefined);
      assert.equal(
        parsed.env.production.vars.CLOUDFLARE_R2_ACCOUNT_ID,
        undefined,
      );
    }
    if (service === "runtime-host") {
      assert.deepEqual(parsed.env.production.r2_buckets, [
        {
          binding: "BACKUP_BUCKET",
          bucket_name: "roundhouse-v2-production-workspaces",
          remote: true,
        },
      ]);
      assert.equal(
        parsed.env.production.vars.BACKUP_BUCKET_NAME,
        "roundhouse-v2-production-workspaces",
      );
      assert.equal(
        parsed.env.production.vars.CLOUDFLARE_R2_ACCOUNT_ID,
        "11111111111111111111111111111111",
      );
    }
    const { stderr, stdout } = await run(
      resolve(repositoryRoot, "node_modules/.bin/wrangler"),
      [
        "deploy",
        "--dry-run",
        "--env",
        "production",
        "--containers-rollout",
        "none",
        "--config",
        config,
        "--outdir",
        join(scratch, service),
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID: "11111111111111111111111111111111",
          NO_COLOR: "1",
          WRANGLER_LOG_PATH: join(scratch, `wrangler-${service}.log`),
        },
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    process.stdout.write(stdout);
    process.stderr.write(stderr);
  }

  const promotionWorkflow = await readFile(
    resolve(repositoryRoot, ".github/workflows/promote-production.yml"),
    "utf8",
  );
  for (const secret of [
    "ROUNDHOUSE_AI_GATEWAY_TOKEN",
    "ROUNDHOUSE_CALLBACK_SIGNING_SECRET",
    "ROUNDHOUSE_GITHUB_CLIENT_SECRET",
    "ROUNDHOUSE_R2_ACCESS_KEY_ID",
    "ROUNDHOUSE_R2_SECRET_ACCESS_KEY",
  ]) {
    assert.equal(
      promotionWorkflow.includes(`secrets.${secret}`),
      false,
      `${secret} must remain in Cloudflare`,
    );
  }
  assert.equal(
    promotionWorkflow.includes("--secrets-file"),
    false,
    "production promotion must not receive Worker secret values",
  );
  assert(
    promotionWorkflow.includes("node scripts/verify-production-secrets.mjs"),
    "production promotion must run the Cloudflare secret preflight",
  );
  for (const secret of [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCESS_CLIENT_ID",
    "CLOUDFLARE_ACCESS_CLIENT_SECRET",
  ])
    assert(
      promotionWorkflow.includes(`secrets.${secret}`),
      `production promotion requires ${secret}`,
    );
} finally {
  await Promise.all(
    renderedConfigs.map((path) => unlink(path).catch(() => undefined)),
  );
  await rm(scratch, { force: true, recursive: true });
}
