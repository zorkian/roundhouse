// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { Wakeup } from "@roundhouse/core";
import { D1RunRepository, type PendingWakeup } from "./d1-store.js";

export const wakeupRedeliveryMilliseconds = 5 * 60_000;

interface WakeupQueue {
  send(wakeup: Wakeup): Promise<unknown>;
}

export async function publishWakeup(
  repository: D1RunRepository,
  queue: WakeupQueue,
  wakeup: Wakeup,
  now = Date.now(),
): Promise<void> {
  const startedAt = Date.now();
  console.log(
    JSON.stringify({
      message: "durable_wakeup_delivery_started",
      runId: wakeup.runId,
      expectedRevision: wakeup.expectedRevision,
    }),
  );
  try {
    await queue.send(wakeup);
    const tracked = await repository.markWakeupSent(
      wakeup,
      now + wakeupRedeliveryMilliseconds,
    );
    console.log(
      JSON.stringify({
        message: "durable_wakeup_delivery_completed",
        runId: wakeup.runId,
        expectedRevision: wakeup.expectedRevision,
        tracked,
        durationMs: Date.now() - startedAt,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "durable_wakeup_delivery_failed",
        runId: wakeup.runId,
        expectedRevision: wakeup.expectedRevision,
        durationMs: Date.now() - startedAt,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
}

async function publishPendingWakeup(
  repository: D1RunRepository,
  queue: WakeupQueue,
  pending: PendingWakeup,
  now: number,
): Promise<"sent" | "failed"> {
  try {
    await publishWakeup(repository, queue, pending.wakeup, now);
    return "sent";
  } catch {
    return "failed";
  }
}

export async function publishPendingWakeups(
  repository: D1RunRepository,
  queue: WakeupQueue,
  now = Date.now(),
  limit = 50,
): Promise<{ readonly sent: number; readonly failed: number }> {
  const pending = await repository.pendingWakeups(now, limit);
  let sent = 0;
  let failed = 0;
  for (const wakeup of pending) {
    const outcome = await publishPendingWakeup(repository, queue, wakeup, now);
    if (outcome === "sent") sent += 1;
    else failed += 1;
  }
  console.log(
    JSON.stringify({
      message: "durable_wakeup_scan_completed",
      pending: pending.length,
      sent,
      failed,
    }),
  );
  return { sent, failed };
}
