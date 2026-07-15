// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const script = fileURLToPath(
  new URL("./render-wrangler-config.mjs", import.meta.url),
);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("release Wrangler configuration", () => {
  it("retains logs and configures bounded parallel graceful rollouts", async () => {
    const root = await mkdtemp(join(tmpdir(), "roundhouse-wrangler-"));
    temporaryDirectories.push(root);
    for (const environment of ["development", "production"]) {
      const output = `.roundhouse/release/wrangler.${environment}.json`;
      await mkdir(dirname(join(root, output)), { recursive: true });
      await execute(
        process.execPath,
        [
          script,
          environment,
          "a0000000-0000-0000-0000-000000000000",
          "b".repeat(64),
          `registry.cloudflare.com/${"c".repeat(32)}/roundhouse-release:${"d".repeat(40)}@sha256:${"e".repeat(64)}`,
          output,
        ],
        { cwd: root },
      );

      const config = JSON.parse(await readFile(join(root, output), "utf8"));
      expect(config.observability).toEqual({
        enabled: true,
        logs: {
          enabled: true,
          head_sampling_rate: 1,
          invocation_logs: true,
          persist: true,
        },
      });
      expect(config.containers).toEqual([
        expect.objectContaining({
          max_instances: 10,
          instance_type: "standard-1",
          rollout_step_percentage: [100],
          rollout_active_grace_period: 2400,
        }),
      ]);
      expect(config.queues.consumers).toEqual([
        expect.objectContaining({
          max_batch_size: 1,
          max_concurrency: 10,
        }),
      ]);
      if (environment === "development")
        expect(config.workflows).toEqual([
          {
            name: "roundhouse-dev-trusted-execution",
            binding: "TRUSTED_EXECUTION_WORKFLOW",
            class_name: "RoundhouseTrustedExecutionWorkflow",
          },
        ]);
      else expect(config.workflows).toBeUndefined();
    }
  });
});
