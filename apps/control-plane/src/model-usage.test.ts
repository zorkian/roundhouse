// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { ModelUsage } from "@roundhouse/core";
import { summarizeModelUsage } from "./usage.js";
import { renderModelUsage } from "./model-usage.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";

const day = 24 * 60 * 60_000;
const endAt = Date.UTC(2026, 5, 15, 12, 0, 0);

const call = (
  model: string,
  createdAt: number,
  extra: Partial<ModelUsage> = {},
): ModelUsage & { createdAt: number } => ({
  callId: `call_${model}_${createdAt}`,
  attemptId: "attempt_1",
  model,
  createdAt,
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  costUsd: 0.01,
  ...extra,
});

describe("summarizeModelUsage", () => {
  it("includes calls at the window start and end and excludes older calls", () => {
    const summary = summarizeModelUsage(
      [
        call("gpt-5", endAt - 30 * day),
        call("gpt-5", endAt),
        call("gpt-5", endAt - 30 * day - 1),
        call("gpt-5", endAt + 1),
      ],
      endAt,
    );
    expect(summary.calls).toBe(2);
    expect(summary.startAt).toBe(endAt - 30 * day);
    expect(summary.endAt).toBe(endAt);
  });

  it("aggregates totals per actual model and overall", () => {
    const summary = summarizeModelUsage(
      [
        call("claude-a", endAt - day, { totalTokens: 100, costUsd: 1 }),
        call("claude-a", endAt - 2 * day, { totalTokens: 50, costUsd: 0.5 }),
        call("gpt-5", endAt - day, { totalTokens: 25, costUsd: 0.25 }),
      ],
      endAt,
    );
    expect(summary.calls).toBe(3);
    expect(summary.overall.totalTokens).toBe(175);
    expect(summary.overall.costUsd).toBe(1.75);
    expect(summary.models).toEqual([
      {
        model: "claude-a",
        calls: 2,
        succeededCalls: 0,
        failedCalls: 0,
        unknownOutcomeCalls: 2,
        resolvedEffort: "unknown",
        total: expect.objectContaining({ totalTokens: 150, costUsd: 1.5 }),
      },
      {
        model: "gpt-5",
        calls: 1,
        succeededCalls: 0,
        failedCalls: 0,
        unknownOutcomeCalls: 1,
        resolvedEffort: "unknown",
        total: expect.objectContaining({ totalTokens: 25, costUsd: 0.25 }),
      },
    ]);
  });

  it("aggregates canonical conversation and delivery identities with the same price", () => {
    const summary = summarizeModelUsage(
      [
        {
          ...call("openai/gpt-5.6-sol", endAt - day, {
            inputTokens: 1_000,
            outputTokens: 100,
            totalTokens: 1_100,
            costUsd: undefined,
          }),
          source: "delivery" as const,
        },
        {
          ...call("openai/gpt-5.6-sol", endAt - day, {
            inputTokens: 1_000,
            outputTokens: 100,
            totalTokens: 1_100,
            costUsd: undefined,
          }),
          source: "conversation" as const,
        },
      ],
      endAt,
    );
    expect(summary.models).toEqual([
      {
        model: "openai/gpt-5.6-sol",
        calls: 2,
        succeededCalls: 0,
        failedCalls: 0,
        unknownOutcomeCalls: 2,
        resolvedEffort: "unknown",
        total: expect.objectContaining({ costUsd: 0.016 }),
      },
    ]);
    expect(summary.sources).toEqual([
      expect.objectContaining({
        source: "conversation",
        total: expect.objectContaining({ costUsd: 0.008 }),
      }),
      expect.objectContaining({
        source: "delivery",
        total: expect.objectContaining({ costUsd: 0.008 }),
      }),
    ]);
  });

  it("separates conversation cost from delivery-run cost", () => {
    const summary = summarizeModelUsage(
      [
        {
          ...call("gpt-5", endAt - day, { totalTokens: 100, costUsd: 1 }),
          source: "conversation" as const,
        },
        {
          ...call("gpt-5", endAt - day, { totalTokens: 50, costUsd: 0.5 }),
          source: "delivery" as const,
        },
      ],
      endAt,
    );
    expect(summary.sources).toEqual([
      {
        source: "conversation",
        calls: 1,
        succeededCalls: 0,
        failedCalls: 0,
        unknownOutcomeCalls: 1,
        total: expect.objectContaining({ totalTokens: 100, costUsd: 1 }),
      },
      {
        source: "delivery",
        calls: 1,
        succeededCalls: 0,
        failedCalls: 0,
        unknownOutcomeCalls: 1,
        total: expect.objectContaining({ totalTokens: 50, costUsd: 0.5 }),
      },
    ]);
    const html = renderModelUsage(summary, { githubLogin: "octocat" });
    expect(html).toContain("Conversation and delivery usage");
    expect(html).toContain("Conversations");
    expect(html).toContain("Delivery runs");
  });

  it("keeps totals unavailable when any call lacks the value", () => {
    const summary = summarizeModelUsage(
      [
        call("gpt-5", endAt - day, { totalTokens: 100, costUsd: 1 }),
        call("gpt-5", endAt - day, {
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
          costUsd: undefined,
        }),
      ],
      endAt,
    );
    expect(summary.overall.totalTokens).toBeUndefined();
    expect(summary.overall.costUsd).toBeUndefined();
    expect(summary.callsWithoutTokens).toBe(1);
    expect(summary.callsWithoutCost).toBe(1);
    const claudeFree = summary.models.find((model) => model.model === "gpt-5");
    expect(claudeFree?.total.totalTokens).toBeUndefined();
    // The chart still reflects the known tokens and discloses the missing call.
    const charted = summary.days.reduce(
      (total, day) => total + (day.tokensByModel["gpt-5 · unknown"] ?? 0),
      0,
    );
    expect(charted).toBe(100);
  });

  it("estimates missing cost from canonical model identities", () => {
    const summary = summarizeModelUsage(
      [
        call("anthropic/claude-sonnet-5", endAt - day, {
          provider: "anthropic",
          configuredModel: "anthropic/claude-sonnet-5",
          inputTokens: 1000,
          cachedInputTokens: 0,
          outputTokens: 100,
          totalTokens: 1100,
          costUsd: undefined,
        }),
        call("anthropic/claude-sonnet-5", endAt - day, {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          costUsd: undefined,
        }),
      ],
      endAt,
    );
    const model = summary.models.find(
      (entry) => entry.model === "anthropic/claude-sonnet-5",
    );
    // (1000*2 + 100*10)/1e6 + (10*2 + 5*10)/1e6
    expect(model?.total.costUsd).toBeCloseTo(0.00307);
    expect(summary.overall.costUsd).toBeCloseTo(0.00307);
    expect(summary.callsWithoutCost).toBe(0);
  });

  it("builds UTC calendar-date buckets with per-model tokens", () => {
    const summary = summarizeModelUsage(
      [call("gpt-5", endAt - 5 * day, { totalTokens: 40 })],
      endAt,
    );
    // The rolling window runs noon to noon, so it spans 31 calendar dates.
    expect(summary.days).toHaveLength(31);
    const bucket = summary.days.find(
      (day) => (day.tokensByModel["gpt-5 · unknown"] ?? 0) > 0,
    );
    expect(bucket?.tokensByModel["gpt-5 · unknown"]).toBe(40);
    // The bucket label is the exact UTC date of the call.
    expect(bucket?.day).toBe(
      new Date(endAt - 5 * day).toISOString().slice(0, 10),
    );
  });

  it("groups absent effort as unknown in legacy-only and mixed windows", () => {
    const legacyCalls = [
      call("openai/gpt-5", endAt - day, {
        latencyMs: 250,
        reasoningTokens: 2,
        outputTokens: 10,
      }),
    ];
    const legacyOnly = summarizeModelUsage(legacyCalls, endAt);
    expect(legacyOnly.models).toEqual([
      expect.objectContaining({
        model: "openai/gpt-5",
        resolvedEffort: "unknown",
        averageLatencyMs: 250,
        reasoningTokenShare: 0.2,
      }),
    ]);
    expect(legacyOnly.efforts).toEqual(["unknown"]);

    const calls = [
      call("openai/gpt-5", endAt - day, {
        resolvedEffort: "high",
        latencyMs: 100,
        reasoningTokens: 2,
        outputTokens: 10,
      }),
      call("openai/gpt-5", endAt - day, {
        resolvedEffort: "max",
        latencyMs: 300,
        reasoningTokens: 5,
        outputTokens: 10,
      }),
      call("openai/gpt-5", endAt - day, {
        latencyMs: 250,
        reasoningTokens: 2,
        outputTokens: 10,
      }),
    ];
    const summary = summarizeModelUsage(calls, endAt);
    expect(summary.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "openai/gpt-5",
          resolvedEffort: "high",
          averageLatencyMs: 100,
          reasoningTokenShare: 0.2,
        }),
        expect.objectContaining({
          model: "openai/gpt-5",
          resolvedEffort: "max",
          averageLatencyMs: 300,
          reasoningTokenShare: 0.5,
        }),
        expect.objectContaining({
          model: "openai/gpt-5",
          resolvedEffort: "unknown",
          averageLatencyMs: 250,
          reasoningTokenShare: 0.2,
        }),
      ]),
    );
    const unknownOnly = summarizeModelUsage(calls, endAt, 30, "unknown");
    expect(unknownOnly.calls).toBe(1);
    expect(unknownOnly.models).toEqual([
      expect.objectContaining({ resolvedEffort: "unknown" }),
    ]);
    expect(summarizeModelUsage(calls, endAt, 30, "high").calls).toBe(1);
    const html = renderModelUsage(summary, { githubLogin: "octocat" });
    expect(html).toContain("Effort is explanatory metadata");
    expect(html).toContain("Unknown (not recorded)");
    expect(html).toContain("Reasoning share");
  });

  it("does not render a reasoning share when known output tokens sum to zero", () => {
    const summary = summarizeModelUsage(
      [
        call("openai/gpt-5", endAt - day, {
          reasoningTokens: 4,
          outputTokens: 0,
          totalTokens: 10,
        }),
      ],
      endAt,
    );
    expect(summary.models[0]).toMatchObject({ resolvedEffort: "unknown" });
    expect(summary.models[0]).not.toHaveProperty("reasoningTokenShare");
    const html = renderModelUsage(summary, { githubLogin: "octocat" });
    expect(html).toContain("unavailable");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("keeps terminal outcomes separate from token totals", () => {
    const summary = summarizeModelUsage(
      [
        call("openai/gpt-5", endAt - day, { outcome: "succeeded" }),
        call("openai/gpt-5", endAt - day, {
          outcome: "failed",
          totalTokens: undefined,
          costUsd: undefined,
        }),
        call("openai/gpt-5", endAt - day),
      ],
      endAt,
    );
    expect(summary).toMatchObject({
      calls: 3,
      succeededCalls: 1,
      failedCalls: 1,
      unknownOutcomeCalls: 1,
      overall: { totalTokens: undefined, costUsd: 0.0200625 },
    });
    expect(renderModelUsage(summary, { githubLogin: "octocat" })).toContain(
      "1 succeeded · 1 failed · 1 unknown",
    );
  });

  it("reports an empty window without collapsing totals to zero", () => {
    const summary = summarizeModelUsage([], endAt);
    expect(summary.calls).toBe(0);
    expect(summary.models).toEqual([]);
    expect(summary.overall.totalTokens).toBeUndefined();
    expect(summary.days).toHaveLength(31);
    expect(renderModelUsage(summary, { githubLogin: "octocat" })).toContain(
      "0 recorded",
    );
  });
});

