// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { runtimeCapabilitiesForModel } from "@roundhouse/core";
import { describe, expect, it, vi } from "vitest";
import { webConversationAdapter } from "./conversation-adapter.js";
import { D1ConversationRepository } from "./conversation-store.js";
import { processConversationWakeup } from "./conversation-worker.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";
import type { GitHubApi } from "./github.js";

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

describe("conversation Queue worker", () => {
  it("acknowledges a duplicate wakeup while another worker holds the turn lease", async () => {
    const repository = {
      turn: vi.fn(async () => ({ state: "running" })),
      claimTurn: vi.fn(async () => undefined),
      completeWakeup: vi.fn(async () => undefined),
    } as unknown as D1ConversationRepository;
    await expect(
      processConversationWakeup(
        repository,
        {} as never,
        { kind: "turn", id: "turn-1" },
        2,
        new Map(),
      ),
    ).resolves.toBe("ignored");
    expect(repository.completeWakeup).not.toHaveBeenCalled();
  });

  it("fails closed before model access when a repository becomes private", async () => {
    const repository = {
      turn: vi.fn(async () => ({ state: "pending" })),
      claimTurn: vi.fn(async () => ({ id: "turn-1" })),
      getForTurn: vi.fn(async () => ({
        repository: {
          name: "octo/project",
          installationId: 99,
        },
      })),
      failTurn: vi.fn(async () => undefined),
      completeWakeup: vi.fn(async () => undefined),
    } as unknown as D1ConversationRepository;
    const broker = { fetch: vi.fn() };
    await expect(
      processConversationWakeup(
        repository,
        { MODEL_BROKER: broker } as never,
        { kind: "turn", id: "turn-1" },
        1,
        new Map(),
        {
          github: {
            get: vi.fn(async () => ({ private: true })),
          } as unknown as GitHubApi,
        },
      ),
    ).resolves.toBe("completed");
    expect(repository.failTurn).toHaveBeenCalledWith(
      "turn-1",
      "conversation_repository_not_public",
    );
    expect(repository.completeWakeup).toHaveBeenCalledOnce();
    expect(broker.fetch).not.toHaveBeenCalled();
  });

  it("does not persist either first-turn field when structured output is invalid", async () => {
    const route = {
      provider: "openai",
      model: "openai/gpt-5.6-sol",
      protocol: "openai-responses",
      transport: "cloudflare-provider-native",
      thinkingLevel: "high",
      runtime: runtimeCapabilitiesForModel("openai/gpt-5.6-sol"),
      rule: "profile-conversation-v2",
    };
    const repository = {
      turn: vi.fn(async () => ({ state: "pending" })),
      claimTurn: vi.fn(async () => ({
        id: "turn-1",
        kind: "message",
        ordinal: 1,
      })),
      getForTurn: vi.fn(async () => ({
        id: "b1f486ff-7744-49f9-ab78-f74e8409fc2b",
        repository: { name: "octo/project", installationId: 99 },
        sourceCommit: "a".repeat(40),
        profileHash: "b".repeat(64),
        context: {
          model: { id: "openai/gpt-5.6-sol", reasoning: "high" },
          defaultBranch: "main",
        },
        messages: [],
      })),
      renewTurn: vi.fn(async () => true),
      recordTurnRoute: vi.fn(async () => undefined),
      recordModelUsage: vi.fn(async () => undefined),
      completeMessageTurn: vi.fn(async () => true),
      retryTurn: vi.fn(async () => undefined),
    } as unknown as D1ConversationRepository;
    const broker = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce(Response.json(route))
        .mockResolvedValueOnce(
          Response.json({
            output_text: JSON.stringify({
              title: "Too few words",
              reply: "A normal reply.",
            }),
            usage: { total_tokens: 7 },
          }),
        ),
    };
    await expect(
      processConversationWakeup(
        repository,
        { MODEL_BROKER: broker } as never,
        { kind: "turn", id: "turn-1" },
        1,
        new Map(),
        {
          github: {
            get: vi.fn(async () => ({ private: false })),
          } as unknown as GitHubApi,
        },
      ),
    ).resolves.toBe("retry");
    expect(repository.completeMessageTurn).not.toHaveBeenCalled();
    expect(repository.retryTurn).toHaveBeenCalledWith(
      "turn-1",
      "conversation_first_reply_invalid",
    );
  });

  it("turns at-least-once wakeups into one persisted title, reply, and usage calls", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys=ON");
    sqlite.exec(
      "CREATE TABLE repositories (id TEXT PRIMARY KEY, github_id TEXT NOT NULL UNIQUE, profile_version TEXT NOT NULL, profile_json TEXT NOT NULL, created_at INTEGER NOT NULL)",
    );
    sqlite.exec(
      "CREATE TABLE work_items (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL); CREATE TABLE runs (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE attempts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL); CREATE TABLE model_usage (call_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, model TEXT NOT NULL, provider TEXT, configured_model TEXT, routing_rule TEXT, input_tokens INTEGER, cached_input_tokens INTEGER, cache_creation_input_tokens INTEGER, reasoning_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER, cost_usd REAL, created_at INTEGER NOT NULL)",
    );
    sqlite.exec(
      readFileSync(
        new URL("../migrations/0017_conversations.sql", import.meta.url),
        "utf8",
      ),
    );
    sqlite.exec(
      readFileSync(
        new URL("../migrations/0018_conversation_titles.sql", import.meta.url),
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
    const repository = new D1ConversationRepository(
      sqliteD1(sqlite),
      () => 100,
    );
    const conversationId = "b1f486ff-7744-49f9-ab78-f74e8409fc2b";
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
      message: {
        adapter: "roundhouse.web",
        adapterInstallation: "roundhouse.web",
        externalConversationId: conversationId,
        externalMessageId: "external-1",
        verifiedActorId: "7",
        verifiedActorLogin: "octocat",
        body: "Is this a question?",
        sentAt: 100,
      },
    });
    const route = {
      provider: "openai",
      model: "openai/gpt-5.6-sol",
      protocol: "openai-responses",
      transport: "cloudflare-provider-native",
      thinkingLevel: "high",
      runtime: runtimeCapabilitiesForModel("openai/gpt-5.6-sol"),
      rule: "profile-conversation-v2",
    };
    const responses = [
      Response.json(route),
      Response.json({
        id: "response-tool",
        output: [
          {
            type: "function_call",
            name: "read_repository_file",
            arguments: '{"path":"README.md"}',
            call_id: "call-1",
          },
        ],
        usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 },
      }),
      Response.json({
        id: "response-1",
        output_text: JSON.stringify({
          title: "Clarify conversation delivery status",
          reply: "Yes. I have not started delivery.",
        }),
        usage: { input_tokens: 10, output_tokens: 7, total_tokens: 17 },
      }),
    ];
    let responseIndex = 0;
    const broker = {
      fetch: vi.fn(async () => responses[responseIndex++]!.clone()),
    };
    const env = {
      MODEL_BROKER: broker,
      GITHUB_APP_ID: "unused",
      GITHUB_START_COMMAND: "/roundhouse-dev start",
      ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY: "unused",
      ROUNDHOUSE_GITHUB_WEBHOOK_SECRET: "unused",
      ROUNDHOUSE_GITHUB_CLIENT_SECRET: "unused",
      PUBLIC_ORIGIN: "https://roundhouse.example",
      DB: sqliteD1(sqlite),
    };
    const adapters = new Map([
      [webConversationAdapter.name, webConversationAdapter],
    ]);
    const github = {
      get: vi.fn(async (path: string) => {
        if (path === "/repos/octo/project") return { private: false };
        if (path.includes("/contents/README.md"))
          return {
            type: "file",
            encoding: "base64",
            size: 4,
            content: btoa("body"),
          };
        throw new Error(`unexpected_github_path:${path}`);
      }),
    } as unknown as GitHubApi;
    await expect(
      processConversationWakeup(
        repository,
        env as never,
        { kind: "turn", id: "turn-1" },
        1,
        adapters,
        { github },
      ),
    ).resolves.toBe("completed");
    await expect(
      processConversationWakeup(
        repository,
        env as never,
        { kind: "turn", id: "turn-1" },
        2,
        adapters,
        { github },
      ),
    ).resolves.toBe("completed");
    const completed = await repository.get(conversationId, 7, ["123"]);
    expect(completed).not.toHaveProperty("activeTurn");
    expect(completed).toMatchObject({
      title: "Clarify conversation delivery status",
      messages: [
        { role: "user", body: "Is this a question?" },
        { role: "assistant", body: "Yes. I have not started delivery." },
      ],
    });
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM conversation_model_usage")
        .get(),
    ).toEqual({ count: 2 });
    const usage = await new D1RunRepository(
      sqliteD1(sqlite),
    ).usageForRepositories(["123"], 0, Date.now() + 1_000);
    expect(usage).toHaveLength(2);
    expect(usage).toContainEqual(
      expect.objectContaining({
        callId: "response-1",
        source: "conversation",
        totalTokens: 17,
        costUsd: expect.any(Number),
      }),
    );
    expect(broker.fetch).toHaveBeenCalledTimes(3);
    sqlite.close();
  });
});
