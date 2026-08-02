// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ConversationAdapter } from "./conversation-adapter.js";
import {
  D1ConversationRepository,
  type ConversationWakeup,
  type PendingConversationWakeup,
} from "./conversation-store.js";

export const conversationWakeupRedeliveryMilliseconds = 5 * 60_000;

interface ConversationQueue {
  send(wakeup: ConversationWakeup): Promise<unknown>;
}

export async function publishConversationWakeup(
  repository: D1ConversationRepository,
  queue: ConversationQueue,
  wakeup: ConversationWakeup,
  now = Date.now(),
): Promise<void> {
  const startedAt = Date.now();
  try {
    await queue.send(wakeup);
    const tracked = await repository.markWakeupSent(
      wakeup,
      now + conversationWakeupRedeliveryMilliseconds,
    );
    console.log(
      JSON.stringify({
        message: "conversation_wakeup_delivery_completed",
        kind: wakeup.kind,
        id: wakeup.id,
        tracked,
        durationMs: Date.now() - startedAt,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "conversation_wakeup_delivery_failed",
        kind: wakeup.kind,
        id: wakeup.id,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
}

async function publishPending(
  repository: D1ConversationRepository,
  queue: ConversationQueue,
  pending: PendingConversationWakeup,
  now: number,
): Promise<boolean> {
  try {
    await publishConversationWakeup(repository, queue, pending.wakeup, now);
    return true;
  } catch {
    return false;
  }
}

export async function publishPendingConversationWakeups(
  repository: D1ConversationRepository,
  queue: ConversationQueue,
  now = Date.now(),
  limit = 50,
): Promise<{ readonly sent: number; readonly failed: number }> {
  const pending = await repository.pendingWakeups(now, limit);
  let sent = 0;
  let failed = 0;
  for (const wakeup of pending) {
    if (await publishPending(repository, queue, wakeup, now)) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

export async function deliverPendingConversationReplies(
  repository: D1ConversationRepository,
  adapters: ReadonlyMap<string, ConversationAdapter>,
  limit = 50,
): Promise<{ readonly delivered: number; readonly failed: number }> {
  const pending = await repository.pendingAdapterReplies(limit);
  let delivered = 0;
  let failed = 0;
  for (const item of pending) {
    const adapter = adapters.get(item.message.adapter);
    if (!adapter) {
      failed += 1;
      continue;
    }
    try {
      await adapter.deliver(item.message);
      await repository.completeAdapterReply(item.outboxId);
      delivered += 1;
    } catch (error) {
      failed += 1;
      console.error(
        JSON.stringify({
          message: "conversation_reply_delivery_failed",
          adapter: item.message.adapter,
          messageId: item.message.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return { delivered, failed };
}
