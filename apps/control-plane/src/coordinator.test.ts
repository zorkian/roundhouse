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
  acceptCallbackAndAdvance,
  callbackPayload,
  signCallback,
} from "./callback.js";
import { coordinate } from "./coordinator.js";

const input = {
  id: "run_slice",
  repository: "zorkian/roundhouse",
  issueNumber: 1,
  baseCommit: "a".repeat(40),
  profileVersion: "v2",
};

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

  it("rejects stale wakeups and makes signed duplicate callbacks harmless", async () => {
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
    const attemptId = "run_slice_rev_1",
      head = "b".repeat(40),
      secret = "attempt-specific-secret";
    const signature = await signCallback(
      secret,
      callbackPayload(attemptId, 1, head),
    );
    const callback = {
      attemptId,
      expectedRevision: 1,
      acceptedHead: head,
      result: { outcome: "ok" },
      signature,
    };
    await expect(acceptCallback(store, secret, callback)).resolves.toBe(
      "completed",
    );
    await expect(acceptCallback(store, secret, callback)).resolves.toBe(
      "duplicate",
    );
    await expect(
      acceptCallback(store, secret, { ...callback, signature: "00" }),
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

  it("re-enqueues progress when a successful callback response was lost", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    await coordinate(
      store,
      { submit: async () => undefined },
      { runId: input.id, expectedRevision: 1 },
      100,
    );
    const attemptId = "run_slice_rev_1";
    const acceptedHead = "b".repeat(40);
    const signature = await signCallback(
      "callback-retry-secret",
      callbackPayload(attemptId, 1, acceptedHead),
    );
    const inputCallback = {
      attemptId,
      expectedRevision: 1,
      acceptedHead,
      result: { outcome: "ok" },
      signature,
    };
    const wakeups: unknown[] = [];
    const enqueue = async (wakeup: unknown) => {
      wakeups.push(wakeup);
    };
    await acceptCallbackAndAdvance(
      store,
      "callback-retry-secret",
      inputCallback,
      enqueue,
    );
    wakeups.length = 0;
    await expect(
      acceptCallbackAndAdvance(
        store,
        "callback-retry-secret",
        inputCallback,
        enqueue,
      ),
    ).resolves.toBe("duplicate");
    expect(wakeups).toEqual([{ runId: input.id, expectedRevision: 2 }]);
  });

  it("runs one deterministic low-risk fake journey through D1-owned revisions", async () => {
    const store = new MemoryRunRepository();
    await store.create(createRun(input));
    const wakeups = [{ runId: input.id, expectedRevision: 1 }];
    const stages: RunStage[] = [];
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
      const acceptedHead = String(wakeup.expectedRevision).repeat(40);
      const signature = await signCallback(
        "journey-secret",
        callbackPayload(dispatched.id, dispatched.runRevision, acceptedHead),
      );
      await acceptCallbackAndAdvance(
        store,
        "journey-secret",
        {
          attemptId: dispatched.id,
          expectedRevision: dispatched.runRevision,
          acceptedHead,
          result: { outcome: "ok" },
          signature,
        },
        async (next) => {
          wakeups.push(next);
        },
      );
    }
    expect(stages).toEqual(["qualify", "implement", "validate", "review"]);
    await expect(store.get(input.id)).resolves.toMatchObject({
      status: "succeeded",
      revision: 5,
    });
  });
});
