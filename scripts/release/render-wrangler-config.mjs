// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { writeFileSync } from "node:fs";

const [environment, databaseId, accessAudience, imageReference, output] =
  process.argv.slice(2);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!["development", "production"].includes(environment ?? ""))
  fail("Environment must be development or production");
if (!/^[a-f0-9-]{36}$/.test(databaseId ?? "")) fail("Invalid D1 database ID");
if (!/^[a-f0-9]{64}$/.test(accessAudience ?? ""))
  fail("Invalid Access audience");
if (
  !/^registry\.cloudflare\.com\/[a-f0-9]{32}\/roundhouse-release:[a-f0-9]{40}@sha256:[a-f0-9]{64}$/.test(
    imageReference ?? "",
  )
)
  fail("Container image reference must bind an exact commit and digest");
if (
  !/^\.roundhouse\/release\/wrangler\.(development|production)\.json$/.test(
    output ?? "",
  )
)
  fail("Output must be the matching generated release configuration path");
if (output !== `.roundhouse/release/wrangler.${environment}.json`)
  fail("Output environment does not match configuration environment");

const production = environment === "production";
const prefix = production ? "roundhouse-prod" : "roundhouse-dev";
const origin = production
  ? "https://roundhouse.rm-rf.rip"
  : "https://roundhouse-dev.rm-rf.rip";

const config = {
  $schema: "../../node_modules/wrangler/config-schema.json",
  name: `${prefix}-control-plane`,
  main: "../../apps/control-plane-worker/src/deploy.ts",
  compatibility_date: "2026-07-11",
  workers_dev: false,
  preview_urls: false,
  routes: production
    ? [{ pattern: "roundhouse.rm-rf.rip", custom_domain: true }]
    : undefined,
  triggers: { crons: ["*/5 * * * *"] },
  vars: {
    ROUNDHOUSE_ENVIRONMENT: environment,
    ROUNDHOUSE_PUBLIC_ORIGIN: origin,
    ROUNDHOUSE_REPOSITORY: "zorkian/roundhouse",
    ROUNDHOUSE_WORKER_ID: `${prefix}-control-plane`,
    AUTH_MODE: "access",
    ACCESS_TEAM_DOMAIN: "zorkian",
    ACCESS_POLICY_AUD: accessAudience,
    DELEGATED_ACTOR_ID: "zorkian@fastmail.fm",
    EXECUTION_MODE: "cloudflare-trusted-codex",
    EXECUTION_SCENARIO: "success",
    TRUSTED_EXECUTION_SCENARIO: "success",
    INDEPENDENT_REVIEW_ENABLED: "true",
    INDEPENDENT_REVIEW_SCENARIO: "success",
    GITHUB_REVIEW_CHECKS_ENABLED: "true",
    GITHUB_APP_ID: production ? "4290654" : "4281837",
    GITHUB_INSTALLATION_ID: production ? "146381255" : "146147681",
    ALLOWED_REPOSITORY_PATH: "/workspace/roundhouse",
    ALLOWED_REMOTE_URL: "https://github.com/zorkian/roundhouse.git",
  },
  d1_databases: [
    {
      binding: "DB",
      database_name: `${prefix}-coordination`,
      database_id: databaseId,
      migrations_dir: "../../apps/control-plane-worker/migrations",
    },
  ],
  r2_buckets: [
    { binding: "EXECUTION_EVIDENCE", bucket_name: `${prefix}-evidence` },
  ],
  durable_objects: {
    bindings: [
      {
        name: "EXECUTION_CONTAINERS",
        class_name: "RoundhouseExecutionContainer",
      },
    ],
  },
  migrations: [
    {
      tag: "execution-container-v1",
      new_sqlite_classes: ["RoundhouseExecutionContainer"],
    },
  ],
  containers: [
    {
      name: `${prefix}-execution`,
      class_name: "RoundhouseExecutionContainer",
      image: imageReference,
      max_instances: 1,
      instance_type: "standard-1",
      rollout_step_percentage: 100,
      rollout_active_grace_period: 0,
    },
  ],
  queues: {
    producers: [{ binding: "RUN_QUEUE", queue: `${prefix}-runs` }],
    consumers: [
      {
        queue: `${prefix}-runs`,
        dead_letter_queue: `${prefix}-runs-dlq`,
        max_retries: 3,
        max_batch_size: 1,
        max_batch_timeout: 1,
      },
    ],
  },
};

writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
