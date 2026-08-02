// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

export const modelThinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ModelThinkingLevel = (typeof modelThinkingLevels)[number];
export type ModelThinkingLevelMap = Readonly<
  Partial<Record<ModelThinkingLevel, string | null>>
>;

export interface ModelRuntimeCapabilities {
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly thinkingLevelMap: ModelThinkingLevelMap;
}

const gpt56Capabilities = {
  contextWindow: 1_050_000,
  maxOutputTokens: 128_000,
  thinkingLevelMap: {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
} as const satisfies ModelRuntimeCapabilities;

const claude5Capabilities = {
  contextWindow: 1_000_000,
  maxOutputTokens: 128_000,
  thinkingLevelMap: {
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
} as const satisfies ModelRuntimeCapabilities;

export const modelRuntimeCatalog = {
  "openai/gpt-5.6-sol": gpt56Capabilities,
  "openai/gpt-5.6-terra": gpt56Capabilities,
  "openai/gpt-5.6-luna": gpt56Capabilities,
  "anthropic/claude-fable-5": claude5Capabilities,
  "anthropic/claude-opus-5": claude5Capabilities,
  "anthropic/claude-sonnet-5": claude5Capabilities,
  "google/gemini-3.5-flash": {
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    thinkingLevelMap: {
      off: null,
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: null,
      max: null,
    },
  },
  "moonshotai/kimi-k3": {
    contextWindow: 1_048_576,
    maxOutputTokens: 131_072,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: null,
      high: "high",
      xhigh: null,
      max: "max",
    },
  },
} as const satisfies Readonly<Record<string, ModelRuntimeCapabilities>>;

export function runtimeCapabilitiesForModel(
  model: string,
): ModelRuntimeCapabilities | undefined {
  return (modelRuntimeCatalog as Record<string, ModelRuntimeCapabilities>)[
    model
  ];
}

export function modelSupportsThinkingLevel(
  capabilities: ModelRuntimeCapabilities,
  level: ModelThinkingLevel,
): boolean {
  const nativeLevel = capabilities.thinkingLevelMap[level];
  return nativeLevel !== undefined && nativeLevel !== null;
}
