// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { extractModelUsage } from "./attempt-container.js";
import { formatUsage, totalUsage } from "./usage.js";

describe("model usage", () => {
  it("extracts detailed usage and calculates known-model cost", () => {
    const usage = extractModelUsage(
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", model: "openai/gpt-5", usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 400 }, output_tokens: 100, output_tokens_details: { reasoning_tokens: 25 }, total_tokens: 1100 } } })}\n\ndata: [DONE]\n`,
      "attempt_1",
      "openai/gpt-5",
    );
    expect(usage).toMatchObject({
      callId: "resp_1",
      attemptId: "attempt_1",
      cachedInputTokens: 400,
      reasoningTokens: 25,
      totalTokens: 1100,
      costUsd: 0.0018,
    });
  });

  it("calculates cost for the configured routing model", () => {
    const usage = extractModelUsage(
      JSON.stringify({
        id: "resp_sol",
        model: "openai/gpt-5.6-sol",
        usage: {
          input_tokens: 1000,
          input_tokens_details: { cached_tokens: 400 },
          output_tokens: 100,
          total_tokens: 1100,
        },
      }),
      "attempt_sol",
      "openai/gpt-5.6-sol",
    );
    expect(usage?.costUsd).toBe(0.00252);
  });

  it.each([
    ["anthropic/claude-opus-4.8", 0.0225],
    ["anthropic/claude-fable-5", 0.0045],
    ["moonshotai/kimi-k3", 0.00085],
  ])("calculates fallback cost for %s", (model, expected) => {
    const usage = extractModelUsage(
      JSON.stringify({
        id: `call_${model}`,
        model,
        usage: {
          input_tokens: 1000,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 100,
          total_tokens: 1100,
        },
      }),
      "attempt_provider",
      model,
    );
    expect(usage?.costUsd).toBeCloseTo(expected);
  });

  it("aggregates retries once per stored call and preserves unavailable fields", () => {
    const calls = [
      {
        callId: "one",
        attemptId: "attempt_1",
        model: "model",
        inputTokens: 10,
        totalTokens: 15,
        costUsd: 0.1,
      },
      {
        callId: "two",
        attemptId: "attempt_2",
        model: "model",
        inputTokens: 20,
        totalTokens: 30,
        costUsd: 0.2,
      },
    ];
    const total = totalUsage(calls);
    expect(total).toMatchObject({ inputTokens: 30, totalTokens: 45 });
    expect(total.costUsd).toBeCloseTo(0.3);
    expect(formatUsage(calls)).toContain("unavailable cached input");
    expect(formatUsage([])).toBe("Usage unavailable");
  });
});
