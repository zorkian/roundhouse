// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adaptRequest,
  brokerRequest,
  normalizeResponse,
  selectRoute,
  type BrokerEnv,
  type BrokerRoute,
} from "./index.js";

const env = {
  AI: {} as Ai,
  AI_GATEWAY_ID: "roundhouse-v2-development",
  ROUTING_MODEL: "openai/gpt-5.6-sol",
  ROUTING_REASONING_EFFORT: "low",
} satisfies BrokerEnv;

afterEach(() => vi.restoreAllMocks());

function request(body: Record<string, unknown> = { model: "untrusted-model" }) {
  return new Request("https://broker.invalid/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-roundhouse-attempt-id": "run_1_rev_1",
      "x-roundhouse-role": "qualify",
      "x-roundhouse-task-type": "validation",
      "x-roundhouse-complexity": "unknown",
    },
    body: JSON.stringify(body),
  });
}

describe("model broker", () => {
  it("keeps routing policy behind a semantic envelope", () => {
    expect(selectRoute(request(), env)).toEqual({
      provider: "openai",
      model: "openai/gpt-5.6-sol",
      reasoningEffort: "low",
      rule: "qualification-default-v1",
    });
  });

  it("selects the reproduction policy from the trusted role envelope", () => {
    const reproduction = request();
    reproduction.headers.set("x-roundhouse-role", "reproduce");
    expect(selectRoute(reproduction, env)).toEqual({
      provider: "openai",
      model: "openai/gpt-5.6-sol",
      reasoningEffort: "low",
      rule: "reproduction-default-v1",
    });
  });

  it("selects the planning policy from the trusted role envelope", () => {
    const planning = request();
    planning.headers.set("x-roundhouse-role", "plan");
    planning.headers.set("x-roundhouse-task-type", "planning");
    expect(selectRoute(planning, env)).toEqual({
      provider: "anthropic",
      model: "anthropic/claude-opus-4.8",
      reasoningEffort: "low",
      rule: "planning-default-v1",
    });
  });

  it("selects the implementation policy from the trusted role envelope", () => {
    const implementation = request();
    implementation.headers.set("x-roundhouse-role", "implement");
    implementation.headers.set("x-roundhouse-task-type", "implementation");
    expect(selectRoute(implementation, env)).toEqual({
      provider: "openai",
      model: "openai/gpt-5.6-sol",
      reasoningEffort: "low",
      rule: "implementation-default-v1",
    });
  });

  it("selects the review policy from the trusted role envelope", () => {
    const review = request();
    review.headers.set("x-roundhouse-role", "review");
    review.headers.set("x-roundhouse-task-type", "review");
    expect(selectRoute(review, env)).toEqual({
      provider: "openai",
      model: "openai/gpt-5.6-sol",
      reasoningEffort: "low",
      rule: "review-default-v1",
    });
  });

  it.each([
    [
      "review-holistic",
      "review-holistic-v1",
      "anthropic",
      "anthropic/claude-fable-5",
    ],
    [
      "review-security",
      "review-security-v1",
      "moonshotai",
      "moonshotai/kimi-k3",
    ],
    ["review-data", "review-data-v1", "moonshotai", "moonshotai/kimi-k3"],
  ] as const satisfies readonly (readonly [
    string,
    BrokerRoute["rule"],
    BrokerRoute["provider"],
    string,
  ])[])(
    "routes the %s role to the proven Codex-compatible model",
    (role, rule, provider, model) => {
      const review = request();
      review.headers.set("x-roundhouse-role", role);
      review.headers.set("x-roundhouse-task-type", "review");
      expect(selectRoute(review, env)).toEqual({
        provider,
        model,
        reasoningEffort: "low",
        rule,
      });
    },
  );

  it("replaces caller routing and uses a raw ZDR AI Gateway response", async () => {
    const run = vi.fn(async () =>
      Promise.resolve(
        new Response("event: done\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );
    const response = await brokerRequest(request(), env, { run });
    expect(run).toHaveBeenCalledWith(
      "openai/gpt-5.6-sol",
      expect.objectContaining({
        model: "openai/gpt-5.6-sol",
        reasoning: { effort: "low" },
      }),
      {
        gateway: {
          id: "roundhouse-v2-development",
          collectLog: false,
          skipCache: true,
        },
        extraHeaders: { "cf-aig-zdr": "true" },
        returnRawResponse: true,
      },
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-roundhouse-routing-rule")).toBe(
      "qualification-default-v1",
    );
  });

  it("adapts Responses input to Anthropic Messages", () => {
    expect(
      adaptRequest(
        {
          instructions: "Be precise.",
          input: [{ role: "user", content: "Plan this." }],
          max_output_tokens: 500,
          tools: [
            {
              type: "function",
              name: "lookup",
              parameters: { type: "object" },
            },
            { type: "web_search" },
          ],
        },
        selectRoute(
          (() => {
            const planning = request();
            planning.headers.set("x-roundhouse-role", "plan");
            return planning;
          })(),
          env,
        ),
      ),
    ).toMatchObject({
      model: "anthropic/claude-opus-4.8",
      system: "Be precise.",
      messages: [{ role: "user", content: "Plan this." }],
      max_tokens: 500,
      tools: [
        { name: "lookup", input_schema: { type: "object" } },
        { type: "web_search_20250305", name: "web_search" },
      ],
    });
  });

  it("normalizes Anthropic messages and usage to a Responses result", async () => {
    const planning = request();
    planning.headers.set("x-roundhouse-role", "plan");
    const response = await normalizeResponse(
      Response.json({
        id: "msg_1",
        model: "claude-opus-4.8",
        content: [
          { type: "text", text: "A plan" },
          { type: "tool_use", id: "tool_1", name: "lookup", input: { q: 1 } },
        ],
        stop_reason: "tool_use",
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 4,
          output_tokens: 5,
        },
      }),
      selectRoute(planning, env),
      false,
    );
    await expect(response.json()).resolves.toMatchObject({
      id: "msg_1",
      status: "completed",
      completion_reason: "tool_use",
      output: [
        { content: [{ type: "output_text", text: "A plan" }] },
        { type: "function_call", call_id: "tool_1", name: "lookup" },
      ],
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 4 },
        output_tokens: 5,
        total_tokens: 15,
      },
    });
  });

  it("normalizes streamed Moonshot chat output to a Responses event", async () => {
    const review = request();
    review.headers.set("x-roundhouse-role", "review-security");
    const upstream = new Response(
      [
        'data: {"id":"chat_1","model":"kimi-k3","choices":[{"delta":{"content":"No "},"finish_reason":null}]}',
        'data: {"id":"chat_1","model":"kimi-k3","choices":[{"delta":{"content":"issues"},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}',
        "data: [DONE]",
      ].join("\n\n"),
      { headers: { "content-type": "text/event-stream" } },
    );
    const response = await normalizeResponse(
      upstream,
      selectRoute(review, env),
      true,
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain('"text":"No issues"');
  });

  it("adds hosted web search for a trusted read-stage role", async () => {
    const run = vi.fn(async () => new Response("event: done\n\n"));
    await brokerRequest(
      request({
        model: "untrusted-model",
        input: "Look up the current model catalog.",
      }),
      env,
      { run },
    );
    expect(run).toHaveBeenCalledWith(
      "openai/gpt-5.6-sol",
      expect.objectContaining({ tools: [{ type: "web_search" }] }),
      expect.anything(),
    );
  });

  it("removes hosted web search outside read-only analysis", async () => {
    const run = vi.fn(async () => new Response("event: done\n\n"));
    const implementation = request({
      model: "untrusted-model",
      tools: [{ type: "web_search" }],
    });
    implementation.headers.set("x-roundhouse-role", "implement");
    await brokerRequest(implementation, env, { run });
    expect(run).toHaveBeenCalledWith(
      "openai/gpt-5.6-sol",
      expect.not.objectContaining({ tools: expect.anything() }),
      expect.anything(),
    );
  });

  it("fails closed without a complete routing envelope", async () => {
    const invalid = new Request("https://broker.invalid/responses", {
      method: "POST",
      body: "{}",
    });
    expect((await brokerRequest(invalid, env)).status).toBe(400);
  });

  it("serves an empty local model catalog without an upstream call", async () => {
    const catalog = new Request("https://broker.invalid/models", {
      headers: request().headers,
    });
    const run = vi.fn();
    const response = await brokerRequest(catalog, env, { run });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ models: [] });
    expect(run).not.toHaveBeenCalled();
  });

  it("does not leak binding errors", async () => {
    const response = await brokerRequest(request(), env, {
      run: vi.fn(async () => Promise.reject(new Error("credential detail"))),
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "model_upstream_failed",
    });
  });

  it("logs an upstream error response without consuming it", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await brokerRequest(request(), env, {
      run: vi.fn(
        async () =>
          new Response('{"error":{"message":"unsupported model"}}', {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      ),
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("unsupported model");
    const entries = log.mock.calls.map(([entry]) => JSON.parse(String(entry)));
    expect(entries).toContainEqual(
      expect.objectContaining({
        message: "api_response",
        api: "workers_ai",
        status: 400,
        body: { error: { message: "unsupported model" } },
      }),
    );
  });
});
