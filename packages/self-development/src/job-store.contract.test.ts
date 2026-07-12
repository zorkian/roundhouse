// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
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

  it("reclaims a stale local mutex left by a crashed process", async () => {
    const path = await root();
    const store = new FileRunStore(path);
    const now = new Date("2026-07-12T00:01:00Z");
    await store.submit("run_contract", task, new Date("2026-07-12T00:00:00Z"));
    const mutex = join(path, "runs", "run_contract", ".mutex");
    await mkdir(mutex);
    const stale = new Date(Date.now() - 60_000);
    await utimes(mutex, stale, stale);

    const claim = await store.claimNext("worker-recovery", now, 1_000);
    expect(claim?.run.lease?.workerId).toBe("worker-recovery");
  });

  it("validates renewals and timestamps claim, renew, and release mutations", async () => {
    const path = await root();
    const store = new FileRunStore(path);
    const submittedAt = new Date("2026-07-12T00:00:00Z");
    const claimedAt = new Date("2026-07-12T00:00:01Z");
    const renewedAt = new Date("2026-07-12T00:00:02Z");
    const releasedAt = new Date("2026-07-12T00:00:03Z");
    await store.submit("run_contract", task, submittedAt);
    const claim = await store.claimNext("worker-a", claimedAt, 10_000);
    expect(claim?.run.updatedAt).toBe(claimedAt.toISOString());
    await expect(
      store.renew("run_contract", claim!.token, renewedAt, 0),
    ).rejects.toThrow("Lease duration must be a positive integer");
    await store.renew("run_contract", claim!.token, renewedAt, 10_000);
    expect((await store.read("run_contract")).updatedAt).toBe(
      renewedAt.toISOString(),
    );
    await store.release("run_contract", claim!.token, releasedAt);
    const released = await store.read("run_contract");
    expect(released.updatedAt).toBe(releasedAt.toISOString());
    expect(released.lease).toBeUndefined();
  });
});