describe("renderModelUsage", () => {
  it("renders the range, totals, per-model table, and accessible chart", () => {
    const summary = summarizeModelUsage(
      [
        call("claude-a", endAt - day, { totalTokens: 150, costUsd: 1.5 }),
        call("gpt-5", endAt - 2 * day, { totalTokens: 25, costUsd: 0.25 }),
      ],
      endAt,
    );
    const html = renderModelUsage(summary, {
      githubUserId: 7,
      githubLogin: "octocat",
    });
    expect(html).toContain("Model usage");
    expect(html).toContain(new Date(summary.startAt).toISOString());
    expect(html).toContain(new Date(summary.endAt).toISOString());
    expect(html).toContain("175");
    expect(html).toContain("$1.75");
    expect(html).toContain("claude-a");
    expect(html).toContain("gpt-5");
    expect(html).toContain("<svg");
    expect(html).toContain("Daily tokens used per model");
    expect(html).toContain('class="legend"');
    expect(html.match(/class="table-scroll"/g)).toHaveLength(2);
    expect(html).toContain("scroll horizontally to view all columns");
    expect(html).toContain("aria-label");
    expect(html).toContain("Usage by accounting model for the past 30 days");
    expect(html).toContain('<a href="/">Runs</a>');
    expect(html).toContain('src="https://avatars.githubusercontent.com/u/7"');
    expect(html).toContain(`alt="octocat's GitHub avatar"`);
    expect(html).toContain('<span class="site-login">octocat</span>');
  });

  it("discloses partial token and cost data instead of treating it as zero", () => {
    const summary = summarizeModelUsage(
      [
        call("gpt-5", endAt - day, { totalTokens: 100, costUsd: 1 }),
        call("gpt-5", endAt - day, {
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
          costUsd: undefined,
        }),
      ],
      endAt,
    );
    const html = renderModelUsage(summary, { githubLogin: "octocat" });
    expect(html).toContain("token totals are partial");
    expect(html).toContain("cost totals are partial");
    expect(html).toContain("not shown in the chart");
    expect(html).toContain(
      '<th scope="row">Delivery runs</th><td>2</td><td>2 unknown</td><td>unavailable (partial data)</td><td>unavailable (partial data)</td>',
    );
  });

  it("renders a clear empty state with the covered range", () => {
    const summary = summarizeModelUsage([], endAt);
    const html = renderModelUsage(summary, { githubLogin: "octocat" });
    expect(html).toContain("No model usage was recorded in this 30-day window");
    expect(html).toContain(new Date(summary.startAt).toISOString());
    expect(html).not.toContain("<svg");
  });
});

