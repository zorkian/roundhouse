// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Clock, JobStageExecutor, StageResult } from "./job-ports.js";
import { ResumableCoordinator, StageFailure } from "./resumable-coordinator.js";
import { FileRunStore } from "./run-store.js";
import type { JobStage, SelfDevelopmentTask } from "./task.js";

const paths: string[] = [];
const task: SelfDevelopmentTask = {
  schemaVersion: 1,
  taskId: "task_worker",
  subject: "Worker test",
  instructions: "Make one bounded change.",
  repositoryPath: "/tmp/repository",
  baseCommit: "b".repeat(40),
  validationLevel: "quick",
  allowedPaths: ["docs/**"],
  publication: {
    remote: "origin",
    remoteUrl: "https://example.invalid/repository.git",
    branch: "roundhouse/output",
    expectedRemoteHead: null,
    commitMessage: "Worker change",
    authorName: "Roundhouse Test",
    authorEmail: "roundhouse@example.invalid",
  },
};

class MutableClock implements Clock {
  constructor(public value: Date) {}
  now(): Date {
    return this.value;
  }
}

class RecordingExecutor implements JobStageExecutor {
  readonly stages: JobStage[] = [];
  failures = 0;
  constructor(private readonly failFirstPrepare = true) {}
  async execute(stage: JobStage): Promise<StageResult> {
    this.stages.push(stage);
    if (stage === "prepare" && this.failFirstPrepare && this.failures++ === 0)
      throw new StageFailure("temporary", "infrastructure", true);
    const states = {
      prepare: "workspace_ready",
      implement: "validating",
      validate: "awaiting_approval",
      commit: "committed",
      push: "pushed",
      complete: "completed",
    } as const;
    return {
      state: states[stage],
      updates: stage === "prepare" ? { workspaceRef: "workspace:test" } : {},
    };
  }
}

afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("ResumableCoordinator", () => {
  it("renews a long-running stage without changing its logical revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "roundhouse-heartbeat-"));
    paths.push(root);
    const store = new FileRunStore(root);
    const clock = new MutableClock(new Date("2026-07-12T00:00:00Z"));
    const executor: JobStageExecutor = {
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 35));
        return { state: "workspace_ready" };
      },
    };
    const worker = new ResumableCoordinator(store, executor, clock, {
      workerId: "worker-heartbeat",
      leaseMs: 1_000,
      leaseHeartbeatMs: 10,
    });
    await worker.submit("run_heartbeat", task);
    const completed = await worker.workOnce();
    expect(completed?.state).toBe("workspace_ready");
    expect(completed?.revision).toBe(5);
    expect(completed?.events).toHaveLength(2);
  });

  it("records bounded retries, stops for approval, and resumes afterward", async () => {
    const root = await mkdtemp(join(tmpdir(), "roundhouse-coordinator-"));
    paths.push(root);
    const store = new FileRunStore(root);
    const clock = new MutableClock(new Date("2026-07-12T00:00:00Z"));
    const executor = new RecordingExecutor();
    const worker = new ResumableCoordinator(store, executor, clock, {
      workerId: "worker-test",
      maxAttemptsPerStage: 3,
    });
    await worker.submit("run_worker", task);
    expect((await worker.workOnce())?.state).toBe("created");
    expect((await worker.workOnce())?.state).toBe("workspace_ready");
    expect((await worker.workOnce())?.state).toBe("validating");
    expect((await worker.workOnce())?.state).toBe("awaiting_approval");
    expect(await worker.workOnce()).toBeNull();

    await store.transition("run_worker", "approved", "approval.recorded");
    expect((await worker.workOnce())?.state).toBe("committed");
    expect((await worker.workOnce())?.state).toBe("pushed");
    expect((await worker.workOnce())?.state).toBe("completed");
    const run = await store.read("run_worker");
    expect(
      run.attempts.filter((attempt) => attempt.stage === "prepare"),
    ).toHaveLength(2);
    expect(run.attempts[0]).toMatchObject({
      status: "failed",
      classification: "infrastructure",
    });
  });

  it("keeps deploy interruptions outside the normal retry budget while bounding recovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "roundhouse-deploy-retry-"));
    paths.push(root);
    const store = new FileRunStore(root);
    const clock = new MutableClock(new Date("2026-07-12T00:00:00Z"));
    let executions = 0;
    const executor: JobStageExecutor = {
      async execute() {
        executions += 1;
        if (executions <= 3)
          throw new StageFailure(
            "Durable Object reset because its code was updated",
            "container_interrupted",
            true,
          );
        return { state: "workspace_ready" };
      },
    };
    const worker = new ResumableCoordinator(store, executor, clock, {
      workerId: "worker-deploy-retry",
      maxAttemptsPerStage: 3,
      maxDeployInterruptionsPerStage: 4,
    });
    await worker.submit("run_deploy_retry", task);

    expect((await worker.workOnce())?.state).toBe("created");
    expect((await worker.workOnce())?.state).toBe("created");
    expect((await worker.workOnce())?.state).toBe("created");
    expect((await worker.workOnce())?.state).toBe("workspace_ready");

    const boundedExecutor: JobStageExecutor = {
      async execute() {
        throw new StageFailure(
          "code updated again",
          "container_interrupted",
          true,
        );
      },
    };
    const bounded = new ResumableCoordinator(store, boundedExecutor, clock, {
      workerId: "worker-deploy-bound",
      maxDeployInterruptionsPerStage: 2,
    });
    await bounded.submit("run_deploy_bound", task);
    expect((await bounded.workRun("run_deploy_bound"))?.state).toBe("created");
    expect((await bounded.workRun("run_deploy_bound"))?.state).toBe("failed");
  });

  it("automatically repairs trusted validation failures on the model-backed prepare stage", async () => {
    const root = await mkdtemp(join(tmpdir(), "roundhouse-validation-repair-"));
    paths.push(root);
    const store = new FileRunStore(root);
    const clock = new MutableClock(new Date("2026-07-12T00:00:00Z"));
    let implementations = 0;
    const executor: JobStageExecutor = {
      async execute(stage) {
        if (stage === "prepare" && implementations++ === 0)
          throw new StageFailure(
            "typecheck: stale test expectation",
            "validation_failed",
            false,
          );
        return { state: "awaiting_approval" };
      },
    };
    const worker = new ResumableCoordinator(store, executor, clock, {
      workerId: "worker-validation-repair",
      maxAttemptsPerStage: 3,
    });
    await worker.submit("run_validation_repair", task);

    const repairing = await worker.workOnce();
    expect(repairing?.state).toBe("created");
    expect(repairing?.attempts.at(-1)).toMatchObject({
      classification: "validation_failed",
      retryable: false,
      automaticRepair: true,
    });
    expect((await worker.workOnce())?.state).toBe("awaiting_approval");
    expect(implementations).toBe(2);
  });

  it("allows one clean reconstruction for an implementation binding mismatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "roundhouse-binding-repair-"));
    paths.push(root);
    const store = new FileRunStore(root);
    const clock = new MutableClock(new Date("2026-07-12T00:00:00Z"));
    const executor: JobStageExecutor = {
      async execute(stage) {
        expect(stage).toBe("prepare");
        throw new StageFailure(
          "Trusted implementation result did not match its immutable request",
          "implementation_binding_mismatch",
          false,
        );
      },
    };
    const worker = new ResumableCoordinator(store, executor, clock, {
      workerId: "worker-binding-repair",
      maxAttemptsPerStage: 3,
    });
    await worker.submit("run_binding_repair", task);

    expect((await worker.workOnce())?.state).toBe("created");
    const exhausted = await worker.workOnce();
    expect(exhausted?.state).toBe("failed");
    expect(
      exhausted?.attempts.filter((attempt) => attempt.stage === "prepare"),
    ).toHaveLength(2);
    expect(exhausted?.attempts.at(-1)).toMatchObject({
      classification: "implementation_binding_mismatch",
      retryable: false,
      error:
        "Trusted implementation result did not match its immutable request",
    });
  });

  it("starts a clean binding repair after consecutive validation repairs", async () => {
    const root = await mkdtemp(join(tmpdir(), "roundhouse-mixed-repair-"));
    paths.push(root);
    const store = new FileRunStore(root);
    const clock = new MutableClock(new Date("2026-07-12T00:00:00Z"));
    let executions = 0;
    const executor: JobStageExecutor = {
      async execute() {
        executions += 1;
        if (executions <= 2)
          throw new StageFailure(
            `validation repair ${executions}`,
            "validation_failed",
            false,
          );
        if (executions === 3)
          throw new StageFailure(
            "Trusted implementation result did not match its immutable request (bindings: retry_lineage)",
            "implementation_binding_mismatch",
            false,
          );
        return { state: "awaiting_approval" };
      },
    };
    const worker = new ResumableCoordinator(store, executor, clock, {
      workerId: "worker-mixed-repair",
      maxAttemptsPerStage: 3,
    });
    await worker.submit("run_mixed_repair", task);

    expect((await worker.workOnce())?.state).toBe("created");
    expect((await worker.workOnce())?.state).toBe("created");
    const repairing = await worker.workOnce();
    expect(repairing?.state).toBe("created");
    expect(repairing?.attempts.at(-1)).toMatchObject({
      classification: "implementation_binding_mismatch",
      automaticRepair: true,
    });
    expect((await worker.workOnce())?.state).toBe("awaiting_approval");
    expect(executions).toBe(4);
  });

  it.each([
    ["prepare", 0],
    ["implement", 1],
    ["validate", 2],
    ["commit", 3],
    ["push", 4],
    ["complete", 5],
  ] as const)(
    "recovers an expired worker during %s without losing history",
    async (stage, steps) => {
      const root = await mkdtemp(
        join(tmpdir(), `roundhouse-recovery-${stage}-`),
      );
      paths.push(root);
      const store = new FileRunStore(root);
      const clock = new MutableClock(new Date("2026-07-12T00:00:00Z"));
      const executor = new RecordingExecutor(false);
      const worker = new ResumableCoordinator(store, executor, clock, {
        workerId: "worker-initial",
        leaseMs: 1_000,
      });
      await worker.submit(`run_${stage}`, task);
      for (let index = 0; index < steps; index += 1) {
        if (stage === "commit" && index === 3)
          await store.transition(
            `run_${stage}`,
            "approved",
            "approval.recorded",
          );
        if (stage === "push" && index === 3)
          await store.transition(
            `run_${stage}`,
            "approved",
            "approval.recorded",
          );
        if (stage === "complete" && index === 3)
          await store.transition(
            `run_${stage}`,
            "approved",
            "approval.recorded",
          );
        await worker.workOnce();
      }
      if (stage === "commit")
        await store.transition(`run_${stage}`, "approved", "approval.recorded");
      const claim = await store.claimNext("worker-crashed", clock.now(), 1_000);
      expect(claim).not.toBeNull();
      await store.startAttempt(
        `run_${stage}`,
        claim!.token,
        stage,
        clock.now(),
      );

      clock.value = new Date("2026-07-12T00:00:02Z");
      const recovered = new ResumableCoordinator(store, executor, clock, {
        workerId: "worker-recovered",
        leaseMs: 1_000,
      });
      await recovered.workOnce();
      const run = await store.read(`run_${stage}`);
      const stageAttempts = run.attempts.filter(
        (attempt) => attempt.stage === stage,
      );
      expect(stageAttempts.at(-2)).toMatchObject({
        status: "failed",
        classification: "lease_expired",
      });
      expect(stageAttempts.at(-1)).toMatchObject({ status: "succeeded" });
    },
  );
});
