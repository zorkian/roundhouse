// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { extractModelUsage } from "./attempt-container.js";
import { formatUsage, formatUsageBreakdown, totalUsage } from "./usage.js";

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

  it("prices Anthropic input and cache categories as separate token counts", () => {
    const usage = extractModelUsage(
      JSON.stringify({
        id: "msg_cached",
        model: "anthropic/claude-opus-4.8",
        usage: {
          input_tokens: 10,
          input_tokens_details: {
            cached_tokens: 100,
            cache_creation_tokens: 20,
          },
          output_tokens: 5,
          total_tokens: 135,
        },
      }),
      "attempt_cached",
      "anthropic/claude-opus-4.8",
      { provider: "anthropic" },
    );
    expect(usage).toMatchObject({
      cachedInputTokens: 100,
      cacheCreationInputTokens: 20,
      costUsd: 0.00105,
    });
  });

  it("extracts usage from a native Anthropic message stream", () => {
    const usage = extractModelUsage(
      [
        'data: {"type":"message_start","message":{"id":"msg_1","model":"anthropic/claude-opus-4.8","usage":{"input_tokens":10,"cache_read_input_tokens":4,"cache_creation_input_tokens":2}}}',
        'data: {"type":"message_delta","usage":{"output_tokens":5}}',
      ].join("\n\n"),
      "attempt_anthropic",
      "anthropic/claude-opus-4.8",
      { provider: "anthropic", protocol: "anthropic-messages" },
    );
    expect(usage).toMatchObject({
      callId: "msg_1",
      inputTokens: 10,
      cachedInputTokens: 4,
      cacheCreationInputTokens: 2,
      outputTokens: 5,
      totalTokens: 15,
    });
  });

  it("extracts usage from a native Chat Completions stream", () => {
    const usage = extractModelUsage(
      'data: {"id":"chat_1","model":"moonshotai/kimi-k3","choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\ndata: [DONE]\n',
      "attempt_moonshot",
      "moonshotai/kimi-k3",
      { provider: "moonshotai", protocol: "openai-completions" },
    );
    expect(usage).toMatchObject({
      callId: "chat_1",
      inputTokens: 8,
      outputTokens: 2,
      totalTokens: 10,
    });
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
    expect(formatUsage(calls)).toBe("45 tokens · $0.30");
    expect(formatUsageBreakdown(calls)).toContain("unavailable cached input");
    expect(formatUsage([])).toBe("Usage unavailable");
  });
});
