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
  it("explicitly retains complete Worker and Container logs", async () => {
    const root = await mkdtemp(join(tmpdir(), "roundhouse-wrangler-"));
    temporaryDirectories.push(root);
    const output = ".roundhouse/release/wrangler.development.json";
    await mkdir(dirname(join(root, output)), { recursive: true });
    await execute(
      process.execPath,
      [
        script,
        "development",
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
  });
});
