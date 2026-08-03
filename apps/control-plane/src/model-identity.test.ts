// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { normalizeModelId } from "./model-identity.js";

describe("normalizeModelId", () => {
  it("is idempotent, preserves qualified IDs, and uses provider before configured model", () => {
    const normalized = normalizeModelId({
      model: "gpt-5.6-sol",
      provider: "openai",
      configuredModel: "anthropic/claude-sonnet-5",
    });
    expect(normalized).toBe("openai/gpt-5.6-sol");
    expect(
      normalizeModelId({
        model: normalized,
        provider: "anthropic",
        configuredModel: "anthropic/claude-sonnet-5",
      }),
    ).toBe(normalized);
  });

  it("falls back to the configured provider and leaves unresolved IDs bare", () => {
    expect(
      normalizeModelId({
        model: "kimi-k3",
        configuredModel: "moonshotai/kimi-k3",
      }),
    ).toBe("moonshotai/kimi-k3");
    expect(normalizeModelId({ model: "unresolved-model" })).toBe(
      "unresolved-model",
    );
  });
});

describe("0020 model usage identity migration", () => {
  it("backfills both usage tables without changing qualified or unresolved rows", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE model_usage (
        id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        provider TEXT,
        configured_model TEXT
      );
      CREATE TABLE conversation_model_usage (
        id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        provider TEXT,
        configured_model TEXT
      );
    `);
    for (const table of ["model_usage", "conversation_model_usage"]) {
      const insert = database.prepare(
        `INSERT INTO ${table} (id,model,provider,configured_model) VALUES (?1,?2,?3,?4)`,
      );
      insert.run(
        "provider",
        "gpt-5.6-sol",
        "openai",
        "anthropic/claude-opus-5",
      );
      insert.run("configured", "kimi-k3", "", "moonshotai/kimi-k3");
      insert.run(
        "qualified",
        "anthropic/claude-opus-5",
        "openai",
        "openai/gpt-5",
      );
      insert.run("unresolved", "unknown-model", "", null);
    }
    database.exec(
      readFileSync(
        new URL(
          "../migrations/0020_normalize_model_usage_ids.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const table of ["model_usage", "conversation_model_usage"]) {
      expect(
        database.prepare(`SELECT id,model FROM ${table} ORDER BY id`).all(),
      ).toEqual([
        { id: "configured", model: "moonshotai/kimi-k3" },
        { id: "provider", model: "openai/gpt-5.6-sol" },
        { id: "qualified", model: "anthropic/claude-opus-5" },
        { id: "unresolved", model: "unknown-model" },
      ]);
    }
    database.close();
  });
});
