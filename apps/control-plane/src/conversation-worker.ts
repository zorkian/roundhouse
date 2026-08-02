// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { executeConversationTurn } from "./conversation-engine.js";
import type { ConversationAdapter } from "./conversation-adapter.js";
import { deliverPendingConversationReplies } from "./conversation-liveness.js";
import { executeConversationPromotion } from "./conversation-promotion.js";
import {
  D1ConversationRepository,
  type ConversationCallUsage,
  type ConversationWakeup,
} from "./conversation-store.js";
import { GitHubClient, type GitHubEnv } from "./github.js";
import type { UiAuthEnv } from "./ui-auth.js";

interface ConversationWorkerEnv extends GitHubEnv, UiAuthEnv {
  readonly MODEL_BROKER: Fetcher;
  readonly PUBLIC_ORIGIN: string;
}

function executionMetadata(error: unknown): {
  readonly usage: readonly ConversationCallUsage[];
  readonly route?: NonNullable<
    Awaited<ReturnType<typeof executeConversationTurn>>["route"]
  >;
  readonly code: string;
} {
  if (!(error instanceof Error))
    return { usage: [], code: "conversation_execution_failed" };
  const enriched = error as Error & {
    usage?: readonly ConversationCallUsage[];
    route?: Awaited<ReturnType<typeof executeConversationTurn>>["route"];
  };
  return {
    usage: enriched.usage ?? [],
    ...(enriched.route ? { route: enriched.route } : {}),
    code: error.message.slice(0, 120),
  };
}

export async function processConversationWakeup(
  repository: D1ConversationRepository,
  env: ConversationWorkerEnv,
  wakeup: ConversationWakeup,
  deliveryAttempts: number,
  adapters: ReadonlyMap<string, ConversationAdapter>,
): Promise<"completed" | "retry" | "ignored"> {
  if (wakeup.kind === "promotion") {
    const work = await repository.promotionForWork(wakeup.id);
    if (!work) {
      await repository.completeWakeup(wakeup);
      return "ignored";
    }
    const result = await executeConversationPromotion(
      repository,
      new GitHubClient(
        env,
        work.conversation.repository.installationId,
        undefined,
        false,
      ),
      env,
      wakeup.id,
    );
    if (result === "retry" && deliveryAttempts >= 5) {
      await repository.rejectPromotion(wakeup.id, "promotion_retry_exhausted");
      await repository.completeWakeup(wakeup);
      return "completed";
    }
    if (result === "completed") await repository.completeWakeup(wakeup);
    return result;
  }

  const existing = await repository.turn(wakeup.id);
  if (!existing) {
    await repository.completeWakeup(wakeup);
    return "ignored";
  }
  if (["succeeded", "failed"].includes(existing.state)) {
    await repository.completeWakeup(wakeup);
    return "completed";
  }
  const turn = await repository.claimTurn(wakeup.id);
  if (!turn) return "retry";
  const conversation = await repository.getForTurn(turn.id);
  if (!conversation) {
    await repository.failTurn(turn.id, "conversation_missing");
    await repository.completeWakeup(wakeup);
    return "completed";
  }
  try {
    const result = await executeConversationTurn(
      env.MODEL_BROKER,
      new GitHubClient(
        env,
        conversation.repository.installationId,
        undefined,
        false,
      ),
      conversation,
      turn,
      () => repository.renewTurn(turn.id),
    );
    await repository.recordTurnRoute(turn.id, result.route);
    await repository.recordModelUsage(result.usage);
    if (turn.kind === "message") {
      if (!result.text) throw new Error("conversation_model_output_missing");
      const completed = await repository.completeMessageTurn(
        turn.id,
        crypto.randomUUID(),
        result.text,
      );
      if (!completed) throw new Error("conversation_turn_completion_conflict");
      await deliverPendingConversationReplies(repository, adapters);
    } else {
      if (!result.brief) throw new Error("delivery_brief_missing");
      const completed = await repository.completeBriefTurn(
        turn.id,
        crypto.randomUUID(),
        result.brief,
      );
      if (!completed) throw new Error("conversation_turn_completion_conflict");
    }
    await repository.completeWakeup(wakeup);
    return "completed";
  } catch (error) {
    const metadata = executionMetadata(error);
    if (metadata.route)
      await repository.recordTurnRoute(turn.id, metadata.route);
    await repository.recordModelUsage(metadata.usage);
    if (deliveryAttempts >= 5) {
      await repository.failTurn(turn.id, metadata.code);
      await repository.completeWakeup(wakeup);
      return "completed";
    }
    await repository.retryTurn(turn.id, metadata.code);
    return "retry";
  }
}
