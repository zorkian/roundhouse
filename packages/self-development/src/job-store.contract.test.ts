// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileRunStore } from "./run-store.js";
import type { SelfDevelopmentTask } from "./task.js";

const paths: string[] = [];
const task: SelfDevelopmentTask = {
  schemaVersion: 1,
  taskId: "task_contract",
  subject: "Contract test",
  instructions: "Make one bounded change.",
  repositoryPath: "/tmp/repository",
  baseCommit: "a".repeat(40),
  validationLevel: "quick",
  allowedPaths: ["docs/**"],
  publication: {
    remote: "origin",
    remoteUrl: "https://example.invalid/repository.git",
    branch: "roundhouse/output",
    expectedRemoteHead: null,
    commitMessage: "Contract change",
    authorName: "Roundhouse Test",
    authorEmail: "roundhouse@example.invalid",
  },
};

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "roundhouse-job-contract-"));
  paths.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("FileRunStore JobStore contract", () => {
  it("retains submitted work across store reconstruction", async () => {
    const path = await root();
    await new FileRunStore(path).submit(
      "run_contract",
      task,
      new Date("2026-07-12T00:00:00Z"),
    );
    const recovered = await new FileRunStore(path).read("run_contract");
    expect(recovered.state).toBe("created");
    expect(recovered.revision).toBe(1);
  });

  it("grants only one live lease and safely reclaims an expired lease", async () => {
    const path = await root();
    const store = new FileRunStore(path);
    const start = new Date("2026-07-12T00:00:00Z");
    await store.submit("run_contract", task, start);
    const claims = await Promise.all([
      store.claimNext("worker-a", start, 1_000),
      store.claimNext("worker-b", start, 1_000),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find((claim) => claim !== null)!;
    await store.startAttempt("run_contract", first.token, "prepare", start);

    const reclaimed = await new FileRunStore(path).claimNext(
      "worker-c",
      new Date("2026-07-12T00:00:02Z"),
      1_000,
    );
    expect(reclaimed?.run.lease?.workerId).toBe("worker-c");
    expect(reclaimed?.run.attempts[0]).toMatchObject({
      status: "failed",
      retryable: true,
      classification: "lease_expired",
    });
  });
});
