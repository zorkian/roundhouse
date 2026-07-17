// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import {
  durableAttemptResult,
  type DurableAttemptResultStorage,
} from "./durable-attempt-result.js";

function memoryStorage(): DurableAttemptResultStorage & {
  values: Map<string, unknown>;
} {
  const values = new Map<string, unknown>();
  return {
    values,
    get: async <T>(key: string) => values.get(key) as T | undefined,
    put: async <T>(key: string, value: T) => {
      values.set(key, value);
    },
  };
}

describe("durable attempt result", () => {
  it("replays a completed result after the Worker isolate is replaced", async () => {
    const storage = memoryStorage();
    const execute = vi.fn(async () => ({ attemptId: "attempt_1", ok: true }));
    const validate = (value: unknown) => {
      const result = value as { attemptId?: unknown; ok?: unknown };
      if (result.attemptId !== "attempt_1" || result.ok !== true)
        throw new Error("binding mismatch");
      return result as { attemptId: string; ok: true };
    };

    await expect(
      durableAttemptResult(storage, "result", validate, execute),
    ).resolves.toEqual({ attemptId: "attempt_1", ok: true });
    await expect(
      durableAttemptResult(storage, "result", validate, execute),
    ).resolves.toEqual({ attemptId: "attempt_1", ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects retained state that does not bind to the current attempt", async () => {
    const storage = memoryStorage();
    storage.values.set("result", { attemptId: "another_attempt", ok: true });
    const execute = vi.fn();

    await expect(
      durableAttemptResult(
        storage,
        "result",
        (value) => {
          if ((value as { attemptId?: unknown }).attemptId !== "attempt_1")
            throw new Error("binding mismatch");
          return value;
        },
        execute,
      ),
    ).rejects.toThrow("binding mismatch");
    expect(execute).not.toHaveBeenCalled();
  });
});
