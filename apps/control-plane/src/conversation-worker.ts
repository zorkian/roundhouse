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
import { GitHubClient, type GitHubApi, type GitHubEnv } from "./github.js";
import type { UiAuthEnv } from "./ui-auth.js";

interface ConversationWorkerEnv extends GitHubEnv, UiAuthEnv {
  readonly MODEL_BROKER: Fetcher;
  readonly PUBLIC_ORIGIN: string;
}

interface ConversationWorkerDependencies {
  readonly github?: GitHubApi;
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

export type ConversationWakeupOutcome =
  | "completed"
  | "ignored"
  | "retry"
  | { readonly kind: "retry"; readonly delaySeconds: number };

/** Delay between queue retries after a transient model rate limit. */
export const conversationRateLimitRetryDelaySeconds = 30;

export async function processConversationWakeup(
  repository: D1ConversationRepository,
  env: ConversationWorkerEnv,
  wakeup: ConversationWakeup,
  deliveryAttempts: number,
  adapters: ReadonlyMap<string, ConversationAdapter>,
  dependencies: ConversationWorkerDependencies = {},
): Promise<ConversationWakeupOutcome> {
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
  if (!turn) return existing.state === "running" ? "ignored" : "retry";
  const conversation = await repository.getForTurn(turn.id);
  if (!conversation) {
    await repository.failTurn(turn.id, "conversation_missing");
    await repository.completeWakeup(wakeup);
    return "completed";
  }
  const github =
    dependencies.github ??
    new GitHubClient(
      env,
      conversation.repository.installationId,
      undefined,
      false,
    );
  try {
    const metadata = await github.get<{ private?: boolean }>(
      `/repos/${conversation.repository.name}`,
    );
    if (metadata.private !== false) {
      await repository.failTurn(turn.id, "conversation_repository_not_public");
      await repository.completeWakeup(wakeup);
      return "completed";
    }
    const result = await executeConversationTurn(
      env.MODEL_BROKER,
      github,
      conversation,
      turn,
      () => repository.renewTurn(turn.id),
    );
    await repository.recordTurnRoute(turn.id, result.route);
    await repository.recordModelUsage(result.usage);
    if (turn.kind === "message") {
      const firstReply = turn.ordinal === 1 ? result.firstReply : undefined;
      if (turn.ordinal === 1 && !firstReply)
        throw new Error("conversation_first_reply_missing");
      const reply = firstReply?.reply ?? result.text;
      if (!reply) throw new Error("conversation_model_output_missing");
      const completionStartedAt = Date.now();
      let completed: boolean;
      try {
        completed = await repository.completeMessageTurn(
          turn.id,
          crypto.randomUUID(),
          reply,
          firstReply?.title,
        );
      } catch (error) {
        if (firstReply)
          console.error(
            JSON.stringify({
              message: "conversation_first_reply_completion",
              conversationId: conversation.id,
              turnId: turn.id,
              outcome: "failed",
              titleLength: firstReply.title.length,
              titleWordCount: firstReply.title.split(/\s+/u).filter(Boolean)
                .length,
              errorCode:
                error instanceof Error
                  ? error.message
                  : "conversation_turn_completion_failed",
              durationMs: Date.now() - completionStartedAt,
            }),
          );
        throw error;
      }
      if (firstReply)
        console.log(
          JSON.stringify({
            message: "conversation_first_reply_completion",
            conversationId: conversation.id,
            turnId: turn.id,
            outcome: completed ? "succeeded" : "conflict",
            titleLength: firstReply.title.length,
            titleWordCount: firstReply.title.split(/\s+/u).filter(Boolean)
              .length,
            durationMs: Date.now() - completionStartedAt,
          }),
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
    if (
      deliveryAttempts >= 5 ||
      metadata.code === "conversation_model_budget_exhausted"
    ) {
      await repository.failTurn(turn.id, metadata.code);
      await repository.completeWakeup(wakeup);
      return "completed";
    }
    await repository.retryTurn(turn.id, metadata.code);
    if (metadata.code === "conversation_model_http_429")
      return {
        kind: "retry",
        delaySeconds: conversationRateLimitRetryDelaySeconds,
      };
    return "retry";
  }
}
