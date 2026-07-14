// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { DispatchingStageExecutor } from "./execution-dispatch.js";
import type { SelfDevelopmentRun } from "./task.js";

describe("DispatchingStageExecutor retry diagnostics", () => {
  it("passes the latest same-stage failure into an explicit retry", async () => {
    let retryContext: string | undefined;
    const executor = new DispatchingStageExecutor({
      dispatch: async (request) => {
        retryContext = request.retryContext;
        return { state: "awaiting_approval" };
      },
    });
    const run = {
      runId: "run_retry_context",
      revision: 8,
      task: {
        taskId: "task_retry_context",
        subject: "Repair validation",
        instructions: "Implement the requested behavior.",
        allowedPaths: ["packages/example.ts"],
        baseCommit: "a".repeat(40),
        validationLevel: "full",
      },
      attempts: [
        {
          attemptId: "run_retry_context-prepare-1",
          stage: "prepare",
          number: 1,
          status: "failed",
          classification: "validation_failed",
          error: "format: packages/example.ts needs formatting",
        },
        {
          attemptId: "run_retry_context-prepare-2",
          stage: "prepare",
          number: 2,
          status: "running",
        },
      ],
    } as SelfDevelopmentRun;

    await executor.execute("prepare", run);

    expect(retryContext).toBe("format: packages/example.ts needs formatting");
  });
});
