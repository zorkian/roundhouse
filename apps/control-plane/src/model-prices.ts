// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

export type ModelRates = readonly [
  input: number,
  cacheRead: number,
  output: number,
  cacheWrite?: number,
];

export interface ModelPrice {
  readonly standard: ModelRates;
  readonly longContext?: {
    readonly inputTokensAbove: number;
    readonly rates: ModelRates;
  };
}

// USD per million tokens. Shared by delivery attempts, conversations, and the
// usage page so write-path and read-path estimates stay aligned.
export const modelPrices: Readonly<Record<string, ModelPrice>> = {
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

export function resolveModelPrice(input: {
  readonly model: string;
  readonly configuredModel?: string;
  readonly provider?: string;
}): { readonly price: ModelPrice; readonly provider: string } | undefined {
  const candidates = [
    input.configuredModel,
    input.model,
    input.model.includes("/") ? undefined : `anthropic/${input.model}`,
    input.model.includes("/") ? undefined : `openai/${input.model}`,
    input.model.includes("/") ? undefined : `moonshotai/${input.model}`,
  ].filter((value): value is string => Boolean(value));
  for (const key of candidates) {
    const price = modelPrices[key];
    if (!price) continue;
    const provider =
      input.provider ||
      (key.includes("/") ? key.slice(0, key.indexOf("/")) : "") ||
      (input.configuredModel?.includes("/")
        ? input.configuredModel.slice(0, input.configuredModel.indexOf("/"))
        : "");
    return { price, provider };
  }
  return undefined;
}

export function estimateModelCostUsd(input: {
  readonly model: string;
  readonly configuredModel?: string;
  readonly provider?: string;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly outputTokens?: number;
  readonly directCostUsd?: number;
}): number | undefined {
  if (typeof input.directCostUsd === "number") return input.directCostUsd;
  if (input.inputTokens === undefined || input.outputTokens === undefined)
    return undefined;
  const resolved = resolveModelPrice(input);
  if (!resolved) return undefined;
  const cachedInputTokens = input.cachedInputTokens ?? 0;
  const cacheCreationInputTokens = input.cacheCreationInputTokens ?? 0;
  const totalInputTokens =
    resolved.provider === "anthropic"
      ? input.inputTokens + cachedInputTokens + cacheCreationInputTokens
      : input.inputTokens;
  const rate =
    resolved.price.longContext &&
    totalInputTokens > resolved.price.longContext.inputTokensAbove
      ? resolved.price.longContext.rates
      : resolved.price.standard;
  const uncachedInputTokens =
    resolved.provider === "anthropic"
      ? input.inputTokens
      : Math.max(
          0,
          input.inputTokens - cachedInputTokens - cacheCreationInputTokens,
        );
  return (
    (uncachedInputTokens * rate[0] +
      cachedInputTokens * rate[1] +
      cacheCreationInputTokens * (rate[3] ?? rate[0]) +
      input.outputTokens * rate[2]) /
    1_000_000
  );
}
