// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { Attempt, RunSnapshot } from "@roundhouse/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DurableAttemptDispatcher,
  judgementCandidateAttempts,
} from "./attempt-dispatch.js";

const attempt = {
  id: "run_1_rev_2",
  runId: "run_1",
  runRevision: 2,
  kind: "agent",
  stage: "qualify",
  role: "qualification",
  state: "created",
  deadlineAt: 10_000,
  baseCommit: "a".repeat(40),
  expectedHead: "a".repeat(40),
} satisfies Attempt;

const run = {
  id: "run_1",
  repository: "zorkian/roundhouse",
  issueNumber: 426,
  status: "active",
  stage: "qualify",
  revision: 2,
  baseCommit: "a".repeat(40),
  currentHead: "a".repeat(40),
} as RunSnapshot;

describe("durable attempt dispatch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the attempt id as the durable Workflow identity", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const recordAttemptEvent = vi.fn().mockResolvedValue(undefined);
    const status = vi.fn().mockResolvedValue({ status: "queued" });
    const create = vi.fn().mockResolvedValue({ status });
    const get = vi.fn();

    await new DurableAttemptDispatcher(
      { create, get } as never,
      { recordAttemptEvent } as never,
    ).submit(attempt, run);

    expect(create).toHaveBeenCalledWith({
      id: attempt.id,
      params: {
        attemptId: attempt.id,
        sandboxName: attempt.id,
      },
    });
    expect(get).not.toHaveBeenCalled();
    expect(recordAttemptEvent).toHaveBeenCalledWith(
      attempt.id,
      "attempt_workflow",
      expect.objectContaining({
        phase: "attempt_workflow_created",
        workflowInstanceId: attempt.id,
        created: true,
        status: "queued",
      }),
    );
  });

  it("scopes judge evidence to the judge's own competition", () => {
    const candidate = (
      role: string,
      candidateId: string,
      state: Attempt["state"] = "completed",
    ): Attempt => ({
      ...attempt,
      id: `run_1_rev_2_${role}`,
      role,
      state,
      competition: { purpose: "candidate", candidateId },
    });
    const judge: Attempt = {
      ...attempt,
      id: "run_1_rev_2_review-data-judge",
      stage: "review",
      role: "review-data-judge",
      competition: { purpose: "judge" },
    };
    const attempts = [
      candidate("review-data-candidate-alpha", "alpha"),
      candidate("review-data-candidate-beta", "beta"),
      candidate("review-holistic-candidate-alpha", "alpha"),
      candidate("review-holistic-candidate-gamma", "gamma"),
      candidate("review-data-candidate-gamma", "gamma"),
      candidate("review-data-candidate-beta", "beta", "dispatched"),
    ];
    const scoped = judgementCandidateAttempts(attempts, judge, {
      candidates: [
        { id: "alpha", model: { id: "openai/gpt-alpha", reasoning: "low" } },
        {
          id: "beta",
          model: { id: "anthropic/claude-beta", reasoning: "medium" },
        },
      ],
      judge: { model: { id: "openai/gpt-judge", reasoning: "high" } },
    });
    expect(scoped.map((entry) => entry.role)).toEqual([
      "review-data-candidate-alpha",
      "review-data-candidate-beta",
    ]);
  });

  it("resumes when that Workflow instance already exists", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const recordAttemptEvent = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockRejectedValue(new Error("instance exists"));
    const status = vi.fn().mockResolvedValue({ status: "running" });
    const get = vi.fn().mockResolvedValue({ status });

    await expect(
      new DurableAttemptDispatcher(
        { create, get } as never,
        { recordAttemptEvent } as never,
      ).submit(attempt, run),
    ).resolves.toBeUndefined();

    expect(get).toHaveBeenCalledWith(attempt.id);
    expect(recordAttemptEvent).toHaveBeenCalledWith(
      attempt.id,
      "attempt_workflow",
      expect.objectContaining({
        phase: "attempt_workflow_created",
        workflowInstanceId: attempt.id,
        created: false,
        status: "running",
      }),
    );
  });
});
