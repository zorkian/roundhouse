// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordAttemptEvent, sandbox, settleAttemptCompletion } = vi.hoisted(
  () => ({
    sandbox: {
      restorePreparedAttempt: vi.fn(),
      executePreparedAttempt: vi.fn(),
    },
    settleAttemptCompletion: vi.fn(),
    recordAttemptEvent: vi.fn(),
  }),
);

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {},
}));
vi.mock("@cloudflare/sandbox", () => ({
  getSandbox: vi.fn(() => sandbox),
}));
vi.mock("./attempt-settlement.js", () => ({
  settleAttemptCompletion,
}));
vi.mock("./d1-store.js", () => ({
  D1RunRepository: class {
    recordAttemptEvent = recordAttemptEvent;
  },
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
  });

  it("attaches restore, execution, settlement, and cleanup in durable steps", async () => {
    sandbox.restorePreparedAttempt.mockResolvedValue(undefined);
    sandbox.executePreparedAttempt.mockResolvedValue(completion);
    settleAttemptCompletion.mockResolvedValue({
      outcome: "completed",
      attemptId: completion.attemptId,
      sandboxName: "sandbox_1",
    });
    const { destroy, instance } = workflow();
    const { calls, step } = steps();

    await expect(instance.run(event(), step as never)).resolves.toMatchObject({
      outcome: "completed",
    });

    expect(calls.map(({ name }) => name)).toEqual([
      "restore prepared workspace",
      "execute prepared attempt",
      "settle completed attempt",
      "destroy settled attempt sandbox",
    ]);
    expect(calls[1]?.config).toMatchObject({
      timeout: "365 days",
      retries: { limit: 0 },
    });
    expect(settleAttemptCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ ATTEMPT_SANDBOXES: expect.anything() }),
      completion,
    );
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("does not settle or clean up a failed execution", async () => {
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
      "restore prepared workspace",
      "execute prepared attempt",
    ]);
    expect(settleAttemptCompletion).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });
});
