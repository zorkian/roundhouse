// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
  deliverPendingConversationReplies,
  publishConversationWakeup,
  publishPendingConversationWakeups,
} from "./conversation-liveness.js";
import type { ConversationAdapter } from "./conversation-adapter.js";
import type { D1ConversationRepository } from "./conversation-store.js";

describe("conversation durable delivery", () => {
  it("leaves the D1 outbox authoritative when immediate Queue publication fails", async () => {
    const repository = {
      markWakeupSent: vi.fn(),
    } as unknown as D1ConversationRepository;
    const queue = {
      send: vi.fn(async () => {
        throw new Error("queue_down");
      }),
    };
    await expect(
      publishConversationWakeup(repository, queue, {
        kind: "turn",
        id: "turn-1",
      }),
    ).rejects.toThrow("queue_down");
    expect(repository.markWakeupSent).not.toHaveBeenCalled();
  });

  it("republishes pending wakeups and advances their durable visibility deadline", async () => {
    const repository = {
      pendingWakeups: vi.fn(async () => [
        {
          wakeup: { kind: "turn" as const, id: "turn-1" },
          attempts: 0,
          availableAt: 100,
        },
      ]),
      markWakeupSent: vi.fn(async () => true),
    } as unknown as D1ConversationRepository;
    const queue = { send: vi.fn(async () => undefined) };
    await expect(
      publishPendingConversationWakeups(repository, queue, 100),
    ).resolves.toEqual({ sent: 1, failed: 0 });
    expect(queue.send).toHaveBeenCalledWith({ kind: "turn", id: "turn-1" });
    expect(repository.markWakeupSent).toHaveBeenCalledOnce();
  });

  it("delivers canonical outbound messages through an adapter registry", async () => {
    const message = {
      id: "message-1",
      turnId: "turn-1",
      direction: "outbound" as const,
      role: "assistant" as const,
      actorId: "roundhouse",
      actorLogin: "Roundhouse",
      adapter: "test.adapter",
      adapterInstallation: "installation-1",
      externalConversationId: "conversation-1",
      body: "Reply",
      createdAt: 100,
    };
    const repository = {
      pendingAdapterReplies: vi.fn(async () => [
        { outboxId: "outbox-1", message },
      ]),
      completeAdapterReply: vi.fn(async () => undefined),
    } as unknown as D1ConversationRepository;
    const adapter: ConversationAdapter = {
      name: "test.adapter",
      deliver: vi.fn(async () => undefined),
    };
    await expect(
      deliverPendingConversationReplies(
        repository,
        new Map([[adapter.name, adapter]]),
      ),
    ).resolves.toEqual({ delivered: 1, failed: 0 });
    expect(adapter.deliver).toHaveBeenCalledWith(message);
    expect(repository.completeAdapterReply).toHaveBeenCalledWith("outbox-1");
  });
});
