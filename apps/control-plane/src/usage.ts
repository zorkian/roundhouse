// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ModelUsage } from "@roundhouse/core";
import { estimateModelCostUsd } from "./model-prices.js";

export interface UsageTotal {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

// Prefer a stored cost. Otherwise estimate from known rates when input and
// output token counts are present. Reasoning is already part of output usage.
export function estimateUsageCostUsd(call: ModelUsage): number | undefined {
  return estimateModelCostUsd({
    model: call.model,
    configuredModel: call.configuredModel,
    provider: call.provider,
    inputTokens: call.inputTokens,
    cachedInputTokens: call.cachedInputTokens,
    cacheCreationInputTokens: call.cacheCreationInputTokens,
    outputTokens: call.outputTokens,
    directCostUsd: call.costUsd,
  });
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
  return `${token(usage.totalTokens)} tokens · ${usage.costUsd === undefined ? "Cost unavailable" : `$${usage.costUsd.toFixed(2)}`}`;
}

export interface ModelUsageModelTotal {
  readonly model: string;
  readonly calls: number;
  readonly succeededCalls: number;
  readonly failedCalls: number;
  readonly unknownOutcomeCalls: number;
  readonly total: UsageTotal;
  // `unknown` means a legacy row or provider response did not record effort.
  readonly resolvedEffort: string;
  readonly averageLatencyMs?: number;
  readonly latencyCalls?: number;
  readonly reasoningTokenShare?: number;
  readonly reasoningCalls?: number;
}
export interface ModelUsageSourceTotal {
  readonly source: "delivery" | "conversation";
  readonly calls: number;
  readonly succeededCalls: number;
  readonly failedCalls: number;
  readonly unknownOutcomeCalls: number;
  readonly total: UsageTotal;
}
export interface ModelUsageDay {
  readonly day: string;
  readonly startedAt: number;
  readonly tokensByModel: Readonly<Record<string, number>>;
  readonly callsWithoutTokens: number;
}
export interface ModelUsageSummary {
  readonly startAt: number;
  readonly endAt: number;
  readonly calls: number;
  readonly succeededCalls: number;
  readonly failedCalls: number;
  readonly unknownOutcomeCalls: number;
  readonly overall: UsageTotal;
  readonly models: readonly ModelUsageModelTotal[];
  readonly sources: readonly ModelUsageSourceTotal[];
  readonly days: readonly ModelUsageDay[];
  readonly callsWithoutTokens: number;
  readonly callsWithoutCost: number;
  readonly effort?: string;
  readonly efforts: readonly string[];
}
const dayMilliseconds = 24 * 60 * 60_000;
type TimedUsage = ModelUsage & {
  readonly createdAt?: number;
  readonly source?: "delivery" | "conversation";
};
const effortLabel = (call: Pick<ModelUsage, "resolvedEffort">) =>
  call.resolvedEffort ?? "unknown";
const groupLabel = (
  call: Pick<ModelUsage, "model" | "resolvedEffort">,
): string => `${call.model} · ${effortLabel(call)}`;
function metrics(items: readonly ModelUsage[]) {
  const latency = items.filter((item) => typeof item.latencyMs === "number");
  const reasoning = items.filter(
    (item) =>
      typeof item.reasoningTokens === "number" &&
      typeof item.outputTokens === "number",
  );
  const reasoningOutputTokens = reasoning.reduce(
    (sum, item) => sum + item.outputTokens!,
    0,
  );
  return {
    ...(latency.length
      ? {
          averageLatencyMs:
            latency.reduce((sum, item) => sum + item.latencyMs!, 0) /
            latency.length,
          latencyCalls: latency.length,
        }
      : {}),
    ...(reasoning.length && reasoningOutputTokens > 0
      ? {
          reasoningTokenShare:
            reasoning.reduce((sum, item) => sum + item.reasoningTokens!, 0) /
            reasoningOutputTokens,
          reasoningCalls: reasoning.length,
        }
      : {}),
  };
}

function outcomes(items: readonly ModelUsage[]) {
  let succeededCalls = 0;
  let failedCalls = 0;
  let unknownOutcomeCalls = 0;
  for (const item of items) {
    if (item.outcome === "succeeded") succeededCalls += 1;
    else if (item.outcome === "failed") failedCalls += 1;
    else unknownOutcomeCalls += 1;
  }
  return { succeededCalls, failedCalls, unknownOutcomeCalls };
}

// Aggregates by actual model and resolved effort. The `unknown` effort bucket
// represents historical rows and providers that did not report enough detail.
export function summarizeModelUsage(
  calls: readonly TimedUsage[],
  endAt: number,
  days = 30,
  effort?: string,
): ModelUsageSummary {
  const startAt = endAt - days * dayMilliseconds;
  const windowed = calls.filter(
    (call) =>
      typeof call.createdAt === "number" &&
      call.createdAt >= startAt &&
      call.createdAt <= endAt,
  );
  const inWindow = windowed
    .filter((call) => effort === undefined || effortLabel(call) === effort)
    .map((call) => ({ ...call, ...withEstimatedUsageCost(call) }));
  const byModel = new Map<string, ModelUsage[]>();
  const bySource = new Map<"delivery" | "conversation", ModelUsage[]>();
  for (const call of inWindow) {
    const key = groupLabel(call);
    byModel.set(key, [...(byModel.get(key) ?? []), call]);
    const source = call.source ?? "delivery";
    bySource.set(source, [...(bySource.get(source) ?? []), call]);
  }
  const firstDay = Math.floor(startAt / dayMilliseconds),
    lastDay = Math.floor(endAt / dayMilliseconds);
  const buckets = Array.from(
    { length: lastDay - firstDay + 1 },
    (_, index) => ({
      startedAt: (firstDay + index) * dayMilliseconds,
      tokensByModel: {} as Record<string, number>,
      callsWithoutTokens: 0,
    }),
  );
  for (const call of inWindow) {
    const bucket =
      buckets[Math.floor(call.createdAt! / dayMilliseconds) - firstDay]!;
    if (typeof call.totalTokens === "number") {
      const key = groupLabel(call);
      bucket.tokensByModel[key] =
        (bucket.tokensByModel[key] ?? 0) + call.totalTokens;
    } else bucket.callsWithoutTokens += 1;
  }
  return {
    startAt,
    endAt,
    calls: inWindow.length,
    ...outcomes(inWindow),
    overall: totalUsage(inWindow),
    models: [...byModel.entries()]
      .map(([, items]) => {
        const sample = items[0]!;
        return {
          model: sample.model,
          calls: items.length,
          ...outcomes(items),
          total: totalUsage(items),
          resolvedEffort: effortLabel(sample),
          ...metrics(items),
        };
      })
      .sort((a, b) =>
        `${a.model}\0${a.resolvedEffort}`.localeCompare(
          `${b.model}\0${b.resolvedEffort}`,
        ),
      ),
    sources: (["conversation", "delivery"] as const)
      .filter((source) => bySource.has(source))
      .map((source) => ({
        source,
        calls: bySource.get(source)!.length,
        ...outcomes(bySource.get(source)!),
        total: totalUsage(bySource.get(source)!),
      })),
    days: buckets.map((bucket) => ({
      day: new Date(bucket.startedAt).toISOString().slice(0, 10),
      ...bucket,
    })),
    callsWithoutTokens: inWindow.filter(
      (call) => typeof call.totalTokens !== "number",
    ).length,
    callsWithoutCost: inWindow.filter(
      (call) => typeof call.costUsd !== "number",
    ).length,
    ...(effort === undefined ? {} : { effort }),
    efforts: [...new Set(windowed.map(effortLabel))].sort(),
  };
}
export function formatUsageBreakdown(items: readonly ModelUsage[]): string {
  const usage = totalUsage(items);
  if (!items.length) return "Usage unavailable";
  const token = (value: number | undefined) =>
    value === undefined ? "unavailable" : value.toLocaleString("en-US");
  return `${token(usage.inputTokens)} input, ${token(usage.cachedInputTokens)} cached input, ${token(usage.cacheCreationInputTokens)} cache creation input, ${token(usage.reasoningTokens)} reasoning, ${token(usage.outputTokens)} output`;
}
