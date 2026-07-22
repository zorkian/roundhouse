// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  createRun,
  MemoryRunRepository,
  type Attempt,
  type RunSnapshot,
  type RunStage,
} from "@roundhouse/core";
import { describe, expect, it, vi } from "vitest";
import {
  acceptCallback,
  callbackPayload,
  signCallback,
  type AttemptCallback,
} from "./callback.js";
import {
  aggregateReviewAttempts,
  attemptInactivityMilliseconds,
  ciTransition,
  coordinate,
  implementationTransition,
  mergeTransition,
  planTransition,
  reviewTransition,
  reproductionTransition,
} from "./coordinator.js";

const input = {
  id: "run_slice",
  repository: "zorkian/roundhouse",
  issueNumber: 1,
  baseCommit: "a".repeat(40),
  profileVersion: "v2",
  profile: {
    sourcePath: ".roundhouse/profile.yaml" as const,
    sourceCommit: "a".repeat(40),
    version: 1 as const,
    hash: "b".repeat(64),
    paths: { allowed: ["**"], protected: [".github/workflows/**"] },
  },
};
const validator = { validate: async () => undefined };

async function callbackFor(
  attempt: Attempt,
  head: string,
  secret: string,
  classification = "bug",
): Promise<AttemptCallback> {
  const unsigned = {
    attemptId: attempt.id,
    expectedRevision: attempt.runRevision,
    checkpoint: {
      repositoryId: "artifact-repo-id",
      repository: attempt.runId,
      baseCommit: attempt.baseCommit,
      inputHead: attempt.expectedHead,
      outputHead: head,
      ref: `refs/heads/roundhouse/${attempt.runId}`,
      changedPaths: attempt.stage === "implement" ? ["src/fix.ts"] : [],
    },
    artifactTokenId: `token-${attempt.id}`,
    result:
      attempt.stage === "reproduce"
        ? {
            outcome: "ok",
            checkpoint: head,
            reproduction: {
              status: "confirmed",
              summary: "Reproduced",
            },
          }
        : attempt.stage === "plan"
          ? {
              outcome: "ok",
              checkpoint: head,
              plan: {
                status: "ready",
                summary: "Small implementation plan",
              },
            }
          : attempt.stage === "implement"
            ? {
                outcome: "ok",
                checkpoint: head,
                implementation: {
                  summary: "Implemented the change",
                  pullRequestTitle: "Fix the behavior",
                  pullRequestBody: "Implements the requested behavior.",
                  validation: [],
                },
              }
            : attempt.stage === "review"
              ? {
                  outcome: "ok",
                  checkpoint: head,
                  review: {
                    status: "clean",
                    summary: "The candidate is correct",
                    findings: [],
                    ...(attempt.role === "review-holistic"
                      ? {
                          selections: [
                            {
                              role: "review-security",
                              applicable: false,
                              rationale: "No security changes",
                            },
                            {
                              role: "review-data",
                              applicable: false,
                              rationale: "No data changes",
                            },
                          ],
                        }
                      : {}),
                  },
                }
              : {
                  outcome: "ok",
                  checkpoint: head,
                  qualification: {
                    classification,
                    summary:
                      classification === "bug"
                        ? "Eligible bug"
                        : "No change needed",
                  },
                },
  };
  return {
    ...unsigned,
    signature: await signCallback(secret, callbackPayload(unsigned)),
  };
}

