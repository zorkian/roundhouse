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
  const usage = totalUsage(items);
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
  readonly days: readonly ModelUsageDay[];
  readonly callsWithoutTokens: number;
  readonly callsWithoutCost: number;
}

const dayMilliseconds = 24 * 60 * 60_000;

// Aggregates the authorized model calls inside the rolling window
// [endAt - days, endAt] (start inclusive, end inclusive) by actual model and
// by UTC day. Missing token or cost values stay missing in the totals rather
// than being treated as zero.
export function summarizeModelUsage(
  calls: readonly (ModelUsage & { readonly createdAt?: number })[],
  endAt: number,
  days = 30,
): ModelUsageSummary {
  const startAt = endAt - days * dayMilliseconds;
  const inWindow = calls.filter(
    (call) =>
      typeof call.createdAt === "number" &&
      call.createdAt >= startAt &&
      call.createdAt <= endAt,
  );
  const byModel = new Map<string, ModelUsage[]>();
  for (const call of inWindow) {
    const group = byModel.get(call.model) ?? [];
    group.push(call);
    byModel.set(call.model, group);
  }
  const buckets: {
    startedAt: number;
    tokensByModel: Record<string, number>;
    callsWithoutTokens: number;
  }[] = Array.from({ length: days }, (_, index) => ({
    startedAt: startAt + index * dayMilliseconds,
    tokensByModel: {},
    callsWithoutTokens: 0,
  }));
  for (const call of inWindow) {
    const index = Math.min(
      days - 1,
      Math.max(0, Math.floor((call.createdAt! - startAt) / dayMilliseconds)),
    );
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
