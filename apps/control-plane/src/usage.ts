// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ModelUsage } from "@roundhouse/core";

export interface UsageTotal {
  inputTokens?: number;
  cachedInputTokens?: number;
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
      : `$${usage.costUsd.toFixed(6)}`;
  return `${token(usage.totalTokens)} tokens (${token(usage.inputTokens)} input, ${token(usage.cachedInputTokens)} cached input, ${token(usage.reasoningTokens)} reasoning, ${token(usage.outputTokens)} output) · ${cost}`;
}
