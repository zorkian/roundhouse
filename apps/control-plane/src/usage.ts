// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ModelUsage } from "@roundhouse/core";

export interface UsageTotal {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

type ModelRates = readonly [
  input: number,
  cacheRead: number,
  output: number,
  cacheWrite?: number,
];
interface ModelPrice {
  readonly standard: ModelRates;
  readonly longContext?: {
    readonly inputTokensAbove: number;
    readonly rates: ModelRates;
  };
}

// Keep in sync with write-path pricing in attempt-container. Missing stored
// costUsd values are estimated from these rates when token fields allow.
const modelPrices: Readonly<Record<string, ModelPrice>> = {
  "anthropic/claude-opus-4.8": { standard: [5, 0.5, 25, 6.25] },
  "anthropic/claude-fable-5": { standard: [10, 1, 50, 12.5] },
  "anthropic/claude-opus-5": { standard: [5, 0.5, 25, 6.25] },
  "anthropic/claude-sonnet-5": { standard: [2, 0.2, 10, 2.5] },
  "moonshotai/kimi-k3": { standard: [3, 0.3, 15] },
  "openai/gpt-5": { standard: [1.25, 0.125, 10] },
  "openai/gpt-5.2": { standard: [1.75, 0.175, 14] },
  "openai/gpt-5.6-sol": {
    standard: [5, 0.5, 30, 6.25],
    longContext: {
      inputTokensAbove: 272_000,
      rates: [10, 1, 45, 12.5],
    },
  },
  "openai/gpt-5.6-terra": {
    standard: [2, 0.2, 12, 2.5],
    longContext: {
      inputTokensAbove: 272_000,
      rates: [4, 0.4, 18, 5],
    },
  },
  "openai/gpt-5.6-luna": {
    standard: [0.2, 0.02, 1.2, 0.25],
    longContext: {
      inputTokensAbove: 272_000,
      rates: [0.4, 0.04, 1.8, 0.5],
    },
  },
};

function resolveModelPrice(
  call: Pick<ModelUsage, "model" | "configuredModel" | "provider">,
): { readonly price: ModelPrice; readonly provider: string } | undefined {
  const candidates = [
    call.configuredModel,
    call.model,
    call.model.includes("/") ? undefined : `anthropic/${call.model}`,
    call.model.includes("/") ? undefined : `openai/${call.model}`,
    call.model.includes("/") ? undefined : `moonshotai/${call.model}`,
  ].filter((value): value is string => Boolean(value));
  for (const key of candidates) {
    const price = modelPrices[key];
    if (!price) continue;
    const provider =
      call.provider ||
      (key.includes("/") ? key.slice(0, key.indexOf("/")) : "") ||
      (call.configuredModel?.includes("/")
        ? call.configuredModel.slice(0, call.configuredModel.indexOf("/"))
        : "");
    return { price, provider };
  }
  return undefined;
}

// Prefer a stored cost. Otherwise estimate from known rates when input and
// output token counts are present. Total-token-only rows stay unpriced.
export function estimateUsageCostUsd(call: ModelUsage): number | undefined {
  if (typeof call.costUsd === "number") return call.costUsd;
  if (call.inputTokens === undefined || call.outputTokens === undefined)
    return undefined;
  const resolved = resolveModelPrice(call);
  if (!resolved) return undefined;
  const cachedInputTokens = call.cachedInputTokens ?? 0;
  const cacheCreationInputTokens = call.cacheCreationInputTokens ?? 0;
  const totalInputTokens =
    resolved.provider === "anthropic"
      ? call.inputTokens + cachedInputTokens + cacheCreationInputTokens
      : call.inputTokens;
  const rate =
    resolved.price.longContext &&
    totalInputTokens > resolved.price.longContext.inputTokensAbove
      ? resolved.price.longContext.rates
      : resolved.price.standard;
  const uncachedInputTokens =
    resolved.provider === "anthropic"
      ? call.inputTokens
      : Math.max(
          0,
          call.inputTokens - cachedInputTokens - cacheCreationInputTokens,
        );
  return (
    (uncachedInputTokens * rate[0] +
      cachedInputTokens * rate[1] +
      cacheCreationInputTokens * (rate[3] ?? rate[0]) +
      call.outputTokens * rate[2]) /
    1_000_000
  );
}

export function withEstimatedUsageCost(call: ModelUsage): ModelUsage {
  if (typeof call.costUsd === "number") return call;
  const costUsd = estimateUsageCostUsd(call);
  return costUsd === undefined ? call : { ...call, costUsd };
}

export function totalUsage(items: readonly ModelUsage[]): UsageTotal {
  const sum = (key: keyof UsageTotal) => {
    const values = items
      .map((item) => item[key])
      .filter((item): item is number => typeof item === "number");
    return values.length === items.length && items.length
      ? values.reduce((a, b) => a + b, 0)
      : undefined;
  };
  return {
    inputTokens: sum("inputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    cacheCreationInputTokens: sum("cacheCreationInputTokens"),
    reasoningTokens: sum("reasoningTokens"),
    outputTokens: sum("outputTokens"),
    totalTokens: sum("totalTokens"),
    costUsd: sum("costUsd"),
  };
}
export function formatUsage(items: readonly ModelUsage[]): string {
  const usage = totalUsage(items.map(withEstimatedUsageCost));
  if (!items.length) return "Usage unavailable";
  const token = (value: number | undefined) =>
    value === undefined ? "unavailable" : value.toLocaleString("en-US");
  const cost =
    usage.costUsd === undefined
      ? "Cost unavailable"
      : `$${usage.costUsd.toFixed(2)}`;
  return `${token(usage.totalTokens)} tokens · ${cost}`;
}

export interface ModelUsageModelTotal {
  readonly model: string;
  readonly calls: number;
  readonly total: UsageTotal;
}

export interface ModelUsageSourceTotal {
  readonly source: "delivery" | "conversation";
  readonly calls: number;
  readonly total: UsageTotal;
}

export interface ModelUsageDay {
  readonly day: string;
  readonly startedAt: number;
  // Tokens per actual model for this day; calls without token data are
  // excluded from the chart buckets and counted separately instead of being
  // silently treated as zero.
  readonly tokensByModel: Readonly<Record<string, number>>;
  readonly callsWithoutTokens: number;
}

export interface ModelUsageSummary {
  readonly startAt: number;
  readonly endAt: number;
  readonly calls: number;
  readonly overall: UsageTotal;
  readonly models: readonly ModelUsageModelTotal[];
  readonly sources: readonly ModelUsageSourceTotal[];
  readonly days: readonly ModelUsageDay[];
  readonly callsWithoutTokens: number;
  readonly callsWithoutCost: number;
}

const dayMilliseconds = 24 * 60 * 60_000;

// Aggregates the authorized model calls inside the rolling window
// [endAt - days, endAt] (start inclusive, end inclusive) by actual model and
// by UTC day. Missing token values stay missing. Missing costs are estimated
// from known rates when input and output token counts are present.
export function summarizeModelUsage(
  calls: readonly (ModelUsage & {
    readonly createdAt?: number;
    readonly source?: "delivery" | "conversation";
  })[],
  endAt: number,
  days = 30,
): ModelUsageSummary {
  const startAt = endAt - days * dayMilliseconds;
  const inWindow = calls
    .filter(
      (call) =>
        typeof call.createdAt === "number" &&
        call.createdAt >= startAt &&
        call.createdAt <= endAt,
    )
    .map((call) => ({
      ...call,
      ...withEstimatedUsageCost(call),
    }));
  const byModel = new Map<string, ModelUsage[]>();
  const bySource = new Map<"delivery" | "conversation", ModelUsage[]>();
  for (const call of inWindow) {
    const group = byModel.get(call.model) ?? [];
    group.push(call);
    byModel.set(call.model, group);
    const source = call.source ?? "delivery";
    const sourceGroup = bySource.get(source) ?? [];
    sourceGroup.push(call);
    bySource.set(source, sourceGroup);
  }
  // Bucket by UTC calendar date so each bar matches its visible date label.
  // The exact rolling window can touch up to `days + 1` partial edge dates.
  const firstDay = Math.floor(startAt / dayMilliseconds);
  const lastDay = Math.floor(endAt / dayMilliseconds);
  const buckets: {
    startedAt: number;
    tokensByModel: Record<string, number>;
    callsWithoutTokens: number;
  }[] = Array.from({ length: lastDay - firstDay + 1 }, (_, index) => ({
    startedAt: (firstDay + index) * dayMilliseconds,
    tokensByModel: {},
    callsWithoutTokens: 0,
  }));
  for (const call of inWindow) {
    const index = Math.floor(call.createdAt! / dayMilliseconds) - firstDay;
    const bucket = buckets[index]!;
    if (typeof call.totalTokens === "number") {
      bucket.tokensByModel[call.model] =
        (bucket.tokensByModel[call.model] ?? 0) + call.totalTokens;
    } else {
      bucket.callsWithoutTokens += 1;
    }
  }
  return {
    startAt,
    endAt,
    calls: inWindow.length,
    overall: totalUsage(inWindow),
    models: [...byModel.entries()]
      .map(([model, items]) => ({
        model,
        calls: items.length,
        total: totalUsage(items),
      }))
      .sort((a, b) => a.model.localeCompare(b.model)),
    sources: (["conversation", "delivery"] as const)
      .filter((source) => bySource.has(source))
      .map((source) => ({
        source,
        calls: bySource.get(source)!.length,
        total: totalUsage(bySource.get(source)!),
      })),
    days: buckets.map((bucket) => ({
      day: new Date(bucket.startedAt).toISOString().slice(0, 10),
      startedAt: bucket.startedAt,
      tokensByModel: bucket.tokensByModel,
      callsWithoutTokens: bucket.callsWithoutTokens,
    })),
    callsWithoutTokens: inWindow.filter(
      (call) => typeof call.totalTokens !== "number",
    ).length,
    callsWithoutCost: inWindow.filter(
      (call) => typeof call.costUsd !== "number",
    ).length,
  };
}

export function formatUsageBreakdown(items: readonly ModelUsage[]): string {
  const usage = totalUsage(items);
  if (!items.length) return "Usage unavailable";
  const token = (value: number | undefined) =>
    value === undefined ? "unavailable" : value.toLocaleString("en-US");
  return `${token(usage.inputTokens)} input, ${token(usage.cachedInputTokens)} cached input, ${token(usage.cacheCreationInputTokens)} cache creation input, ${token(usage.reasoningTokens)} reasoning, ${token(usage.outputTokens)} output`;
}
