// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
  D1RunRepository,
  type D1Like,
  type PendingWakeup,
} from "./d1-store.js";
import { publishPendingWakeups } from "./liveness.js";

const wakeup = {
  runId: "run_delivery_failure",
  expectedRevision: 7,
};

class PendingWakeupRepository extends D1RunRepository {
  pending = true;
  marked = 0;

  constructor() {
    super({
      async batch() {
        throw new Error("unexpected_database_call");
      },
      prepare() {
        throw new Error("unexpected_database_call");
      },
    } as D1Like);
  }

  override async pendingWakeups(): Promise<readonly PendingWakeup[]> {
    return this.pending
      ? [{ wakeup, attempts: this.marked, availableAt: 100 }]
      : [];
  }

  override async markWakeupSent(): Promise<boolean> {
    this.marked += 1;
    this.pending = false;
    return true;
  }
}

describe("durable wakeup delivery", () => {
  it("keeps persisted intent pending when Queue delivery fails", async () => {
    const repository = new PendingWakeupRepository();
    const queue = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error("injected_queue_failure"))
        .mockResolvedValueOnce(undefined),
    };

    await expect(
      publishPendingWakeups(repository, queue, 100),
    ).resolves.toEqual({ sent: 0, failed: 1 });
    expect(repository.pending).toBe(true);
    expect(repository.marked).toBe(0);

    await expect(
      publishPendingWakeups(repository, queue, 101),
    ).resolves.toEqual({ sent: 1, failed: 0 });
    expect(repository.pending).toBe(false);
    expect(repository.marked).toBe(1);
    expect(queue.send).toHaveBeenCalledTimes(2);
  });
});
