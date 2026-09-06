// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFileSync, readdirSync } from "node:fs";
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
    const migrations = new URL("../migrations/", import.meta.url);
    for (const migration of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .sort())
      sqlite.exec(readFileSync(new URL(migration, migrations), "utf8"));
    sqlite
      .prepare(
        "INSERT INTO repositories (id,github_id,profile_version,profile_json,created_at) VALUES (?1,?2,?3,?4,?5)",
      )
      .run(
        "repo-authorized",
        "123",
        "profile",
        JSON.stringify({ repository: "octo/project" }),
        10,
      );
    sqlite
      .prepare(
        "INSERT INTO repositories (id,github_id,profile_version,profile_json,created_at) VALUES (?1,?2,?3,?4,?5)",
      )
      .run(
        "repo-other",
        "456",
        "profile",
        JSON.stringify({ repository: "other/project" }),
        10,
      );
    sqlite
      .prepare(
        "INSERT INTO work_items (id,repository_id,issue_number,current_run_id) VALUES (?1,?2,?3,?4)",
      )
      .run("work-1", "repo-authorized", 42, "run-1");
    sqlite
      .prepare(
        "INSERT INTO runs (id,work_item_id,status,stage,revision,document_json,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
      )
      .run(
        "run-1",
        "work-1",
        "active",
        "implement",
        1,
        JSON.stringify({ id: "run-1" }),
        10,
        10,
      );
    sqlite
      .prepare(
        "INSERT INTO attempts (id,run_id,run_revision,kind,stage,role,state,deadline_at,expected_head,created_at,updated_at) VALUES (?1,?2,1,'agent','implement','writer','completed',100,'head',10,10)",
      )
      .run("attempt-1", "run-1");
    sqlite
      .prepare(
        "INSERT INTO conversations (id,repository_id,creator_github_user_id,creator_github_login,origin_adapter,origin_adapter_installation,origin_external_message_id,status,source_commit,profile_hash,context_json,created_at,updated_at) VALUES (?1,?2,7,'octocat','web','ui','origin','open','head','hash','{}',10,10)",
      )
      .run("conversation-1", "repo-authorized");
    sqlite
      .prepare(
        "INSERT INTO conversation_turns (id,conversation_id,kind,state,source_commit,configured_model,configured_reasoning,ordinal,created_at,updated_at) VALUES ('turn-1','conversation-1','message','succeeded','head','conversation-configured','high',1,10,10)",
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO conversation_model_usage (call_id,provider,conversation_id,turn_id,call_kind,model,configured_model,protocol,reasoning_level,routing_rule,input_tokens,cached_input_tokens,cache_creation_input_tokens,reasoning_tokens,output_tokens,total_tokens,cost_usd,latency_ms,outcome,created_at,requested_effort,resolved_effort,tool_call_count,requested_model,resolved_model,provider_reported_model,provider_reported_effort) VALUES (?1,?2,?3,?4,'conversation',?5,?6,'protocol','high',?7,3,4,5,6,7,16,0.16,21,'succeeded',11,'medium','high',2,?8,?9,?10,?11)",
      )
      .run(
        "conversation-call",
        "conversation-provider",
        "conversation-1",
        "turn-1",
        "conversation-model",
        "conversation-configured",
        "conversation-rule",
        "conversation-requested",
        "conversation-resolved",
        "conversation-reported",
        "conversation-effort",
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
    const otherProvider = { ...delivery, provider: "other-provider" };
    await expect(repository.recordModelUsage(otherProvider)).resolves.toBe(
      "created",
    );

    const details = await repository.detailsByIssue("octo/project", 42, [
      "123",
    ]);
    expect(details?.usage).toContainEqual(expect.objectContaining(delivery));
    expect(details?.usage).toContainEqual(
      expect.objectContaining(otherProvider),
    );
    const authorized = await repository.usageForRepositories(["123"], 0, 20);
    expect(authorized).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ...delivery, source: "delivery" }),
        expect.objectContaining({ ...otherProvider, source: "delivery" }),
        expect.objectContaining({
          callId: "conversation-call",
          source: "conversation",
          requestedModel: "conversation-requested",
          providerReportedEffort: "conversation-effort",
        }),
      ]),
    );
    expect(authorized).toHaveLength(3);
    await expect(
      repository.usageForRepositories(["456"], 0, 20),
    ).resolves.toEqual([]);
    sqlite.close();
  });
});
