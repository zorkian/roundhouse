// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  acceptRecordedAttemptCompletion,
  backupRecordedAttemptWorkspace,
  getAttempt,
  loadRecordedAttemptCompletion,
  markDispatched,
  prepareAttemptExecution,
  publishWakeup,
  publishRecordedAttemptCompletion,
  recordAttemptEvent,
  requestWakeup,
  settlementWorkflowCreate,
  settlementWorkflowGet,
  settlementWorkflowStatus,
  sandbox,
  settleAttemptOutcome,
  validateRecordedAttemptCompletion,
} = vi.hoisted(() => ({
  sandbox: {
    restorePreparedAttempt: vi.fn(),
    executePreparedAttempt: vi.fn(),
  },
  acceptRecordedAttemptCompletion: vi.fn(),
  backupRecordedAttemptWorkspace: vi.fn(),
  getAttempt: vi.fn(),
  loadRecordedAttemptCompletion: vi.fn(),
  markDispatched: vi.fn(),
  prepareAttemptExecution: vi.fn(),
  publishWakeup: vi.fn(),
  publishRecordedAttemptCompletion: vi.fn(),
  recordAttemptEvent: vi.fn(),
  requestWakeup: vi.fn(),
  settlementWorkflowCreate: vi.fn(),
  settlementWorkflowGet: vi.fn(),
  settlementWorkflowStatus: vi.fn(),
  settleAttemptOutcome: vi.fn(),
  validateRecordedAttemptCompletion: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {},
}));
vi.mock("@cloudflare/sandbox", () => ({
  getSandbox: vi.fn(() => sandbox),
}));
vi.mock("./attempt-settlement.js", () => ({
  acceptRecordedAttemptCompletion,
  backupRecordedAttemptWorkspace,
  loadRecordedAttemptCompletion,
  publishRecordedAttemptCompletion,
  validateRecordedAttemptCompletion,
}));
vi.mock("./attempt-dispatch.js", () => ({
  prepareAttemptExecution,
}));
vi.mock("./d1-store.js", () => ({
  D1RunRepository: class {
    getAttempt = getAttempt;
    markDispatched = markDispatched;
    recordAttemptEvent = recordAttemptEvent;
    requestWakeup = requestWakeup;
    settleAttemptOutcome = settleAttemptOutcome;
  },
}));
vi.mock("./liveness.js", () => ({
  publishWakeup,
}));

import type { AttemptCompletion } from "./callback.js";
import { AttemptExecutionWorkflow } from "./attempt-workflow.js";

const completion: AttemptCompletion = {
  attemptId: "attempt_1",
  expectedRevision: 4,
  checkpoint: {
    repositoryId: "repository-id",
    repository: "run_1",
    baseCommit: "a".repeat(40),
    inputHead: "a".repeat(40),
    outputHead: "b".repeat(40),
    ref: "refs/heads/roundhouse/run_1",
    changedPaths: ["src/fix.ts"],
  },
  artifactTokenId: "token-id",
  result: { outcome: "ok" },
};

function workflow() {
  const destroy = vi.fn();
  const instance = Object.create(
    AttemptExecutionWorkflow.prototype,
  ) as AttemptExecutionWorkflow;
  Object.assign(instance, {
    env: {
      DB: {},
      ATTEMPT_SANDBOXES: {
        idFromName: (name: string) => name,
        get: () => ({ destroy }),
      },
      RUN_WAKEUPS: { send: vi.fn() },
      ATTEMPT_EXECUTIONS: {
        create: settlementWorkflowCreate,
        get: settlementWorkflowGet,
      },
    },
  });
  return { destroy, instance };
}

function event() {
  return {
    instanceId: "workflow_1",
    payload: {
      attemptId: "attempt_1",
      sandboxName: "sandbox_1",
    },
    timestamp: new Date(10_000),
    workflowName: "attempt-execution",
  } as never;
}

function steps() {
  const calls: Array<{ name: string; config?: Record<string, unknown> }> = [];
  return {
    calls,
    step: {
      async do(
        name: string,
        configOrCallback: Record<string, unknown> | (() => Promise<unknown>),
        possibleCallback?: () => Promise<unknown>,
      ) {
        const callback =
          typeof configOrCallback === "function"
            ? configOrCallback
            : possibleCallback!;
        calls.push({
          name,
          ...(typeof configOrCallback === "function"
            ? {}
            : { config: configOrCallback }),
        });
        return callback();
      },
    },
  };
}

