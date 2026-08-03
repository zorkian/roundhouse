// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { publishConversationWakeup } from "./conversation-liveness.js";
import {
  D1ConversationRepository,
  type CanonicalInboundMessage,
  type ConversationContext,
  type ConversationRepositoryRef,
  type ConversationWakeup,
} from "./conversation-store.js";

interface ConversationQueue {
  send(wakeup: ConversationWakeup): Promise<unknown>;
}

export class ConversationService {
  constructor(
    private readonly repository: D1ConversationRepository,
    private readonly queue: ConversationQueue,
  ) {}

  private async publish(wakeup: ConversationWakeup): Promise<void> {
    try {
      await publishConversationWakeup(this.repository, this.queue, wakeup);
    } catch {
      // The D1 outbox is authoritative. The scheduled liveness scan republishes
      // a wakeup when immediate Queue publication fails.
    }
  }

  async start(input: {
    readonly conversationId: string;
    readonly turnId: string;
    readonly messageId: string;
    readonly repository: ConversationRepositoryRef;
    readonly creatorGithubUserId: number;
    readonly creatorGithubLogin: string;
    readonly sourceCommit: string;
    readonly profileHash: string;
    readonly context: ConversationContext;
    readonly message: CanonicalInboundMessage;
  }): Promise<{ readonly conversationId: string; readonly created: boolean }> {
    const result = await this.repository.create({
      id: input.conversationId,
      repositoryId: input.repository.id,
      creatorGithubUserId: input.creatorGithubUserId,
      creatorGithubLogin: input.creatorGithubLogin,
      sourceCommit: input.sourceCommit,
      profileHash: input.profileHash,
      context: input.context,
      turnId: input.turnId,
      messageId: input.messageId,
      message: input.message,
    });
    if (result.created) await this.publish({ kind: "turn", id: result.turnId });
    return { conversationId: result.conversationId, created: result.created };
  }

  async acceptMessage(input: {
    readonly conversationId: string;
    readonly creatorGithubUserId: number;
    readonly turnId: string;
    readonly messageId: string;
    readonly message: CanonicalInboundMessage;
  }): Promise<"created" | "duplicate" | "unavailable"> {
    const result = await this.repository.appendUserTurn(input);
    if (result === "created")
      await this.publish({ kind: "turn", id: input.turnId });
    return result;
  }

  async prepareBrief(input: {
    readonly conversationId: string;
    readonly creatorGithubUserId: number;
    readonly turnId: string;
    readonly messageId?: string;
    readonly message?: CanonicalInboundMessage;
  }): Promise<"created" | "duplicate" | "unavailable"> {
    const startedAt = Date.now();
    const result = await this.repository.requestBrief(input);
    if (result === "created")
      await this.publish({ kind: "turn", id: input.turnId });
    console.log(
      JSON.stringify({
        message: "conversation_brief_scheduled",
        conversationId: input.conversationId,
        turnId: input.turnId,
        includedInboundMessage: Boolean(input.message),
        outcome: result,
        durationMs: Date.now() - startedAt,
      }),
    );
    return result;
  }

  async approveBrief(
    input: Parameters<
      D1ConversationRepository["approveBriefAndRequestPromotion"]
    >[0],
  ): Promise<boolean> {
    const created =
      await this.repository.approveBriefAndRequestPromotion(input);
    if (created)
      await this.publish({ kind: "promotion", id: input.promotionId });
    return created;
  }
}
