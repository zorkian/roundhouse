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
        total: expect.objectContaining({ totalTokens: 150, costUsd: 1.5 }),
      },
      {
        model: "gpt-5",
        calls: 1,
        total: expect.objectContaining({ totalTokens: 25, costUsd: 0.25 }),
      },
    ]);
  });

  it("keeps totals unavailable when any call lacks the value", () => {
    const summary = summarizeModelUsage(
      [
        call("gpt-5", endAt - day, { totalTokens: 100, costUsd: 1 }),
        call("gpt-5", endAt - day, {
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
      (total, day) => total + (day.tokensByModel["gpt-5"] ?? 0),
      0,
    );
    expect(charted).toBe(100);
  });

  it("builds 30 UTC day buckets with per-model tokens", () => {
    const summary = summarizeModelUsage(
      [call("gpt-5", endAt - 5 * day, { totalTokens: 40 })],
      endAt,
    );
    expect(summary.days).toHaveLength(30);
    const bucket = summary.days.find(
      (day) => (day.tokensByModel["gpt-5"] ?? 0) > 0,
    );
    expect(bucket?.tokensByModel["gpt-5"]).toBe(40);
    expect(bucket?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reports an empty window without collapsing totals to zero", () => {
    const summary = summarizeModelUsage([], endAt);
    expect(summary.calls).toBe(0);
    expect(summary.models).toEqual([]);
    expect(summary.overall.totalTokens).toBeUndefined();
    expect(summary.days).toHaveLength(30);
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
    const html = renderModelUsage(summary, { githubLogin: "octocat" });
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
    expect(html).toContain("aria-label");
    expect(html).toContain("Usage by model for the past 30 days");
    expect(html).toContain('<a href="/">Dashboard</a>');
  });

  it("discloses partial token and cost data instead of treating it as zero", () => {
    const summary = summarizeModelUsage(
      [
        call("gpt-5", endAt - day, { totalTokens: 100, costUsd: 1 }),
        call("gpt-5", endAt - day, {
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
