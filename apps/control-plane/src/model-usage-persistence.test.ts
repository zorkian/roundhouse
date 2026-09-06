// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { D1RunRepository, type D1Like } from "./d1-store.js";

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

describe("model usage persistence", () => {
  it("round-trips delivery provenance, deduplicates calls, and joins only authorized usage", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE repositories (id TEXT PRIMARY KEY, github_id TEXT NOT NULL, profile_json TEXT NOT NULL);
      CREATE TABLE work_items (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, issue_number INTEGER NOT NULL, current_run_id TEXT);
      CREATE TABLE runs (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL, document_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE attempts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, run_revision INTEGER NOT NULL, kind TEXT NOT NULL, node_id TEXT, executor TEXT, stage TEXT NOT NULL, role TEXT NOT NULL, state TEXT NOT NULL, deadline_at INTEGER NOT NULL, base_commit TEXT NOT NULL, expected_head TEXT NOT NULL, accepted_head TEXT, result_json TEXT, routing_json TEXT, capabilities_json TEXT, outcome_json TEXT, competition_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE events (id INTEGER PRIMARY KEY, run_id TEXT, attempt_id TEXT, kind TEXT, payload_json TEXT, created_at INTEGER);
      CREATE TABLE model_usage (call_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, model TEXT NOT NULL, provider TEXT, requested_model TEXT, resolved_model TEXT, provider_reported_model TEXT, configured_model TEXT, routing_rule TEXT, requested_effort TEXT, resolved_effort TEXT, provider_reported_effort TEXT, outcome TEXT, latency_ms INTEGER, tool_call_count INTEGER, input_tokens INTEGER, cached_input_tokens INTEGER, cache_creation_input_tokens INTEGER, reasoning_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER, cost_usd REAL, created_at INTEGER NOT NULL);
      CREATE TABLE conversations (id TEXT PRIMARY KEY, repository_id TEXT NOT NULL);
      CREATE TABLE conversation_model_usage (call_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, turn_id TEXT NOT NULL, model TEXT NOT NULL, provider TEXT, requested_model TEXT, resolved_model TEXT, provider_reported_model TEXT, configured_model TEXT, routing_rule TEXT, requested_effort TEXT, resolved_effort TEXT, provider_reported_effort TEXT, outcome TEXT, latency_ms INTEGER, tool_call_count INTEGER, input_tokens INTEGER, cached_input_tokens INTEGER, cache_creation_input_tokens INTEGER, reasoning_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER, cost_usd REAL, created_at INTEGER NOT NULL);
    `);
    sqlite
      .prepare("INSERT INTO repositories VALUES (?1,?2,?3)")
      .run(
        "repo-authorized",
        "123",
        JSON.stringify({ repository: "octo/project" }),
      );
    sqlite
      .prepare("INSERT INTO repositories VALUES (?1,?2,?3)")
      .run(
        "repo-other",
        "456",
        JSON.stringify({ repository: "other/project" }),
      );
    sqlite
      .prepare("INSERT INTO work_items VALUES (?1,?2,?3,?4)")
      .run("work-1", "repo-authorized", 42, "run-1");
    sqlite
      .prepare("INSERT INTO runs VALUES (?1,?2,?3,?4,?5)")
      .run("run-1", "work-1", JSON.stringify({ id: "run-1" }), 10, 10);
    sqlite
      .prepare(
        "INSERT INTO attempts VALUES (?1,?2,1,'agent','node','agent','implement','writer','completed',100,'base','head',NULL,NULL,NULL,NULL,NULL,NULL,10,10)",
      )
      .run("attempt-1", "run-1");
    sqlite
      .prepare("INSERT INTO conversations VALUES (?1,?2)")
      .run("conversation-1", "repo-authorized");
    sqlite
      .prepare(
        "INSERT INTO conversation_model_usage VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24)",
      )
      .run(
        "conversation-call",
        "conversation-1",
        "turn-1",
        "conversation-model",
        "conversation-provider",
        "conversation-requested",
        "conversation-resolved",
        "conversation-reported",
        "conversation-configured",
        "conversation-rule",
        "medium",
        "high",
        "conversation-effort",
        "succeeded",
        21,
        2,
        3,
        4,
        5,
        6,
        7,
        16,
        0.16,
        11,
      );

    const repository = new D1RunRepository(sqliteD1(sqlite), () => 10);
    const delivery = {
      callId: "delivery-call",
      attemptId: "attempt-1",
      model: "delivery-accounting",
      provider: "delivery-provider",
      requestedModel: "delivery-requested",
      resolvedModel: "delivery-resolved",
      providerReportedModel: "delivery-reported",
      configuredModel: "delivery-configured",
      routingRule: "delivery-rule",
      requestedEffort: "low" as const,
      resolvedEffort: "max" as const,
      providerReportedEffort: "delivery-effort",
      outcome: "failed" as const,
      latencyMs: 31,
      toolCallCount: 3,
      inputTokens: 4,
      cachedInputTokens: 5,
      cacheCreationInputTokens: 6,
      reasoningTokens: 7,
      outputTokens: 8,
      totalTokens: 19,
      costUsd: 0.19,
    };
    await expect(repository.recordModelUsage(delivery)).resolves.toBe(
      "created",
    );
    await expect(repository.recordModelUsage(delivery)).resolves.toBe("exists");

    const details = await repository.detailsByIssue("octo/project", 42, [
      "123",
    ]);
    expect(details?.usage).toContainEqual(expect.objectContaining(delivery));
    const authorized = await repository.usageForRepositories(["123"], 0, 20);
    expect(authorized).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ...delivery, source: "delivery" }),
        expect.objectContaining({
          callId: "conversation-call",
          source: "conversation",
          requestedModel: "conversation-requested",
          providerReportedEffort: "conversation-effort",
        }),
      ]),
    );
    expect(authorized).toHaveLength(2);
    await expect(
      repository.usageForRepositories(["456"], 0, 20),
    ).resolves.toEqual([]);
    sqlite.close();
  });
});
