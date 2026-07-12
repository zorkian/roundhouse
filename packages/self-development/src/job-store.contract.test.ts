// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { contractTask, jobStoreContract } from "./job-store-contract.shared.js";
import { FileRunStore } from "./run-store.js";

const paths: string[] = [];

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "roundhouse-job-contract-"));
  paths.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  contractRoot = undefined;
});

describe("FileRunStore mutex recovery", () => {
  it("reclaims a stale local mutex left by a crashed process", async () => {
    const path = await root();
    const store = new FileRunStore(path);
    const now = new Date("2026-07-12T00:01:00Z");
    await store.submit(
      "run_contract",
      contractTask,
      new Date("2026-07-12T00:00:00Z"),
    );
    const mutex = join(path, "runs", "run_contract", ".mutex");
    await mkdir(mutex);
    const stale = new Date(Date.now() - 60_000);
    await utimes(mutex, stale, stale);

    const claim = await store.claimNext("worker-recovery", now, 1_000);
    expect(claim?.run.lease?.workerId).toBe("worker-recovery");
  });
});

let contractRoot: string | undefined;
jobStoreContract("FileRunStore", async () => {
  contractRoot ??= await root();
  return new FileRunStore(contractRoot);
});
