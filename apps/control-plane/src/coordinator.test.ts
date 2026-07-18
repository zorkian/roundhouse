// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  createRun,
  MemoryRunRepository,
  type Attempt,
  type RunStage,
} from "@roundhouse/core";
import { describe, expect, it } from "vitest";
import {
  acceptCallback,
  callbackPayload,
  signCallback,
  type AttemptCallback,
} from "./callback.js";
import {
  coordinate,
  implementationTransition,
  planTransition,
  reproductionTransition,
} from "./coordinator.js";

const input = {
  id: "run_slice",
  repository: "zorkian/roundhouse",
  issueNumber: 1,
  baseCommit: "a".repeat(40),
  profileVersion: "v2",
};
const validator = { validate: async () => undefined };

async function callbackFor(
  attempt: Attempt,
  head: string,
  secret: string,
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
            : {
                outcome: "ok",
                checkpoint: head,
                qualification: {
                  classification: "bug",
                  summary: "Eligible bug",
                },
              },
  };
  return {
    ...unsigned,
    signature: await signCallback(secret, callbackPayload(unsigned)),
  };
}

describe("single coordinator", () => {
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

  it("leaves an undispatched attempt recoverable after ambiguous dispatch", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    await expect(
      coordinate(
        store,
        {
          submit: async () => {
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

  it("finishes after a validated implementation checkpoint", () => {
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
      status: "succeeded",
      stage: "implement",
      acceptedHead: head,
    });
  });

  it("runs qualification, reproduction, and planning before implementation", async () => {
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
        new Set(["reproduce", "plan", "implement"]).has(current.stage)
      )
        wakeups.push({ runId: current.id, expectedRevision: current.revision });
    }
    expect(stages).toEqual(["qualify", "reproduce", "plan", "implement"]);
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "succeeded",
      stage: "implement",
      revision: 5,
      currentHead: previousHead,
    });
  });
});
