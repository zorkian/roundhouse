// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { estimateModelCostUsd, resolveModelPrice } from "./model-prices.js";

describe("model prices", () => {
  it("prefers the actual API model over the configured route", () => {
    const resolved = resolveModelPrice({
      model: "openai/gpt-5.2",
      configuredModel: "openai/gpt-5",
      provider: "openai",
    });
    expect(resolved?.price.standard).toEqual([1.75, 0.175, 14]);
    expect(
      estimateModelCostUsd({
        model: "openai/gpt-5.2",
        configuredModel: "openai/gpt-5",
        provider: "openai",
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBeCloseTo(1.75);
  });

  it("falls back to the configured route when the API model is unpriced", () => {
    expect(
      estimateModelCostUsd({
        model: "openai/mystery-model",
        configuredModel: "openai/gpt-5",
        provider: "openai",
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBeCloseTo(1.25);
  });

  it("does not guess a provider for unresolved bare model IDs", () => {
    expect(resolveModelPrice({ model: "claude-sonnet-5" })).toBeUndefined();
  });

  it("keeps missing token data distinct from missing pricing data", () => {
    const knownWithoutTokens = {
      model: "openai/gpt-5",
      provider: "openai",
    };
    const unknownWithTokens = {
      model: "openai/unknown-model",
      provider: "openai",
      inputTokens: 1_000,
      outputTokens: 100,
    };
    expect(resolveModelPrice(knownWithoutTokens)).toBeDefined();
    expect(estimateModelCostUsd(knownWithoutTokens)).toBeUndefined();
    expect(resolveModelPrice(unknownWithTokens)).toBeUndefined();
    expect(estimateModelCostUsd(unknownWithTokens)).toBeUndefined();
  });
});
