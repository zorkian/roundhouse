// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { Attempt, RunSnapshot, WorkflowNode } from "@roundhouse/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  competitionForAttempt,
  DurableAttemptDispatcher,
  judgementCandidateAttempts,
  judgementCandidateEvidence,
  reviewerForAttempt,
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

  it("gives the judge each implementation candidate's distinct change evidence", async () => {
    const head = (marker: string) => marker.repeat(40);
    const candidate = (candidateId: string, acceptedHead: string): Attempt => ({
      ...attempt,
      id: `run_1_rev_2_implement-candidate-${candidateId}`,
      stage: "implement",
      role: `implement-candidate-${candidateId}`,
      state: "completed",
      acceptedHead,
      result: { implementation: { summary: `candidate ${candidateId}` } },
      routing: {
        provider: "openai",
        model: `openai/gpt-${candidateId}`,
        protocol: "openai-responses",
        thinkingLevel: "low",
        rule: `rule-${candidateId}`,
      },
      competition: { purpose: "candidate", candidateId },
    });
    const alpha = candidate("alpha", head("b"));
    const beta = candidate("beta", head("c"));
    const completions = new Map([
      [
        alpha.id,
        {
          checkpoint: {
            inputHead: head("a"),
            outputHead: head("b"),
            changedPaths: ["src/alpha.ts"],
          },
        },
      ],
      [
        beta.id,
        {
          checkpoint: {
            inputHead: head("a"),
            outputHead: head("c"),
            changedPaths: ["src/beta.ts", "test/beta.test.ts"],
          },
        },
      ],
    ]);
    const runs = {
      getAttemptCompletion: async (attemptId: string) =>
        completions.get(attemptId) as never,
    };

    const evidence = await judgementCandidateEvidence(runs, [alpha, beta]);

    expect(evidence).toHaveLength(2);
    expect(evidence.map((entry) => entry.candidateId)).toEqual([
      "alpha",
      "beta",
    ]);
    // Each candidate's validated checkpoint diff evidence is distinct and
    // read-only: its own workspace ref, base/result heads, and changed paths.
    expect(evidence[0]?.change).toEqual({
      ref: `refs/heads/roundhouse/${alpha.id}`,
      baseHead: head("a"),
      head: head("b"),
      changedPaths: ["src/alpha.ts"],
    });
    expect(evidence[1]?.change).toEqual({
      ref: `refs/heads/roundhouse/${beta.id}`,
      baseHead: head("a"),
      head: head("c"),
      changedPaths: ["src/beta.ts", "test/beta.test.ts"],
    });
    expect(evidence[0]?.change.ref).not.toBe(evidence[1]?.change.ref);
    expect(evidence[0]?.change.head).not.toBe(evidence[1]?.change.head);
    expect(evidence.map((entry) => entry.model)).toEqual([
      "openai/gpt-alpha",
      "openai/gpt-beta",
    ]);
  });

  it("gives the judge read-only repository access to each changed candidate's checkpoint", async () => {
    const head = (marker: string) => marker.repeat(40);
    const candidate = (candidateId: string, acceptedHead: string): Attempt => ({
      ...attempt,
      id: `run_1_rev_2_implement-candidate-${candidateId}`,
      stage: "implement",
      role: `implement-candidate-${candidateId}`,
      state: "completed",
      acceptedHead,
      competition: { purpose: "candidate", candidateId },
    });
    const alpha = candidate("alpha", head("b"));
    // beta changed nothing: base and result heads match.
    const beta = candidate("beta", attempt.expectedHead);
    const completions = new Map([
      [
        alpha.id,
        {
          checkpoint: {
            inputHead: head("a"),
            outputHead: head("b"),
            changedPaths: ["src/alpha.ts"],
          },
        },
      ],
    ]);
    const runs = {
      getAttemptCompletion: async (attemptId: string) =>
        completions.get(attemptId) as never,
    };
    const createToken = vi.fn().mockResolvedValue({
      id: "token-1",
      plaintext: "read-secret",
      access: "read",
      expiresAt: 0,
    });
    const ensure = vi.fn().mockResolvedValue({
      id: "artifacts:ns/run_1_rev_2_implement-candidate-alpha",
      name: alpha.id,
      remote: `https://artifacts.example/git/ns/${alpha.id}.git`,
      hostname: "artifacts.example",
      empty: false,
      createToken,
    });

    const evidence = await judgementCandidateEvidence(runs, [alpha, beta], {
      ensure,
    } as never);

    // Only the changed candidate's own repository is opened, with a
    // short-lived read credential scoped to that repository.
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith(alpha.id);
    expect(createToken).toHaveBeenCalledWith("read", 30 * 60);
    expect(evidence[0]?.change.access).toEqual({
      remote: `https://artifacts.example/git/ns/${alpha.id}.git`,
      hostname: "artifacts.example",
      tokenId: "token-1",
      token: "read-secret",
    });
    expect(evidence[0]?.change.access?.remote).toContain(alpha.id);
    expect(evidence[0]?.change.access?.remote).not.toContain(beta.id);
    // An unchanged candidate needs no credential: there is no diff to read.
    expect(evidence[1]?.change.access).toBeUndefined();
  });

  it("falls back to attempt heads when a candidate completion is missing", async () => {
    const candidate: Attempt = {
      ...attempt,
      id: "run_1_rev_2_implement-candidate-alpha",
      stage: "implement",
      role: "implement-candidate-alpha",
      state: "completed",
      acceptedHead: "b".repeat(40),
      competition: { purpose: "candidate", candidateId: "alpha" },
    };
    const runs = {
      getAttemptCompletion: async () => {
        throw new Error("missing");
      },
    };
    const evidence = await judgementCandidateEvidence(runs, [candidate]);
    expect(evidence[0]?.change).toEqual({
      ref: `refs/heads/roundhouse/${candidate.id}`,
      baseHead: candidate.expectedHead,
      head: "b".repeat(40),
      changedPaths: [],
    });
  });

  it("resolves the base reviewer for competition candidates", () => {
    const node = {
      executor: "review",
      role: "review",
      capabilities: ["repository.read", "context.read"],
      review: {
        reviewers: [
          {
            id: "review-holistic",
            model: { id: "openai/gpt-holistic", reasoning: "low" },
            prompt: "Select the applicable specialists.",
            selects: ["review-security"],
            competition: {
              candidates: [
                {
                  id: "alpha",
                  model: { id: "openai/gpt-alpha", reasoning: "low" },
                },
                {
                  id: "beta",
                  model: { id: "anthropic/claude-beta", reasoning: "medium" },
                },
              ],
              judge: { model: { id: "openai/gpt-judge", reasoning: "high" } },
            },
          },
        ],
      },
    } as unknown as WorkflowNode;
    const candidate: Attempt = {
      ...attempt,
      id: "run_1_rev_2_review-holistic-candidate-alpha",
      stage: "review",
      role: "review-holistic-candidate-alpha",
      competition: { purpose: "candidate", candidateId: "alpha" },
    };
    // A competing candidate keeps the configured reviewer's prompt,
    // selection contract, and selectedBy instead of falling back to the
    // generic review prompt.
    const resolved = reviewerForAttempt(node, candidate);
    expect(resolved.reviewer).toMatchObject({
      id: "review-holistic",
      prompt: "Select the applicable specialists.",
      selects: ["review-security"],
    });
    expect(resolved.selectedBy).toBe("review-holistic");
    // The judge keeps its own task rather than inheriting reviewer metadata.
    const judge: Attempt = {
      ...candidate,
      id: "run_1_rev_2_review-holistic-judge",
      role: "review-holistic-judge",
      competition: { purpose: "judge" },
    };
    expect(reviewerForAttempt(node, judge).reviewer).toBeUndefined();
    // Non-competition attempts are unaffected.
    const plain: Attempt = {
      ...attempt,
      stage: "review",
      role: "review-security",
    };
    expect(reviewerForAttempt(node, plain).reviewer).toMatchObject({
      role: "review-security",
    });
  });

  it("resolves the exact reviewer for prefix-sharing reviewer IDs", () => {
    const competition = (suffix: string) => ({
      candidates: [
        {
          id: "alpha",
          model: { id: `openai/gpt-${suffix}-alpha`, reasoning: "low" },
        },
      ],
      judge: { model: { id: `openai/gpt-${suffix}-judge`, reasoning: "high" } },
    });
    const node = {
      executor: "review",
      role: "review",
      capabilities: ["repository.read", "context.read"],
      review: {
        reviewers: [
          {
            id: "review",
            model: { id: "openai/gpt-review", reasoning: "low" },
            competition: competition("review"),
          },
          {
            id: "review-api",
            model: { id: "openai/gpt-review-api", reasoning: "low" },
            competition: competition("review-api"),
          },
        ],
      },
    } as unknown as WorkflowNode;
    // A candidate or judge derived from `review-api` must resolve the
    // `review-api` competition even though its role also starts with
    // `review-`.
    const candidate: Attempt = {
      ...attempt,
      id: "run_1_rev_2_review-api-candidate-alpha",
      stage: "review",
      role: "review-api-candidate-alpha",
      competition: { purpose: "candidate", candidateId: "alpha" },
    };
    expect(
      competitionForAttempt(node, candidate)?.candidates[0]?.model.id,
    ).toBe("openai/gpt-review-api-alpha");
    const judge: Attempt = {
      ...candidate,
      id: "run_1_rev_2_review-api-judge",
      role: "review-api-judge",
      competition: { purpose: "judge" },
    };
    expect(competitionForAttempt(node, judge)?.judge.model.id).toBe(
      "openai/gpt-review-api-judge",
    );
    // The base reviewer itself is unaffected.
    const base: Attempt = {
      ...attempt,
      stage: "review",
      role: "review-api",
    };
    expect(competitionForAttempt(node, base)?.candidates[0]?.model.id).toBe(
      "openai/gpt-review-api-alpha",
    );
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
