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

    it("durably cancels work and closes a running attempt", async () => {
      const store = await createStore();
      const start = new Date("2026-07-12T00:00:00Z");
      const cancelledAt = new Date("2026-07-12T00:00:01Z");
      await store.submit("run_contract_cancel", contractTask, start);
      const claim = await store.claim(
        "run_contract_cancel",
        "worker-a",
        start,
        10_000,
        1,
      );
      await store.startAttempt(
        "run_contract_cancel",
        claim!.token,
        "prepare",
        start,
      );

      const cancelled = await store.cancel("run_contract_cancel", cancelledAt);
      expect(cancelled.state).toBe("cancelled");
      expect(cancelled.lease).toBeUndefined();
      expect(cancelled.attempts[0]).toMatchObject({
        status: "failed",
        retryable: false,
        classification: "cancelled",
      });
      expect(cancelled.events.at(-1)?.type).toBe("run.cancelled");
      expect(
        (await (await createStore()).read("run_contract_cancel")).state,
      ).toBe("cancelled");
    });

    it("preserves evidence across multiple failed attempts", async () => {
      const store = await createStore();
      const start = new Date("2026-07-12T00:00:00Z");
      await store.submit("run_contract_evidence", contractTask, start);
      const evidence = (number: number) => ({
        schemaVersion: 1 as const,
        evidenceId: `evidence-${number}`,
        attemptId: `run_contract_evidence-prepare-${number}`,
        objectKey: `runs/run_contract_evidence/attempts/${number}.json`,
        sha256: String(number).repeat(64),
        size: number,
        mediaType: "application/json" as const,
        createdAt: new Date(start.getTime() + number).toISOString(),
      });

      const first = await store.claim(
        "run_contract_evidence",
        "worker-a",
        start,
        10_000,
        1,
      );
      await store.startAttempt(
        "run_contract_evidence",
        first!.token,
        "prepare",
        start,
      );
      await store.failAttempt(
        "run_contract_evidence",
        first!.token,
        "prepare",
        {
          retryable: true,
          classification: "evidence_test",
          error: "first",
          evidence: [evidence(1)],
        },
        false,
        new Date(start.getTime() + 1),
      );
      await store.release(
        "run_contract_evidence",
        first!.token,
        new Date(start.getTime() + 2),
      );
      const second = await store.claim(
        "run_contract_evidence",
        "worker-b",
        new Date(start.getTime() + 3),
        10_000,
      );
      await store.startAttempt(
        "run_contract_evidence",
        second!.token,
        "prepare",
        new Date(start.getTime() + 3),
      );
      await store.failAttempt(
        "run_contract_evidence",
        second!.token,
        "prepare",
        {
          retryable: false,
          classification: "evidence_test",
          error: "second",
          evidence: [evidence(2)],
        },
        true,
        new Date(start.getTime() + 4),
      );

      expect((await store.read("run_contract_evidence")).evidence).toEqual([
        evidence(1),
        evidence(2),
      ]);
    });

    it("preserves failed-attempt evidence when a later attempt succeeds", async () => {
      const store = await createStore();
      const start = new Date("2026-07-12T00:00:00Z");
      const evidence = (number: number) => ({
        schemaVersion: 1 as const,
        evidenceId: `mixed-evidence-${number}`,
        attemptId: `run_contract_mixed_evidence-prepare-${number}`,
        objectKey: `runs/run_contract_mixed_evidence/attempts/${number}.json`,
        sha256: String(number).repeat(64),
        size: number,
        mediaType: "application/json" as const,
        createdAt: new Date(start.getTime() + number).toISOString(),
      });
      await store.submit("run_contract_mixed_evidence", contractTask, start);
      const first = await store.claim(
        "run_contract_mixed_evidence",
        "worker-a",
        start,
        10_000,
        1,
      );
      await store.startAttempt(
        "run_contract_mixed_evidence",
        first!.token,
        "prepare",
        start,
      );
      await store.failAttempt(
        "run_contract_mixed_evidence",
        first!.token,
        "prepare",
        {
          retryable: true,
          classification: "evidence_test",
          error: "first",
          evidence: [evidence(1)],
        },
        false,
        new Date(start.getTime() + 1),
      );
      await store.release(
        "run_contract_mixed_evidence",
        first!.token,
        new Date(start.getTime() + 2),
      );
      const second = await store.claim(
        "run_contract_mixed_evidence",
        "worker-b",
        new Date(start.getTime() + 3),
        10_000,
      );
      await store.startAttempt(
        "run_contract_mixed_evidence",
        second!.token,
        "prepare",
        new Date(start.getTime() + 3),
      );
      await store.completeAttempt(
        "run_contract_mixed_evidence",
        second!.token,
        "prepare",
        "awaiting_approval",
        {},
        { evidence: [evidence(2)] },
        new Date(start.getTime() + 4),
      );

      expect(
        (await store.read("run_contract_mixed_evidence")).evidence,
      ).toEqual([evidence(1), evidence(2)]);
    });

    it("binds approval and publication to exact durable revisions", async () => {
      const store = await createStore();
      const start = new Date("2026-07-12T00:00:00Z");
      const runId = "run_contract_exact_approval";
      await store.submit(runId, contractTask, start);
      const claim = await store.claim(runId, "worker-a", start, 10_000, 1);
      await store.startAttempt(runId, claim!.token, "prepare", start);
      const evidence = {
        schemaVersion: 1 as const,
        evidenceId: "evidence_exact_approval",
        attemptId: `${runId}-prepare-1`,
        objectKey: `runs/${runId}/attempts/prepare-1/result.json`,
        sha256: "b".repeat(64),
        size: 123,
        mediaType: "application/json" as const,
        createdAt: start.toISOString(),
      };
      const awaiting = await store.completeAttempt(
        runId,
        claim!.token,
        "prepare",
        "awaiting_approval",
        {},
        {
          evidence: [evidence],
          implementation: {
            patchSha256: "c".repeat(64),
            patchBytes: 100,
            changedFiles: ["docs/dogfood/trusted-self-development-loop.md"],
            evidenceId: evidence.evidenceId,
            objectKey: evidence.objectKey,
          },
        },
        new Date(start.getTime() + 1),
      );
      await store.release(runId, claim!.token, new Date(start.getTime() + 2));
      const approval = {
        schemaVersion: 1 as const,
        runId,
        baseCommit: contractTask.baseCommit,
        patchSha256: "c".repeat(64),
        evidence: [
          {
            evidenceId: evidence.evidenceId,
            objectKey: evidence.objectKey,
            sha256: evidence.sha256,
            size: evidence.size,
          },
        ],
        approver: "mark-smith-delegated-trusted-loop-dogfood",
        approvedAt: new Date(start.getTime() + 3).toISOString(),
      };
      await expect(
        store.approve(
          runId,
          { ...approval, patchSha256: "d".repeat(64) },
          awaiting.revision + 1,
          new Date(start.getTime() + 3),
        ),
      ).rejects.toThrow("Approval binding does not match");
      const released = await store.read(runId);
      const approved = await store.approve(
        runId,
        approval,
        released.revision,
        new Date(start.getTime() + 3),
      );
      expect(approved).toMatchObject({
        state: "awaiting_publication",
        approval,
      });
      await expect(
        store.approve(
          runId,
          { ...approval, approver: "different-approver" },
          approved.revision,
          new Date(start.getTime() + 4),
        ),
      ).rejects.toThrow("approval is immutable");
      expect(
        await store.claim(
          runId,
          "worker-b",
          new Date(start.getTime() + 4),
          10_000,
          1,
        ),
      ).toBeNull();
      await expect(
        store.recordPublication(
          runId,
          {
            branch: contractTask.publication.branch,
            commit: "d".repeat(40),
            remoteUrl: contractTask.publication.remoteUrl,
            verifiedAt: new Date(start.getTime() + 4).toISOString(),
          },
          approved.revision - 1,
          new Date(start.getTime() + 4),
        ),
      ).rejects.toThrow("Publication revision does not match");
      for (const publication of [
        {
          branch: "codex/different-branch",
          remoteUrl: contractTask.publication.remoteUrl,
        },
        {
          branch: contractTask.publication.branch,
          remoteUrl: "https://example.test/different.git",
        },
        {
          branch: contractTask.publication.branch,
          remoteUrl: contractTask.publication.remoteUrl,
          pullRequestUrl: "https://github.com/attacker/repository/pull/1",
        },
      ])
        await expect(
          store.recordPublication(
            runId,
            {
              ...publication,
              commit: "d".repeat(40),
              verifiedAt: new Date(start.getTime() + 4).toISOString(),
            },
            approved.revision,
            new Date(start.getTime() + 4),
          ),
        ).rejects.toThrow("Publication target does not match the task");
      const completed = await store.recordPublication(
        runId,
        {
          branch: contractTask.publication.branch,
          commit: "d".repeat(40),
          remoteUrl: contractTask.publication.remoteUrl,
          verifiedAt: new Date(start.getTime() + 4).toISOString(),
        },
        approved.revision,
        new Date(start.getTime() + 4),
      );
      expect(completed).toMatchObject({
        state: "completed",
        commit: "d".repeat(40),
        publication: { branch: contractTask.publication.branch },
      });
    });
  });
}