describe("single coordinator", () => {
  it("fails a holistic review that omits a specialist decision", async () => {
    const store = new MemoryRunRepository();
    const run = {
      ...createRun(input),
      revision: 5,
      stage: "review" as const,
      currentHead: "b".repeat(40),
    };
    await store.create(run);
    store.attempts.set("holistic", {
      id: "holistic",
      runId: input.id,
      runRevision: 5,
      kind: "agent",
      stage: "review",
      role: "review-holistic",
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead: run.currentHead,
      acceptedHead: run.currentHead,
      result: {
        review: {
          status: "clean",
          summary: "Looks good",
          findings: [],
          selections: [
            {
              role: "review-security",
              applicable: false,
              rationale: "No security changes",
            },
          ],
        },
      },
    });

    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 5 },
        100,
      ),
    ).resolves.toBe("dispatched");
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "failed",
      stage: "review",
    });
  });

  it("blocks only findings at a reviewer's configured severities", async () => {
    const store = new MemoryRunRepository();
    const run = {
      ...createRun(input),
      revision: 5,
      stage: "review" as const,
      currentHead: "b".repeat(40),
    };
    await store.create(run);
    const reviewAttempt = (
      id: string,
      role: "review-holistic" | "review-security",
      review: Record<string, unknown>,
    ): Attempt => ({
      id,
      runId: input.id,
      runRevision: 5,
      kind: "agent",
      stage: "review",
      role,
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead: run.currentHead,
      acceptedHead: run.currentHead,
      result: { review },
    });
    store.attempts.set(
      "holistic",
      reviewAttempt("holistic", "review-holistic", {
        status: "clean",
        findings: [],
        selections: [
          {
            role: "review-security",
            applicable: true,
            rationale: "Authorization changed",
          },
          {
            role: "review-data",
            applicable: false,
            rationale: "No data changes",
          },
        ],
      }),
    );
    store.attempts.set(
      "security",
      reviewAttempt("security", "review-security", {
        status: "clean",
        findings: [
          {
            title: "Minor note",
            details: "Non-blocking issue",
            file: "src/auth.ts",
            severity: "low",
          },
          {
            title: "Authorization bypass",
            details: "Missing permission check",
            file: "src/auth.ts",
            severity: "high",
          },
        ],
      }),
    );

    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 5 },
      100,
    );
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "active",
      stage: "implement",
    });
  });

  it("does not aggregate when any required review is for another head", () => {
    const currentHead = "b".repeat(40);
    const staleHead = "c".repeat(40);
    const reviewAttempt = (
      role: "review-holistic" | "review-security",
      expectedHead: string,
      review: Record<string, unknown>,
    ): Attempt => ({
      id: role,
      runId: input.id,
      runRevision: 5,
      kind: "agent",
      stage: "review",
      role,
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead,
      acceptedHead: expectedHead,
      result: { review },
    });
    const holistic = reviewAttempt("review-holistic", staleHead, {
      status: "clean",
      findings: [],
      selections: [
        {
          role: "review-security",
          applicable: true,
          rationale: "Authorization changed",
        },
        {
          role: "review-data",
          applicable: false,
          rationale: "No data changes",
        },
      ],
    });
    const security = reviewAttempt("review-security", currentHead, {
      status: "clean",
      findings: [],
    });

    expect(aggregateReviewAttempts([holistic, security])).toBeUndefined();
  });

  it("claims exactly one revision-bound attempt for duplicate wakeups", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    const submitted: Attempt[] = [];
    const dispatch = {
      submit: async (attempt: Attempt) => {
        submitted.push(attempt);
      },
    };
    await expect(
      coordinate(
        store,
        dispatch,
        { runId: input.id, expectedRevision: 1 },
        100,
      ),
    ).resolves.toBe("dispatched");
    await expect(
      coordinate(
        store,
        dispatch,
        { runId: input.id, expectedRevision: 1 },
        101,
      ),
    ).resolves.toBe("duplicate");
    expect(submitted).toHaveLength(1);
  });

  it("rejects stale wakeups and makes fully signed duplicate callbacks harmless", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 1 },
      100,
    );
    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 2 },
        100,
      ),
    ).resolves.toBe("stale");
    const attempt = await store.getAttempt("run_slice_rev_1");
    if (!attempt) throw new Error("missing_attempt");
    const callback = await callbackFor(
      attempt,
      "b".repeat(40),
      "attempt-specific-secret",
    );
    await expect(
      acceptCallback(store, "attempt-specific-secret", validator, callback),
    ).resolves.toBe("completed");
    await expect(
      acceptCallback(store, "attempt-specific-secret", validator, callback),
    ).resolves.toBe("duplicate");
    await expect(
      acceptCallback(store, "attempt-specific-secret", validator, {
        ...callback,
        result: { outcome: "tampered" },
      }),
    ).resolves.toBe("unauthorized");
  });

  it("recovers callback loss and interruption through lease expiry", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    let dispatches = 0;
    const dispatcher = {
      submit: async () => {
        dispatches += 1;
      },
    };
    await coordinate(
      store,
      dispatcher,
      { runId: input.id, expectedRevision: 1 },
      100,
      50,
    );
    await expect(store.expiredLeases(149)).resolves.toEqual([]);
    await expect(store.expiredLeases(150)).resolves.toEqual([
      { runId: input.id, expectedRevision: 1 },
    ]);
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 1 },
        150,
        50,
      ),
    ).resolves.toBe("dispatched");
    expect(dispatches).toBe(2);
  });

  it("releases a failed dispatch for the existing queue retry", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    let dispatches = 0;
    await expect(
      coordinate(
        store,
        {
          submit: async () => {
            dispatches += 1;
            throw new Error("lost_response");
          },
        },
        { runId: input.id, expectedRevision: 1 },
        100,
      ),
    ).rejects.toThrow("lost_response");
    await expect(store.getAttempt("run_slice_rev_1")).resolves.toMatchObject({
      state: "created",
    });
    await expect(
      coordinate(
        store,
        {
          submit: async () => {
            dispatches += 1;
          },
        },
        { runId: input.id, expectedRevision: 1 },
        101,
      ),
    ).resolves.toBe("dispatched");
    expect(dispatches).toBe(2);
    await expect(store.getAttempt("run_slice_rev_1")).resolves.toMatchObject({
      state: "dispatched",
      deadlineAt: 101 + attemptInactivityMilliseconds,
    });
  });

  it("reports an implementation start only after a durable dispatch", async () => {
    const store = new MemoryRunRepository();
    const run = {
      ...createRun(input),
      revision: 4,
      stage: "implement" as const,
    };
    await store.create(run);
    const order: string[] = [];
    const markDispatched = store.markDispatched.bind(store);
    store.markDispatched = async (attemptId: string) => {
      order.push("markDispatched");
      await markDispatched(attemptId);
    };
    const started: Attempt[] = [];
    await expect(
      coordinate(
        store,
        {
          submit: async () => {
            order.push("submit");
          },
        },
        { runId: input.id, expectedRevision: 4 },
        100,
        50,
        {
          report: async () => undefined,
          reportStarted: async (_run: RunSnapshot, attempt: Attempt) => {
            order.push("reportStarted");
            started.push(attempt);
          },
        },
      ),
    ).resolves.toBe("dispatched");
    expect(order).toEqual(["submit", "markDispatched", "reportStarted"]);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      id: "run_slice_rev_4",
      stage: "implement",
      role: "implement",
    });
  });

  it("does not report a start for earlier-stage dispatches", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    let started = 0;
    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 1 },
        100,
        50,
        {
          report: async () => undefined,
          reportStarted: async () => {
            started += 1;
          },
        },
      ),
    ).resolves.toBe("dispatched");
    expect(started).toBe(0);
  });

  it("does not report a start when implementation submission fails", async () => {
    const store = new MemoryRunRepository();
    const run = {
      ...createRun(input),
      revision: 4,
      stage: "implement" as const,
    };
    await store.create(run);
    let started = 0;
    await expect(
      coordinate(
        store,
        {
          submit: async () => {
            throw new Error("lost_response");
          },
        },
        { runId: input.id, expectedRevision: 4 },
        100,
        50,
        {
          report: async () => undefined,
          reportStarted: async () => {
            started += 1;
          },
        },
      ),
    ).rejects.toThrow("lost_response");
    expect(started).toBe(0);
  });

  it("does not report a start when durable dispatch marking fails", async () => {
    const store = new MemoryRunRepository();
    const run = {
      ...createRun(input),
      revision: 4,
      stage: "implement" as const,
    };
    await store.create(run);
    store.markDispatched = async () => {
      throw new Error("store_unavailable");
    };
    let started = 0;
    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 4 },
        100,
        50,
        {
          report: async () => undefined,
          reportStarted: async () => {
            started += 1;
          },
        },
      ),
    ).rejects.toThrow("store_unavailable");
    expect(started).toBe(0);
  });

  it("revisits the start report on a duplicate wakeup without redispatching", async () => {
    const store = new MemoryRunRepository();
    const run = {
      ...createRun(input),
      revision: 4,
      stage: "implement" as const,
    };
    await store.create(run);
    let started = 0;
    let submitted = 0;
    const dispatcher = {
      submit: async () => {
        submitted += 1;
      },
    };
    const reporter = {
      report: async () => undefined,
      reportStarted: async () => {
        started += 1;
      },
    };
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 4 },
        100,
        50,
        reporter,
      ),
    ).resolves.toBe("dispatched");
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 4 },
        101,
        50,
        reporter,
      ),
    ).resolves.toBe("duplicate");
    // The reporter is invoked again so a previously lost comment can go out;
    // its immutable marker keeps the retry from duplicating the comment.
    expect(started).toBe(2);
    expect(submitted).toBe(1);
  });

  it("keeps a durable dispatch successful when the start report fails", async () => {
    const store = new MemoryRunRepository();
    const run = {
      ...createRun(input),
      revision: 4,
      stage: "implement" as const,
    };
    await store.create(run);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        coordinate(
          store,
          { submit: async () => undefined },
          { runId: input.id, expectedRevision: 4 },
          100,
          50,
          {
            report: async () => undefined,
            reportStarted: async () => {
              throw new Error("github_unavailable");
            },
          },
        ),
      ).resolves.toBe("dispatched");
      expect(log).toHaveBeenCalledWith(
        "report_started_failed",
        expect.any(Error),
      );
    } finally {
      log.mockRestore();
    }
    await expect(store.getAttempt("run_slice_rev_4")).resolves.toMatchObject({
      state: "dispatched",
    });
  });

  it("retries a lost start report on the next wakeup without redispatching", async () => {
    const store = new MemoryRunRepository();
    const run = {
      ...createRun(input),
      revision: 4,
      stage: "implement" as const,
    };
    await store.create(run);
    let submitted = 0;
    const dispatcher = {
      submit: async () => {
        submitted += 1;
      },
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        coordinate(
          store,
          dispatcher,
          { runId: input.id, expectedRevision: 4 },
          100,
          50,
          {
            report: async () => undefined,
            reportStarted: async () => {
              throw new Error("github_unavailable");
            },
          },
        ),
      ).resolves.toBe("dispatched");
    } finally {
      log.mockRestore();
    }
    const started: Attempt[] = [];
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 4 },
        101,
        50,
        {
          report: async () => undefined,
          reportStarted: async (_run: RunSnapshot, attempt: Attempt) => {
            started.push(attempt);
          },
        },
      ),
    ).resolves.toBe("duplicate");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      id: "run_slice_rev_4",
      stage: "implement",
      state: "dispatched",
    });
    expect(submitted).toBe(1);
  });

  it("does not revisit a start report while the dispatch is still in flight", async () => {
    const store = new MemoryRunRepository();
    const run = {
      ...createRun(input),
      revision: 4,
      stage: "implement" as const,
    };
    await store.create(run);
    await store.createAttempt({
      id: "run_slice_rev_4",
      runId: input.id,
      runRevision: 4,
      kind: "agent",
      stage: "implement",
      role: "implement",
      state: "created",
      deadlineAt: 150,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
    });
    await store.claimLease(
      input.id,
      4,
      { attemptId: "run_slice_rev_4", runRevision: 4, expiresAt: 150 },
      100,
    );
    let started = 0;
    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 4 },
        101,
        50,
        {
          report: async () => undefined,
          reportStarted: async () => {
            started += 1;
          },
        },
      ),
    ).resolves.toBe("duplicate");
    expect(started).toBe(0);
  });

  it("reports a holistic review start after dispatch but stays silent for specialists", async () => {
    const store = new MemoryRunRepository();
    const run = {
      ...createRun(input),
      revision: 5,
      stage: "review" as const,
      currentHead: "b".repeat(40),
    };
    await store.create(run);
    const order: string[] = [];
    const markDispatched = store.markDispatched.bind(store);
    store.markDispatched = async (attemptId: string) => {
      order.push("markDispatched");
      await markDispatched(attemptId);
    };
    const started: Attempt[] = [];
    const reporter = {
      report: async () => undefined,
      reportStarted: async (_run: RunSnapshot, attempt: Attempt) => {
        order.push("reportStarted");
        started.push(attempt);
      },
    };
    const dispatcher = {
      submit: async () => {
        order.push("submit");
      },
    };
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 5 },
        100,
        50,
        reporter,
      ),
    ).resolves.toBe("dispatched");
    expect(order).toEqual(["submit", "markDispatched", "reportStarted"]);
    expect(started.map((attempt) => attempt.role)).toEqual(["review-holistic"]);
    const holistic = await store.getAttempt("run_slice_rev_5_review-holistic");
    if (!holistic) throw new Error("missing_attempt");
    store.attempts.set(holistic.id, {
      ...holistic,
      state: "completed",
      acceptedHead: run.currentHead,
      result: {
        review: {
          status: "clean",
          findings: [],
          selections: [
            {
              role: "review-security",
              applicable: true,
              rationale: "Authorization changed",
            },
            {
              role: "review-data",
              applicable: false,
              rationale: "No data changes",
            },
          ],
        },
      },
    });
    order.length = 0;
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 5 },
        200,
        50,
        reporter,
      ),
    ).resolves.toBe("dispatched");
    expect(order).toEqual(["submit", "markDispatched"]);
    expect(started).toHaveLength(1);
    await expect(
      store.getAttempt("run_slice_rev_5_review-security"),
    ).resolves.toMatchObject({ state: "dispatched" });
  });

  it("keeps a durable holistic review dispatch successful when the start report fails", async () => {
    const store = new MemoryRunRepository();
    const run = {
      ...createRun(input),
      revision: 5,
      stage: "review" as const,
      currentHead: "b".repeat(40),
    };
    await store.create(run);
    let submitted = 0;
    const dispatcher = {
      submit: async () => {
        submitted += 1;
      },
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(
        coordinate(
          store,
          dispatcher,
          { runId: input.id, expectedRevision: 5 },
          100,
          50,
          {
            report: async () => undefined,
            reportStarted: async () => {
              throw new Error("review_pull_request_missing");
            },
          },
        ),
      ).resolves.toBe("dispatched");
      expect(log).toHaveBeenCalledWith(
        "report_started_failed",
        expect.any(Error),
      );
    } finally {
      log.mockRestore();
    }
    await expect(
      store.getAttempt("run_slice_rev_5_review-holistic"),
    ).resolves.toMatchObject({ state: "dispatched" });
    // A duplicate wakeup while the review is running revisits the lost start
    // report without redispatching the review attempt.
    const started: Attempt[] = [];
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 5 },
        101,
        50,
        {
          report: async () => undefined,
          reportStarted: async (_run: RunSnapshot, attempt: Attempt) => {
            started.push(attempt);
          },
        },
      ),
    ).resolves.toBe("duplicate");
    expect(started.map((attempt) => attempt.role)).toEqual(["review-holistic"]);
    expect(submitted).toBe(1);
  });

  it("does not revisit a start report for a dispatched specialist review", async () => {
    const store = new MemoryRunRepository();
    const run = {
      ...createRun(input),
      revision: 5,
      stage: "review" as const,
      currentHead: "b".repeat(40),
    };
    await store.create(run);
    store.attempts.set("run_slice_rev_5_review-holistic", {
      id: "run_slice_rev_5_review-holistic",
      runId: input.id,
      runRevision: 5,
      kind: "agent",
      stage: "review",
      role: "review-holistic",
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead: run.currentHead,
      acceptedHead: run.currentHead,
      result: {
        review: {
          status: "clean",
          findings: [],
          selections: [
            {
              role: "review-security",
              applicable: true,
              rationale: "Authorization changed",
            },
            {
              role: "review-data",
              applicable: false,
              rationale: "No data changes",
            },
          ],
        },
      },
    });
    let started = 0;
    const reporter = {
      report: async () => undefined,
      reportStarted: async () => {
        started += 1;
      },
    };
    const dispatcher = { submit: async () => undefined };
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 5 },
        100,
        50,
        reporter,
      ),
    ).resolves.toBe("dispatched");
    await expect(
      store.getAttempt("run_slice_rev_5_review-security"),
    ).resolves.toMatchObject({ state: "dispatched" });
    await expect(
      coordinate(
        store,
        dispatcher,
        { runId: input.id, expectedRevision: 5 },
        101,
        50,
        reporter,
      ),
    ).resolves.toBe("duplicate");
    expect(started).toBe(0);
  });

  it("advances a recorded qualification only through the coordinator", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 1 },
      100,
    );
    const attempt = await store.getAttempt("run_slice_rev_1");
    if (!attempt) throw new Error("missing_attempt");
    const callback = await callbackFor(
      attempt,
      "b".repeat(40),
      "callback-retry-secret",
    );
    await acceptCallback(store, "callback-retry-secret", validator, callback);
    await expect(
      acceptCallback(store, "callback-retry-secret", validator, callback),
    ).resolves.toBe("duplicate");
    await expect(store.get(input.id)).resolves.toMatchObject({
      stage: "qualify",
      revision: 1,
    });
    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 1 },
        200,
      ),
    ).resolves.toBe("dispatched");
    await expect(store.get(input.id)).resolves.toMatchObject({
      stage: "reproduce",
      revision: 2,
    });
  });

  it("requalifies a reopened no-change conclusion on a distinct attempt", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 1 },
      100,
    );
    const first = await store.getAttempt("run_slice_rev_1");
    if (!first) throw new Error("missing_attempt");
    await acceptCallback(
      store,
      "reopen-secret",
      validator,
      await callbackFor(first, input.baseCommit, "reopen-secret", "duplicate"),
    );
    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 1 },
        200,
      ),
    ).resolves.toBe("dispatched");
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "succeeded",
      stage: "qualify",
      revision: 2,
    });

    const reopened = await store.resume(input.id, 2, {
      title: "Report",
      body: "Details",
      url: "https://github.com/zorkian/roundhouse/issues/1",
      actor: "reporter",
      clarifications: [{ actor: "citizen", body: "This is not a duplicate." }],
    });
    if (!reopened) throw new Error("reopen_failed");

    const submitted: Attempt[] = [];
    await expect(
      coordinate(
        store,
        {
          submit: async (attempt) => {
            submitted.push(attempt);
          },
        },
        { runId: input.id, expectedRevision: 3 },
        300,
      ),
    ).resolves.toBe("dispatched");
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      id: "run_slice_rev_3",
      runRevision: 3,
      stage: "qualify",
    });

    // The prior completed attempt remains queryable behind the new revision.
    await expect(store.getAttempt("run_slice_rev_1")).resolves.toMatchObject({
      state: "completed",
    });
    await expect(
      store.latestCompletedAttempt(input.id, "qualify", 3),
    ).resolves.toMatchObject({ id: "run_slice_rev_1", runRevision: 1 });
  });

  it("does not hold workflow progress behind GitHub reporting", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 1 },
      100,
    );
    const attempt = await store.getAttempt("run_slice_rev_1");
    if (!attempt) throw new Error("missing_attempt");
    await acceptCallback(
      store,
      "report-retry-secret",
      validator,
      await callbackFor(attempt, input.baseCommit, "report-retry-secret"),
    );
    await expect(
      coordinate(
        store,
        { submit: async () => undefined },
        { runId: input.id, expectedRevision: 1 },
        200,
        50,
        {
          report: async () => {
            throw new Error("github_response_lost");
          },
        },
      ),
    ).rejects.toThrow("github_response_lost");
    await expect(store.get(input.id)).resolves.toMatchObject({
      stage: "reproduce",
      revision: 2,
    });
  });

  it("maps reproduction evidence to explicit lifecycle outcomes", () => {
    const attempt = {
      id: "run_slice_rev_2",
      runId: input.id,
      runRevision: 2,
      kind: "agent",
      stage: "reproduce",
      role: "reproduce",
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead: input.baseCommit,
    } satisfies Attempt;
    expect(
      reproductionTransition({
        ...attempt,
        result: { reproduction: { status: "confirmed" } },
      }),
    ).toEqual({ status: "active", stage: "plan" });
    expect(
      reproductionTransition({
        ...attempt,
        result: { reproduction: { status: "not_reproduced" } },
      }),
    ).toEqual({
      status: "waiting",
      stage: "reproduce",
      waitingReason: "clarification",
    });
    expect(
      reproductionTransition({
        ...attempt,
        result: { reproduction: { status: "blocked" } },
      }),
    ).toEqual({
      status: "waiting",
      stage: "reproduce",
      waitingReason: "clarification",
    });
  });

  it("maps planning to implementation or another prose clarification", () => {
    const attempt = {
      id: "run_slice_rev_3",
      runId: input.id,
      runRevision: 3,
      kind: "agent",
      stage: "plan",
      role: "plan",
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead: input.baseCommit,
    } satisfies Attempt;
    expect(
      planTransition({
        ...attempt,
        result: { plan: { status: "ready" } },
      }),
    ).toEqual({ status: "active", stage: "implement" });
    expect(
      planTransition({
        ...attempt,
        result: { plan: { status: "needs_clarification" } },
      }),
    ).toEqual({
      status: "waiting",
      stage: "plan",
      waitingReason: "clarification",
    });
  });

  it("reviews the validated implementation checkpoint next", () => {
    const head = "b".repeat(40);
    const attempt = {
      id: "run_slice_rev_4",
      runId: input.id,
      runRevision: 4,
      kind: "agent",
      stage: "implement",
      role: "implement",
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead: input.baseCommit,
      acceptedHead: head,
      result: { implementation: { summary: "Done" } },
    } satisfies Attempt;
    expect(implementationTransition(attempt)).toEqual({
      status: "active",
      stage: "review",
      acceptedHead: head,
    });
  });

  it("advances a clean review to CI and returns findings to implementation", () => {
    const attempt = {
      id: "run_slice_rev_5",
      runId: input.id,
      runRevision: 5,
      kind: "agent",
      stage: "review",
      role: "review",
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead: "b".repeat(40),
    } satisfies Attempt;
    expect(
      reviewTransition({
        ...attempt,
        result: { review: { status: "clean", findings: [] } },
      }),
    ).toEqual({ status: "active", stage: "ci" });
    expect(
      reviewTransition({
        ...attempt,
        result: {
          review: {
            status: "changes_requested",
            findings: [{ title: "Regression" }],
          },
        },
      }),
    ).toEqual({ status: "active", stage: "implement" });
  });

  it("requires exact successful CI before merge", () => {
    const head = "b".repeat(40);
    const attempt = {
      id: "run_slice_rev_6",
      runId: input.id,
      runRevision: 6,
      kind: "external",
      stage: "ci",
      role: "github-checks",
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead: head,
      acceptedHead: head,
      result: { ci: { status: "success", head } },
    } satisfies Attempt;
    expect(ciTransition(attempt)).toEqual({
      status: "active",
      stage: "merge",
      acceptedHead: head,
    });
    expect(
      ciTransition({
        ...attempt,
        result: { ci: { status: "failure", head } },
      }),
    ).toEqual({ status: "active", stage: "implement" });
    expect(
      ciTransition({
        ...attempt,
        result: {
          ci: {
            status: "failure",
            head,
            reason: "diagnostics_unavailable",
            diagnosticsError: "github_get_404",
          },
        },
      }),
    ).toEqual({
      status: "waiting",
      stage: "ci",
      waitingReason: "external_check",
    });
    expect(
      ciTransition({
        ...attempt,
        result: {
          ci: { status: "failure", head, reason: "evidence_consumed" },
        },
      }),
    ).toEqual({
      status: "waiting",
      stage: "ci",
      waitingReason: "external_check",
    });
    expect(
      ciTransition({
        ...attempt,
        result: { ci: { status: "failure", head, reason: "base_conflict" } },
      }),
    ).toEqual({ status: "active", stage: "implement" });
    expect(ciTransition({ ...attempt, acceptedHead: "c".repeat(40) })).toEqual({
      status: "failed",
      stage: "ci",
    });
  });

  it("records the merge commit as the terminal run head", () => {
    const mergeCommit = "c".repeat(40);
    const attempt = {
      id: "run_slice_rev_7",
      runId: input.id,
      runRevision: 7,
      kind: "external",
      stage: "merge",
      role: "github-merge",
      state: "completed",
      deadlineAt: 1_000,
      baseCommit: input.baseCommit,
      expectedHead: "b".repeat(40),
      acceptedHead: mergeCommit,
      result: {
        merge: { status: "merged", head: "b".repeat(40), mergeCommit },
      },
    } satisfies Attempt;
    expect(mergeTransition(attempt)).toEqual({
      status: "succeeded",
      stage: "merge",
      acceptedHead: mergeCommit,
    });
  });

  it("runs qualification through exact-commit review before CI", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    const wakeups = [{ runId: input.id, expectedRevision: 1 }];
    const stages: RunStage[] = [];
    let previousHead = input.baseCommit;
    while (wakeups.length) {
      const wakeup = wakeups.shift();
      if (!wakeup) break;
      let dispatched: Attempt | undefined;
      await coordinate(
        store,
        {
          submit: async (attempt) => {
            dispatched = attempt;
            stages.push(attempt.stage);
          },
        },
        wakeup,
        wakeup.expectedRevision * 100,
      );
      if (!dispatched) throw new Error("attempt_not_dispatched");
      expect(dispatched.expectedHead).toBe(previousHead);
      const outputHead =
        dispatched.stage === "implement" ? "b".repeat(40) : previousHead;
      const callback = await callbackFor(
        dispatched,
        outputHead,
        "journey-secret",
      );
      await acceptCallback(store, "journey-secret", validator, callback);
      await coordinate(store, { submit: async () => undefined }, wakeup, 200);
      previousHead = outputHead;
      const current = await store.get(input.id);
      if (
        current?.status === "active" &&
        new Set(["reproduce", "plan", "implement", "review"]).has(current.stage)
      )
        wakeups.push({ runId: current.id, expectedRevision: current.revision });
    }
    expect(stages).toEqual([
      "qualify",
      "reproduce",
      "plan",
      "implement",
      "review",
    ]);
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "active",
      stage: "ci",
      revision: 6,
      currentHead: previousHead,
    });
  });
});
