// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type {
  CanonicalInboundMessage,
  ConversationMessage,
} from "./conversation-store.js";

export interface VerifiedConversationActor {
  readonly id: string;
  readonly login: string;
}

export interface ConversationAdapter {
  readonly name: string;
  deliver(message: ConversationMessage): Promise<void>;
}

export function webInboundMessage(input: {
  readonly actor: VerifiedConversationActor;
  readonly conversationId: string;
  readonly messageId: string;
  readonly body: string;
  readonly sentAt?: number;
}): CanonicalInboundMessage {
  return {
    adapter: "roundhouse.web",
    adapterInstallation: "roundhouse.web",
    externalConversationId: input.conversationId,
    externalMessageId: input.messageId,
    verifiedActorId: input.actor.id,
    verifiedActorLogin: input.actor.login,
    body: input.body,
    sentAt: input.sentAt ?? Date.now(),
  };
}

export const webConversationAdapter: ConversationAdapter = {
  name: "roundhouse.web",
  // Web replies are delivered by rendering the canonical persisted message.
  // Completing the outbox item still exercises the same delivery contract a
  // future push/chat adapter will implement.
  async deliver() {},
};