describe("usageForRepositories", () => {
  const statementStub = (
    onBind: (values: unknown[]) => void,
    results: unknown[] = [],
  ): D1Like => ({
    batch: async () => [],
    prepare(_sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind: (...bound: unknown[]) => {
          values = bound;
          onBind(values);
          return statement;
        },
        first: async () => null,
        run: async () => ({ meta: {} }),
        all: async () => ({ meta: {}, results }),
      };
      return statement as unknown as ReturnType<D1Like["prepare"]>;
    },
  });

  it("filters by time bounds and authorized GitHub repository IDs", async () => {
    let bound: unknown[] = [];
    const repository = new D1RunRepository(
      statementStub((values) => {
        bound = values;
      }),
    );
    await repository.usageForRepositories(["111", "222"], 1000, 2000);
    expect(bound).toEqual([1000, 2000, "111", "222"]);
  });

  it("returns immediately for an empty authorization set", async () => {
    let prepared = false;
    const repository = new D1RunRepository({
      prepare() {
        prepared = true;
        throw new Error("should not query");
      },
    } as unknown as D1Like);
    await expect(
      repository.usageForRepositories([], 1000, 2000),
    ).resolves.toEqual([]);
    expect(prepared).toBe(false);
  });

  it("maps rows to model usage with nullable fields preserved", async () => {
    const repository = new D1RunRepository(
      statementStub(() => {}, [
        {
          call_id: "call_1",
          attempt_id: "attempt_1",
          model: "gpt-5",
          provider: null,
          configured_model: null,
          routing_rule: null,
          input_tokens: 10,
          cached_input_tokens: null,
          cache_creation_input_tokens: null,
          reasoning_tokens: null,
          output_tokens: 5,
          total_tokens: 15,
          cost_usd: null,
          created_at: 1234,
        },
      ]),
    );
    const usage = await repository.usageForRepositories(["111"], 1000, 2000);
    expect(usage).toEqual([
      expect.objectContaining({
        callId: "call_1",
        model: "gpt-5",
        totalTokens: 15,
        createdAt: 1234,
      }),
    ]);
    expect(usage[0]).not.toHaveProperty("costUsd");
  });
});
