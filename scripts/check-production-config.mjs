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
import { parse as parseYaml } from "yaml";

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

  const deploymentWorkflowSource = await readFile(
    resolve(repositoryRoot, ".github/workflows/ci.yml"),
    "utf8",
  );
  const deploymentWorkflow = parseYaml(deploymentWorkflowSource);
  assert.deepEqual(Object.keys(deploymentWorkflow.on ?? {}).sort(), [
    "pull_request",
    "push",
  ]);
  assert.deepEqual(deploymentWorkflow.on?.pull_request?.types, [
    "opened",
    "synchronize",
    "reopened",
  ]);
  assert.deepEqual(deploymentWorkflow.on?.push?.branches, ["main"]);
  assert.deepEqual(Object.keys(deploymentWorkflow.jobs ?? {}).sort(), [
    "check",
    "deploy-production",
  ]);

  const productionJob = deploymentWorkflow.jobs["deploy-production"];
  const checkJob = deploymentWorkflow.jobs.check;
  assert.equal(
    checkJob.concurrency.group,
    "check-${{ github.workflow }}-${{ github.event_name == 'push' && github.sha || github.ref }}",
  );
  assert.equal(checkJob.concurrency["cancel-in-progress"], true);
  assert.equal(
    checkJob.steps.find((step) => step.name === "Run checks")?.run,
    "pnpm check",
  );
  assert.equal(productionJob.needs, "check");
  assert.equal(productionJob.if, "github.event_name == 'push'");
  assert.equal(productionJob.environment, "roundhouse-production");
  assert.deepEqual(productionJob.concurrency, {
    group: "roundhouse-production",
    "cancel-in-progress": false,
  });

  const productionStep = (name) => {
    const step = productionJob.steps.find(
      (candidate) => candidate.name === name,
    );
    assert(step, `production deployment is missing step: ${name}`);
    return step;
  };
  const requiredProductionSteps = [
    "Build production candidate",
    "Render production configuration",
    "Verify required deployment credentials",
    "Verify retained production Worker state",
    "Verify Cloudflare-hosted production secrets",
    "Verify production commit is current",
    "Deploy model broker",
    "Deploy runtime host",
    "Apply production D1 migrations",
    "Deploy control plane",
    "Verify production health",
    "Record production deployment",
    "Upload production deployment receipt",
  ];
  let previousStepIndex = -1;
  for (const name of requiredProductionSteps) {
    const stepIndex = productionJob.steps.findIndex(
      (step) => step.name === name,
    );
    assert(
      stepIndex > previousStepIndex,
      `production deployment step is missing or out of order: ${name}`,
    );
    previousStepIndex = stepIndex;
  }
  const assertStepRunIncludes = (name, fragments) => {
    const run = productionStep(name).run;
    assert.equal(typeof run, "string", `${name} must be a run step`);
    for (const fragment of fragments)
      assert(run.includes(fragment), `${name} must include: ${fragment}`);
  };

  assert.equal(productionStep("Build production candidate").run, "pnpm build");
  assert.equal(
    productionStep("Render production configuration").run,
    "pnpm render:production-config",
  );

  for (const secret of [
    "ROUNDHOUSE_AI_GATEWAY_TOKEN",
    "ROUNDHOUSE_CALLBACK_SIGNING_SECRET",
    "ROUNDHOUSE_GITHUB_CLIENT_SECRET",
    "ROUNDHOUSE_R2_ACCESS_KEY_ID",
    "ROUNDHOUSE_R2_SECRET_ACCESS_KEY",
  ]) {
    assert.equal(
      deploymentWorkflowSource.includes(`secrets.${secret}`),
      false,
      `${secret} must remain in Cloudflare`,
    );
  }
  assert.equal(
    deploymentWorkflowSource.includes("--secrets-file"),
    false,
    "production deployment must not receive Worker secret values",
  );
  assertStepRunIncludes("Verify required deployment credentials", [
    "ACCESS_CLIENT_ID ACCESS_CLIENT_SECRET CLOUDFLARE_API_TOKEN",
    '[[ -z "${!name}" ]]',
  ]);
  assertStepRunIncludes("Verify retained production Worker state", [
    "wrangler deployments status",
    "wrangler versions view",
    'index("ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY")',
    'index("ROUNDHOUSE_GITHUB_WEBHOOK_SECRET")',
  ]);
  assertStepRunIncludes("Verify Cloudflare-hosted production secrets", [
    "node scripts/verify-production-secrets.mjs",
    "apps/control-plane/wrangler.production.jsonc",
    "apps/runtime-host/wrangler.production.jsonc",
    "apps/model-broker/wrangler.production.jsonc",
  ]);
  assertStepRunIncludes("Verify production commit is current", [
    'gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main"',
    '[[ "$CURRENT_MAIN_COMMIT" != "$SOURCE_COMMIT" ]]',
    "Refusing to deploy stale commit",
  ]);
  assert.deepEqual(productionStep("Verify production commit is current").env, {
    GH_TOKEN: "${{ github.token }}",
    SOURCE_COMMIT: "${{ github.sha }}",
  });
  assertStepRunIncludes("Deploy model broker", [
    "pnpm exec wrangler deploy",
    "--env production",
    "--config apps/model-broker/wrangler.production.jsonc",
    "--strict",
  ]);
  assertStepRunIncludes("Deploy runtime host", [
    "pnpm exec wrangler deploy",
    "--env production",
    "--config apps/runtime-host/wrangler.production.jsonc",
    "--containers-rollout immediate",
    "--strict",
  ]);
  assertStepRunIncludes("Apply production D1 migrations", [
    "wrangler d1 migrations apply roundhouse-v2-production",
    "--env production",
    "--remote",
    "--config apps/control-plane/wrangler.production.jsonc",
  ]);
  assertStepRunIncludes("Deploy control plane", [
    "pnpm exec wrangler deploy",
    "--env production",
    "--config apps/control-plane/wrangler.production.jsonc",
    "--strict",
  ]);
  assertStepRunIncludes("Verify production health", [
    "CF-Access-Client-Id: $ACCESS_CLIENT_ID",
    "CF-Access-Client-Secret: $ACCESS_CLIENT_SECRET",
    "https://roundhouse.rm-rf.rip/health",
    '.ok == true and .service == "roundhouse-v2-control-plane"',
  ]);
  assertStepRunIncludes("Record production deployment", [
    'environment: "roundhouse-production"',
    "workflowRunId: $workflowRunId",
    "workflowRunAttempt: $workflowRunAttempt",
    '"$RUNNER_TEMP/production-deployment.json"',
  ]);
  const receiptUpload = productionStep("Upload production deployment receipt");
  assert.equal(
    receiptUpload.uses,
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  );
  assert.deepEqual(receiptUpload.with, {
    name: "roundhouse-v2-production-${{ github.run_id }}",
    path: "${{ runner.temp }}/production-deployment.json",
    "if-no-files-found": "error",
    overwrite: true,
    "retention-days": 90,
  });
  for (const secret of [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCESS_CLIENT_ID",
    "CLOUDFLARE_ACCESS_CLIENT_SECRET",
  ])
    assert(
      deploymentWorkflowSource.includes(`secrets.${secret}`),
      `production deployment requires ${secret}`,
    );
} finally {
  await Promise.all(
    renderedConfigs.map((path) => unlink(path).catch(() => undefined)),
  );
  await rm(scratch, { force: true, recursive: true });
}