describe("attempt execution Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAttempt.mockResolvedValue({
      id: completion.attemptId,
      runId: "run_1",
      runRevision: completion.expectedRevision,
      state: "created",
    });
    markDispatched.mockResolvedValue(undefined);
    prepareAttemptExecution.mockResolvedValue(undefined);
    loadRecordedAttemptCompletion.mockResolvedValue(completion);
    validateRecordedAttemptCompletion.mockResolvedValue({
      outcome: "validated",
      attemptId: completion.attemptId,
      sandboxName: "sandbox_1",
    });
    backupRecordedAttemptWorkspace.mockResolvedValue({
      outcome: "completed",
      attemptId: completion.attemptId,
      backupId: "backup_1",
    });
    publishRecordedAttemptCompletion.mockResolvedValue({
      outcome: "published",
      attemptId: completion.attemptId,
      sandboxName: "sandbox_1",
    });
    acceptRecordedAttemptCompletion.mockResolvedValue({
      outcome: "completed",
      attemptId: completion.attemptId,
      sandboxName: "sandbox_1",
    });
    recordAttemptEvent.mockResolvedValue(undefined);
    settleAttemptOutcome.mockResolvedValue("failed");
    publishWakeup.mockResolvedValue(undefined);
    settlementWorkflowStatus.mockResolvedValue({ status: "queued" });
    settlementWorkflowCreate.mockResolvedValue({
      status: settlementWorkflowStatus,
    });
    settlementWorkflowGet.mockResolvedValue({
      status: settlementWorkflowStatus,
    });
  });

  it("attaches restore, execution, settlement, and cleanup in durable steps", async () => {
    sandbox.restorePreparedAttempt.mockResolvedValue(undefined);
    sandbox.executePreparedAttempt.mockResolvedValue(completion);
    const { destroy, instance } = workflow();
    const { calls, step } = steps();

    await expect(instance.run(event(), step as never)).resolves.toMatchObject({
      outcome: "completed",
    });

    expect(calls.map(({ name }) => name)).toEqual([
      "confirm durable dispatch",
      "prepare attempt",
      "restore prepared workspace",
      "execute prepared attempt",
      "load recorded execution",
      "validate completed attempt",
      "backup completed workspace",
      "publish completed attempt",
      "accept completed attempt",
      "destroy settled attempt sandbox",
    ]);
    expect(calls[3]?.config).toMatchObject({
      timeout: "365 days",
      retries: { limit: 0 },
    });
    expect(markDispatched).toHaveBeenCalledWith(completion.attemptId);
    expect(prepareAttemptExecution).toHaveBeenCalledWith(
      expect.objectContaining({ ATTEMPT_SANDBOXES: expect.anything() }),
      completion.attemptId,
    );
    expect(loadRecordedAttemptCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ ATTEMPT_SANDBOXES: expect.anything() }),
      completion.attemptId,
    );
    expect(validateRecordedAttemptCompletion).toHaveBeenCalledWith(
      expect.anything(),
      completion,
    );
    expect(publishRecordedAttemptCompletion).toHaveBeenCalledWith(
      expect.anything(),
      completion,
    );
    expect(acceptRecordedAttemptCompletion).toHaveBeenCalledWith(
      expect.anything(),
      completion,
    );
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("records a failed one-off execution and destroys its sandbox", async () => {
    sandbox.restorePreparedAttempt.mockResolvedValue(undefined);
    sandbox.executePreparedAttempt.mockRejectedValue(
      new Error("runner_connection_lost"),
    );
    const { destroy, instance } = workflow();
    const { calls, step } = steps();

    await expect(instance.run(event(), step as never)).rejects.toThrow(
      "runner_connection_lost",
    );

    expect(calls.map(({ name }) => name)).toEqual([
      "confirm durable dispatch",
      "prepare attempt",
      "restore prepared workspace",
      "execute prepared attempt",
    ]);
    expect(loadRecordedAttemptCompletion).not.toHaveBeenCalled();
    expect(validateRecordedAttemptCompletion).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
    expect(settleAttemptOutcome).toHaveBeenCalledWith(
      completion.attemptId,
      completion.expectedRevision,
      "failed",
      {
        kind: "execution_interrupted",
        source: "attempt_workflow",
      },
    );
    expect(publishWakeup).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        runId: "run_1",
        expectedRevision: completion.expectedRevision,
      },
    );
  });

  it("preserves a failed implementation sandbox for a resumable workspace", async () => {
    getAttempt.mockResolvedValue({
      id: completion.attemptId,
      runId: "run_1",
      runRevision: completion.expectedRevision,
      stage: "implement",
      state: "created",
    });
    sandbox.restorePreparedAttempt.mockResolvedValue(undefined);
    sandbox.executePreparedAttempt.mockRejectedValue(
      new Error("runner_connection_lost"),
    );
    const { destroy, instance } = workflow();
    const { step } = steps();
    const implementationEvent = {
      instanceId: "workflow_1",
      payload: {
        attemptId: "attempt_1",
        sandboxName: "run_1",
      },
      timestamp: new Date(10_000),
      workflowName: "attempt-execution",
    } as never;

    await expect(
      instance.run(implementationEvent, step as never),
    ).rejects.toThrow("runner_connection_lost");

    expect(settleAttemptOutcome).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();
    expect(publishWakeup).toHaveBeenCalledOnce();
  });

  it("immediately resumes a runner-recorded completion when its workflow is interrupted", async () => {
    getAttempt.mockResolvedValue({
      id: completion.attemptId,
      runId: "run_1",
      runRevision: completion.expectedRevision,
      state: "executed",
    });
    sandbox.restorePreparedAttempt.mockResolvedValue(undefined);
    sandbox.executePreparedAttempt.mockRejectedValue(
      new Error("durable_object_reset"),
    );
    const { instance } = workflow();
    const { step } = steps();

    await expect(instance.run(event(), step as never)).rejects.toThrow(
      "durable_object_reset",
    );

    expect(settleAttemptOutcome).not.toHaveBeenCalled();
    expect(settlementWorkflowCreate).toHaveBeenCalledWith({
      id: "workflow_1-settlement",
      params: {
        attemptId: completion.attemptId,
        sandboxName: "sandbox_1",
        mode: "settle",
      },
    });
    expect(recordAttemptEvent).toHaveBeenCalledWith(
      completion.attemptId,
      "attempt_settlement_resumed",
      expect.objectContaining({
        phase: "settlement_resumed_after_workflow_failure",
        failedWorkflowInstanceId: "workflow_1",
        workflowInstanceId: "workflow_1-settlement",
        created: true,
        status: "queued",
      }),
    );
    expect(requestWakeup).toHaveBeenCalledWith({
      runId: "run_1",
      expectedRevision: completion.expectedRevision,
    });
    expect(publishWakeup).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        runId: "run_1",
        expectedRevision: completion.expectedRevision,
      },
    );
  });

  it("does not duplicate an already-created settlement recovery workflow", async () => {
    getAttempt.mockResolvedValue({
      id: completion.attemptId,
      runId: "run_1",
      runRevision: completion.expectedRevision,
      state: "executed",
    });
    sandbox.restorePreparedAttempt.mockResolvedValue(undefined);
    sandbox.executePreparedAttempt.mockRejectedValue(
      new Error("durable_object_reset"),
    );
    settlementWorkflowCreate.mockRejectedValue(
      new Error("workflow_instance_already_exists"),
    );
    settlementWorkflowStatus.mockResolvedValue({ status: "running" });
    const { instance } = workflow();
    const { step } = steps();

    await expect(instance.run(event(), step as never)).rejects.toThrow(
      "durable_object_reset",
    );

    expect(settlementWorkflowGet).toHaveBeenCalledWith("workflow_1-settlement");
    expect(recordAttemptEvent).toHaveBeenCalledWith(
      completion.attemptId,
      "attempt_settlement_resumed",
      expect.objectContaining({ created: false, status: "running" }),
    );
  });

  it("resumes settlement from D1 without restoring or executing the agent", async () => {
    loadRecordedAttemptCompletion.mockResolvedValue(completion);
    const { destroy, instance } = workflow();
    const { calls, step } = steps();
    const recoveryEvent = {
      instanceId: "workflow_2",
      payload: {
        attemptId: "attempt_1",
        sandboxName: "sandbox_1",
        mode: "settle",
      },
      timestamp: new Date(10_000),
      workflowName: "attempt-execution",
    } as never;

    await expect(
      instance.run(recoveryEvent, step as never),
    ).resolves.toMatchObject({ outcome: "completed" });

    expect(calls.map(({ name }) => name)).toEqual([
      "load recorded execution",
      "validate completed attempt",
      "backup completed workspace",
      "publish completed attempt",
      "accept completed attempt",
      "destroy settled attempt sandbox",
    ]);
    expect(sandbox.restorePreparedAttempt).not.toHaveBeenCalled();
    expect(sandbox.executePreparedAttempt).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("accepts a valid checkpoint when workspace backup is unavailable", async () => {
    sandbox.restorePreparedAttempt.mockResolvedValue(undefined);
    sandbox.executePreparedAttempt.mockResolvedValue(completion);
    backupRecordedAttemptWorkspace.mockResolvedValue({
      outcome: "unavailable",
      attemptId: completion.attemptId,
      error: "backup connection closed",
    });
    const { instance } = workflow();
    const { step } = steps();

    await expect(instance.run(event(), step as never)).resolves.toMatchObject({
      outcome: "completed",
    });

    expect(publishRecordedAttemptCompletion).toHaveBeenCalledOnce();
    expect(acceptRecordedAttemptCompletion).toHaveBeenCalledOnce();
  });
});
