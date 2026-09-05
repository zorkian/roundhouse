// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  productionConfigs,
  renderProductionConfigs,
} from "./render-production-config.mjs";

const run = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputName = "wrangler.production.check.jsonc";
const scratch = await mkdtemp(join(tmpdir(), "roundhouse-production-config-"));
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
} finally {
  await Promise.all(
    renderedConfigs.map((path) => unlink(path).catch(() => undefined)),
  );
  await rm(scratch, { force: true, recursive: true });
}
