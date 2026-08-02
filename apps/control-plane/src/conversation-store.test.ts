// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { D1ConversationRepository } from "./conversation-store.js";
import type { D1Like } from "./d1-store.js";

function queryDb() {
  const queries: { sql: string; values: unknown[] }[] = [];
  const db: D1Like = {
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      const statement = {
        bind: (...bound: unknown[]) => {
          values = bound as SQLInputValue[];
          return statement;
        },
        first: async () => {
          queries.push({ sql, values });
          if (!sql.includes("FROM conversations c")) return null;
          return {
            conversation_id: "0e8466f1-ece0-4daf-b94d-5eaa1db75d61",
            creator_github_user_id: 7,
            creator_github_login: "octocat",
            status: "open",
            source_commit: "a".repeat(40),
            profile_hash: "b".repeat(64),
            context_json: JSON.stringify({
              model: { id: "openai/gpt-5.6-sol", reasoning: "high" },
              defaultBranch: "main",
            }),
            active_turn_id: null,
            delivery_brief_json: null,
            promotion_lease_expires_at: null,
            promoted_issue_number: null,
            promoted_issue_url: null,
            created_at: 1,
            updated_at: 2,
            id: "repo_123",
            github_id: "123",
            profile_json: JSON.stringify({
              repository: "octo/project",
              installationId: 99,
            }),
          };
        },
        run: async () => {
          queries.push({ sql, values });
          return { meta: { changes: 0 } };
        },
        all: async () => {
          queries.push({ sql, values });
          return { meta: {}, results: [] };
        },
      };
      return statement as unknown as ReturnType<D1Like["prepare"]>;
    },
  };
  return { db, queries };
}

describe("D1 conversation repository", () => {
  it("binds reads to both the creator and current repository access", async () => {
    const { db, queries } = queryDb();
    const repository = new D1ConversationRepository(db);
    await expect(
      repository.get("0e8466f1-ece0-4daf-b94d-5eaa1db75d61", 7, ["123"]),
    ).resolves.toMatchObject({
      creatorGithubUserId: 7,
      repository: { name: "octo/project", githubId: "123" },
    });
    expect(queries[0]!.sql).toContain("c.creator_github_user_id=?2");
    expect(queries[0]!.sql).toContain("r.github_id IN (?3)");
    expect(queries[0]!.values).toEqual([
      "0e8466f1-ece0-4daf-b94d-5eaa1db75d61",
      7,
      "123",
    ]);
  });

  it("does not query a conversation when repository access is empty", async () => {
    const { db, queries } = queryDb();
    await expect(
      new D1ConversationRepository(db).get("conversation", 7, []),
    ).resolves.toBeUndefined();
    expect(queries).toHaveLength(0);
  });

  it("rejects a second turn while another turn owns the conversation", async () => {
    const { db } = queryDb();
    await expect(
      new D1ConversationRepository(db).appendUserTurn({
        conversationId: "conversation",
        creatorGithubUserId: 7,
        turnId: "turn",
        messageId: "message",
        body: "hello",
      }),
    ).resolves.toBe(false);
  });

  it("persists the lifecycle and serializes turns and promotions in SQLite", async () => {
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
    sqlite.prepare("INSERT INTO repositories VALUES (?1,?2,?3,?4,?5)").run(
      "repo_123",
      "123",
      "profile",
      JSON.stringify({
        repository: "octo/project",
        installationId: 99,
      }),
      1,
    );
    const d1 = sqliteD1(sqlite);
    let now = 100;
    const repository = new D1ConversationRepository(d1, () => now);
    const conversationId = "0e8466f1-ece0-4daf-b94d-5eaa1db75d61";
    await repository.create({
      id: conversationId,
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
      body: "What should we build?",
    });
    await expect(
      repository.finishTurn(
        conversationId,
        "turn-1",
        "message-2",
        "Let's clarify it first.",
      ),
    ).resolves.toBe(true);
    await expect(
      repository.appendUserTurn({
        conversationId,
        creatorGithubUserId: 7,
        turnId: "turn-2",
        messageId: "message-3",
        body: "Here are the constraints.",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.appendUserTurn({
        conversationId,
        creatorGithubUserId: 7,
        turnId: "turn-racing",
        messageId: "message-racing",
        body: "Race",
      }),
    ).resolves.toBe(false);
    await repository.finishTurn(
      conversationId,
      "turn-2",
      "message-4",
      "The request is ready.",
    );
    const brief = {
      title: "Build the flow",
      outcome: "Create a conversation flow.",
      acceptanceCriteria: ["It is read-only"],
      constraints: ["No shell"],
      context: [],
    };
    await expect(
      repository.preparePromotion(conversationId, 7, brief),
    ).resolves.toBe(true);
    await expect(repository.beginPromotion(conversationId, 7)).resolves.toBe(
      true,
    );
    await expect(
      repository.claimPromotionRetry(conversationId, 7),
    ).resolves.toBe(false);
    now += 120_001;
    await expect(
      repository.claimPromotionRetry(conversationId, 7),
    ).resolves.toBe(true);
    await repository.recordPromotionIssue(
      conversationId,
      42,
      "https://github.test/octo/project/issues/42",
    );
    await repository.completePromotion(conversationId);
    await expect(
      repository.get(conversationId, 7, ["123"]),
    ).resolves.toMatchObject({
      status: "promoted",
      promotedIssueNumber: 42,
      deliveryBrief: brief,
      messages: [
        { role: "user", adapter: "web" },
        { role: "assistant", adapter: "web" },
        { role: "user", adapter: "web" },
        { role: "assistant", adapter: "web" },
      ],
    });
    sqlite.close();
  });
});

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
