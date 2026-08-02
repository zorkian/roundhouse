// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { D1ConversationRepository } from "./conversation-store.js";
import type { D1Like } from "./d1-store.js";

function sqliteD1(database: DatabaseSync): D1Like {
  return {
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      const prepared = database.prepare(sql);
      const statement = {
        bind: (...bound: unknown[]) => {
          values = bound as SQLInputValue[];
          return statement;
        },
        first: async <T>() =>
          (prepared.get(...values) as T | undefined) ?? null,
        run: async () => {
          const result = prepared.run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
        all: async <T>() => ({
          meta: {},
          results: prepared.all(...values) as T[],
        }),
      };
      return statement;
    },
  };
}

const ids = {
  conversation: "0e8466f1-ece0-4daf-b94d-5eaa1db75d61",
  brief: "b9b35e62-222d-4982-a621-dd34c6a38d95",
  promotion: "6ba87f27-a392-4057-8b75-4e140a39dfa8",
};

const inbound = (externalMessageId: string, body: string, sentAt: number) => ({
  adapter: "web",
  adapterInstallation: "roundhouse-ui",
  externalConversationId: ids.conversation,
  externalMessageId,
  verifiedActorId: "7",
  verifiedActorLogin: "octocat",
  body,
  sentAt,
});

describe("D1 conversation repository", () => {
  it("persists serialized turns, editable briefs, durable promotion, links, and usage", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys=ON");
    sqlite.exec(
      "CREATE TABLE repositories (id TEXT PRIMARY KEY, github_id TEXT NOT NULL UNIQUE, profile_version TEXT NOT NULL, profile_json TEXT NOT NULL, created_at INTEGER NOT NULL)",
    );
    sqlite.exec(
      readFileSync(
        new URL("../migrations/0017_conversations.sql", import.meta.url),
        "utf8",
      ),
    );
    sqlite
      .prepare("INSERT INTO repositories VALUES (?1,?2,?3,?4,?5)")
      .run(
        "repo_123",
        "123",
        "profile",
        JSON.stringify({ repository: "octo/project", installationId: 99 }),
        1,
      );
    let now = 100;
    const repository = new D1ConversationRepository(
      sqliteD1(sqlite),
      () => now,
    );
    const created = await repository.create({
      id: ids.conversation,
      repositoryId: "repo_123",
      creatorGithubUserId: 7,
      creatorGithubLogin: "octocat",
      sourceCommit: "a".repeat(40),
      profileHash: "b".repeat(64),
      context: {
        model: { id: "openai/gpt-5.6-sol", reasoning: "high" },
        defaultBranch: "main",
      },
      turnId: "turn-1",
      messageId: "message-1",
      message: inbound("external-1", "What should we build?", now),
    });
    expect(created.created).toBe(true);
    await expect(
      repository.create({
        id: crypto.randomUUID(),
        repositoryId: "repo_123",
        creatorGithubUserId: 7,
        creatorGithubLogin: "octocat",
        sourceCommit: "a".repeat(40),
        profileHash: "b".repeat(64),
        context: {
          model: { id: "openai/gpt-5.6-sol", reasoning: "high" },
          defaultBranch: "main",
        },
        turnId: "other-turn",
        messageId: "other-message",
        message: inbound("external-1", "duplicate", now),
      }),
    ).resolves.toMatchObject({
      conversationId: ids.conversation,
      created: false,
    });

    expect(await repository.pendingWakeups(now)).toHaveLength(1);
    await expect(repository.claimTurn("turn-1")).resolves.toMatchObject({
      state: "running",
      attempts: 1,
    });
    await repository.recordModelUsage([
      {
        callId: "call-1",
        provider: "openai",
        conversationId: ids.conversation,
        turnId: "turn-1",
        callKind: "conversation",
        model: "openai/gpt-5.6-sol",
        configuredModel: "openai/gpt-5.6-sol",
        protocol: "openai-responses",
        reasoningLevel: "high",
        routingRule: "profile-conversation-v2",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        costUsd: 0.001,
        latencyMs: 20,
        outcome: "succeeded",
        createdAt: now,
      },
    ]);
    await expect(
      repository.completeMessageTurn(
        "turn-1",
        "message-2",
        "Let's clarify first.",
      ),
    ).resolves.toBe(true);

    now += 1;
    await expect(
      repository.appendUserTurn({
        conversationId: ids.conversation,
        creatorGithubUserId: 7,
        turnId: "turn-2",
        messageId: "message-3",
        message: inbound("external-2", "Here are the constraints.", now),
      }),
    ).resolves.toBe("created");
    await expect(
      repository.appendUserTurn({
        conversationId: ids.conversation,
        creatorGithubUserId: 7,
        turnId: "turn-racing",
        messageId: "message-racing",
        message: inbound("external-racing", "Race", now),
      }),
    ).resolves.toBe("unavailable");
    await repository.claimTurn("turn-2");
    await repository.completeMessageTurn(
      "turn-2",
      "message-4",
      "Ready for a brief.",
    );

    now += 1;
    await expect(
      repository.requestBrief({
        conversationId: ids.conversation,
        creatorGithubUserId: 7,
        turnId: "turn-brief",
      }),
    ).resolves.toBe(true);
    await repository.claimTurn("turn-brief");
    await expect(
      repository.completeBriefTurn("turn-brief", ids.brief, {
        title: "Build the flow",
        outcome: "Create a conversation flow.",
        acceptanceCriteria: ["It is read-only"],
        constraints: ["No shell"],
        evidence: ["The user approved a web-first adapter"],
        uncertainties: [],
      }),
    ).resolves.toBe(true);
    await expect(
      repository.appendUserTurn({
        conversationId: ids.conversation,
        creatorGithubUserId: 999,
        turnId: "unauthorized-turn",
        messageId: "unauthorized-message",
        message: {
          ...inbound("external-unauthorized", "tamper", now),
          verifiedActorId: "999",
          verifiedActorLogin: "attacker",
        },
      }),
    ).resolves.toBe("unavailable");
    await expect(
      repository.get(ids.conversation, 7, ["123"]),
    ).resolves.toMatchObject({
      currentBrief: { id: ids.brief, state: "draft" },
    });
    await expect(
      repository.approveBriefAndRequestPromotion({
        conversationId: ids.conversation,
        creatorGithubUserId: 7,
        creatorGithubLogin: "octocat",
        briefId: ids.brief,
        title: "Build the flow",
        outcome: "Create a conversation flow.",
        acceptanceCriteria: ["It is read-only"],
        constraints: ["No shell"],
        evidence: ["The user approved a web-first adapter"],
        uncertainties: [],
        promotionId: ids.promotion,
        uiSessionHash: "session-hash",
      }),
    ).resolves.toBe(true);
    await expect(repository.claimPromotion(ids.promotion)).resolves.toBe(true);
    await repository.recordPromotionIssue(
      ids.promotion,
      42,
      "https://github.test/octo/project/issues/42",
    );
    await repository.markPromotionAwaitingIntake(ids.promotion);
    await expect(
      repository.recordPromotionIntake({
        conversationId: ids.conversation,
        briefId: ids.brief,
        issueNumber: 42,
        actorGithubLogin: "attacker",
        accepted: false,
        errorCode: "operator_unauthorized",
      }),
    ).resolves.toBe(false);
    await expect(
      repository.recordPromotionIntake({
        conversationId: ids.conversation,
        briefId: ids.brief,
        issueNumber: 42,
        actorGithubLogin: "octocat",
        accepted: false,
        errorCode: "operator_unauthorized",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.recordPromotionIntake({
        conversationId: ids.conversation,
        briefId: ids.brief,
        issueNumber: 42,
        actorGithubLogin: "maintainer",
        accepted: true,
        runId: "run-42",
        runUrl: "https://roundhouse.test/repositories/octo/project/issues/42",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.recordPromotionIntake({
        conversationId: ids.conversation,
        briefId: ids.brief,
        issueNumber: 42,
        actorGithubLogin: "maintainer",
        accepted: true,
        runId: "run-42",
        runUrl: "https://roundhouse.test/repositories/octo/project/issues/42",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.recordPromotionIntake({
        conversationId: ids.conversation,
        briefId: ids.brief,
        issueNumber: 42,
        actorGithubLogin: "octocat",
        accepted: false,
        errorCode: "operator_unauthorized",
      }),
    ).resolves.toBe(false);

    await expect(
      repository.get(ids.conversation, 7, ["123"]),
    ).resolves.toMatchObject({
      status: "promoted",
      promotion: { state: "accepted", issueNumber: 42, runId: "run-42" },
      currentBrief: { state: "approved", title: "Build the flow" },
      links: [
        { kind: "github.issue", externalId: "42" },
        { kind: "roundhouse.run", externalId: "run-42" },
      ],
      messages: [
        { role: "user", direction: "inbound" },
        { role: "assistant", direction: "outbound" },
        { role: "user", direction: "inbound" },
        { role: "assistant", direction: "outbound" },
      ],
    });
    await expect(
      repository.get(ids.conversation, 8, ["123"]),
    ).resolves.toBeUndefined();
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM conversation_model_usage")
        .get(),
    ).toEqual({ count: 1 });
    sqlite.close();
  });

  it("does not query private conversation data without current repository access", async () => {
    const db = {
      prepare: () => {
        throw new Error("unexpected query");
      },
      batch: async () => [],
    } as unknown as D1Like;
    await expect(
      new D1ConversationRepository(db).get(ids.conversation, 7, []),
    ).resolves.toBeUndefined();
  });
});
