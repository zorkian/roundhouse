// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import type { JobStore } from "./job-ports.js";
import type { SelfDevelopmentTask } from "./task.js";

export const contractTask: SelfDevelopmentTask = {
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

export function jobStoreContract(
  name: string,
  createStore: () => Promise<JobStore>,
): void {
  describe(`${name} JobStore contract`, () => {
    it("retains submitted work across store reconstruction", async () => {
      const store = await createStore();
      await store.submit(
        "run_contract_restart",
        contractTask,
        new Date("2026-07-12T00:00:00Z"),
      );
      const recovered = await createStore();
      expect((await recovered.read("run_contract_restart")).state).toBe(
        "created",
      );
    });

    it("grants one lease and safely reclaims an expired lease", async () => {
      const store = await createStore();
      const start = new Date("2026-07-12T00:00:00Z");
      await store.submit("run_contract_lease", contractTask, start);
      const claims = await Promise.all([
        store.claim("run_contract_lease", "worker-a", start, 1_000, 1),
        store.claim("run_contract_lease", "worker-b", start, 1_000, 1),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const first = claims.find(Boolean)!;
      await store.startAttempt(
        "run_contract_lease",
        first.token,
        "prepare",
        start,
      );
      const reclaimed = await (
        await createStore()
      ).claim(
        "run_contract_lease",
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

    it("persists validated renew and release mutations", async () => {
      const store = await createStore();
      const submittedAt = new Date("2026-07-12T00:00:00Z");
      const claimedAt = new Date("2026-07-12T00:00:01Z");
      const renewedAt = new Date("2026-07-12T00:00:02Z");
      const releasedAt = new Date("2026-07-12T00:00:03Z");
      await store.submit("run_contract_renew", contractTask, submittedAt);
      const claim = await store.claim(
        "run_contract_renew",
        "worker-a",
        claimedAt,
        10_000,
        1,
      );
      await expect(
        store.renew("run_contract_renew", claim!.token, renewedAt, 0),
      ).rejects.toThrow("Lease duration must be a positive integer");
      await store.renew("run_contract_renew", claim!.token, renewedAt, 10_000);
      expect((await store.read("run_contract_renew")).updatedAt).toBe(
        renewedAt.toISOString(),
      );
      await store.release("run_contract_renew", claim!.token, releasedAt);
      const released = await (await createStore()).read("run_contract_renew");
      expect(released.updatedAt).toBe(releasedAt.toISOString());
      expect(released.lease).toBeUndefined();
    });
  });
}
