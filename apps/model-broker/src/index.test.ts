// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { brokerRequest, resolveRoute, type BrokerEnv } from "./index.js";

const env = {
  AI: {} as Ai,
  AI_GATEWAY_ID: "roundhouse-v2-development",
  ROUTING_MODEL: "openai/gpt-5.6-luna",
  ROUTING_REASONING_EFFORT: "high",
} satisfies BrokerEnv;

afterEach(() => vi.restoreAllMocks());

function modelRequest(
  protocol: "openai-responses" | "openai-completions" | "anthropic-messages",
  role: string,
  body: Record<string, unknown>,
  routingEnv: BrokerEnv = env,
  research = false,
) {
  const route = resolveRoute(
    {
      role,
      taskType: role.startsWith("review") ? "review" : role,
      complexity: "unknown",
    },
    routingEnv,
  );
  const path = {
    "openai-responses": "/v1/responses",
    "openai-completions": "/v1/chat/completions",
    "anthropic-messages": "/v1/messages",
  }[protocol];
  return new Request(`https://broker.invalid${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-roundhouse-attempt-id": "attempt_1",
      "x-roundhouse-role": role,
      "x-roundhouse-research": research ? "enabled" : "disabled",
      "x-roundhouse-routing-provider": route.provider,
      "x-roundhouse-routing-model": route.model,
      "x-roundhouse-routing-protocol": route.protocol,
      "x-roundhouse-routing-thinking-level": route.thinkingLevel,
      "x-roundhouse-routing-rule": route.rule,
    },
    body: JSON.stringify(body),
  });
}

describe("model broker", () => {
  it("resolves the distinct default routing classes", () => {
    expect(
      resolveRoute(
        { role: "qualify", taskType: "qualification", complexity: "unknown" },
        env,
      ),
    ).toMatchObject({
      provider: "openai",
      model: "openai/gpt-5.6-luna",
      protocol: "openai-responses",
      thinkingLevel: "high",
    });
    expect(
      resolveRoute(
        {
          role: "implement",
          taskType: "implementation",
          complexity: "unknown",
        },
        env,
      ),
    ).toMatchObject({
      provider: "openai",
      model: "openai/gpt-5.6-terra",
      protocol: "openai-responses",
      thinkingLevel: "max",
    });
  });

  it("honors a model and reasoning level selected by a repository profile", () => {
    const route = resolveRoute(
      {
        role: "implement",
        taskType: "implementation",
        complexity: "unknown",
        requestedModel: "anthropic/claude-opus-5",
        requestedReasoning: "max",
        profileHash: "a".repeat(64),
      },
      env,
    );
    expect(route).toMatchObject({
      provider: "anthropic",
      model: "anthropic/claude-opus-5",
      protocol: "anthropic-messages",
      thinkingLevel: "max",
      rule: "profile-implement-v2",
    });
    expect(route.runtime).toEqual({
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      thinkingLevelMap: {
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      },
    });
  });

  it("rejects unsupported effort instead of silently downgrading it", () => {
    expect(() =>
      resolveRoute(
        {
          role: "review-security",
          taskType: "review",
          complexity: "unknown",
          requestedModel: "moonshotai/kimi-k3",
          requestedReasoning: "xhigh",
          profileHash: "a".repeat(64),
        },
        env,
      ),
    ).toThrow("invalid_routing_configuration");
    expect(
      resolveRoute(
        {
          role: "review-security",
          taskType: "review",
          complexity: "unknown",
          requestedModel: "moonshotai/kimi-k3",
          requestedReasoning: "max",
          profileHash: "a".repeat(64),
        },
        env,
      ),
    ).toMatchObject({
      thinkingLevel: "max",
      runtime: {
        contextWindow: 1_048_576,
        maxOutputTokens: 131_072,
      },
    });
  });

  it("serves route resolution before a container is dispatched", async () => {
    const response = await brokerRequest(
      new Request("https://broker.invalid/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "plan",
          taskType: "planning",
          complexity: "unknown",
        }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      provider: "openai",
      protocol: "openai-responses",
    });
  });

  it("adds hosted research from attempt authority rather than the role name", async () => {
    const run = vi.fn(async () => new Response("event: done\n\n"));
    const body = { model: "untrusted", input: "Research this", stream: true };
    const response = await brokerRequest(
      modelRequest("openai-responses", "review-data", body, env, true),
      env,
      { run },
    );
    expect(run).toHaveBeenCalledWith(
      "openai/gpt-5.6-sol",
      {
        ...body,
        model: "openai/gpt-5.6-sol",
        tools: [{ type: "web_search_preview" }],
      },
      expect.objectContaining({ returnRawResponse: true }),
    );
    expect(response.headers.get("x-roundhouse-routing-protocol")).toBe(
      "openai-responses",
    );
  });

  it("passes native Anthropic input and adds Anthropic hosted research", async () => {
    const anthropicEnv = {
      ...env,
      ROUTING_ROUTES: JSON.stringify({
        plan: {
          provider: "anthropic",
          model: "anthropic/claude-opus-5",
          protocol: "anthropic-messages",
          thinkingLevel: "max",
        },
      }),
    };
    const run = vi.fn(async () => Response.json({ id: "msg_1" }));
    const body = {
      system: [
        {
          type: "text",
          text: "Review the change",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: "Plan it" }],
      max_tokens: 100,
    };
    await brokerRequest(
      modelRequest("anthropic-messages", "plan", body, anthropicEnv, true),
      anthropicEnv,
      { run },
    );
    expect(run).toHaveBeenCalledWith(
      "anthropic/claude-opus-5",
      {
        ...body,
        system: "Review the change",
        model: "anthropic/claude-opus-5",
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      },
      expect.anything(),
    );
  });

  it("removes caller-supplied OpenAI hosted search without research authority", async () => {
    const run = vi.fn(async () => new Response("event: done\n\n"));
    await brokerRequest(
      modelRequest("openai-responses", "review-data", {
        input: "Implement it",
        tools: [
          { type: "function", name: "submit_result" },
          { type: "web_search_preview" },
        ],
      }),
      env,
      { run },
    );
    expect(run).toHaveBeenCalledWith(
      "openai/gpt-5.6-sol",
      expect.objectContaining({
        tools: [{ type: "function", name: "submit_result" }],
      }),
      expect.anything(),
    );
  });

  it("removes caller-supplied Anthropic hosted search without research authority", async () => {
    const anthropicEnv = {
      ...env,
      ROUTING_ROUTES: JSON.stringify({
        "review-holistic": {
          provider: "anthropic",
          model: "anthropic/claude-fable-5",
          protocol: "anthropic-messages",
          thinkingLevel: "max",
        },
      }),
    };
    const run = vi.fn(async () => Response.json({ id: "msg_1" }));
    await brokerRequest(
      modelRequest(
        "anthropic-messages",
        "review-holistic",
        {
          messages: [{ role: "user", content: "Review it" }],
          max_tokens: 100,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
        },
        anthropicEnv,
      ),
      anthropicEnv,
      { run },
    );
    expect(run).toHaveBeenCalledWith(
      "anthropic/claude-fable-5",
      expect.not.objectContaining({ tools: expect.anything() }),
      expect.anything(),
    );
  });

  it("passes Pi's Moonshot chat payload without synthesizing messages", async () => {
    const moonshotEnv = {
      ...env,
      ROUTING_ROUTES: JSON.stringify({
        implement: {
          provider: "moonshotai",
          model: "moonshotai/kimi-k3",
          protocol: "openai-completions",
          thinkingLevel: "max",
        },
      }),
    };
    let sent: Record<string, unknown> | undefined;
    const run = vi.fn(
      async (_model: string, input: Record<string, unknown>) => {
        sent = input;
        return new Response("data: [DONE]\n\n");
      },
    );
    const body = {
      messages: [
        { role: "system", content: "Review." },
        { role: "user", content: "Diff" },
      ],
      stream: true,
      stream_options: { include_usage: true },
    };
    await brokerRequest(
      modelRequest("openai-completions", "implement", body, moonshotEnv),
      moonshotEnv,
      { run },
    );
    expect(run).toHaveBeenCalledWith(
      "moonshotai/kimi-k3",
      { ...body, model: "moonshotai/kimi-k3" },
      expect.anything(),
    );
    expect(sent?.messages).not.toContainEqual({
      role: "developer",
      content: "",
    });
  });

  it("rejects a model request whose endpoint does not match its stored route", async () => {
    const request = modelRequest("anthropic-messages", "plan", {
      messages: [],
    });
    request.headers.set("x-roundhouse-routing-protocol", "openai-responses");
    expect((await brokerRequest(request, env)).status).toBe(409);
  });

  it("fails closed without persisted routing headers", async () => {
    const request = new Request("https://broker.invalid/v1/responses", {
      method: "POST",
      body: "{}",
    });
    expect((await brokerRequest(request, env)).status).toBe(400);
  });

  it("returns the native upstream response and routing headers", async () => {
    const response = await brokerRequest(
      modelRequest("openai-responses", "review-data", { input: [] }),
      env,
      { run: vi.fn(async () => Response.json({ id: "chat_1", choices: [] })) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "chat_1",
      choices: [],
    });
    expect(response.headers.get("x-roundhouse-routing-model")).toBe(
      "openai/gpt-5.6-sol",
    );
  });

  it("marks an exhausted Workers AI account as a budget stop", async () => {
    const response = await brokerRequest(
      modelRequest("openai-completions", "review-security", { messages: [] }),
      env,
      {
        run: vi.fn(async () =>
          Response.json(
            {
              success: false,
              errors: [{ code: "3036", message: "Account limited" }],
            },
            { status: 429 },
          ),
        ),
      },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("x-roundhouse-model-stop-reason")).toBe(
      "budget",
    );
  });

  it("marks an exhausted AI Gateway spend limit as a budget stop", async () => {
    const response = await brokerRequest(
      modelRequest("openai-completions", "review-security", { messages: [] }),
      env,
      {
        run: vi.fn(async () =>
          Response.json(
            {
              success: false,
              error: [{ code: 2041, message: "Spend limit exceeded" }],
              internalCode: 2041,
            },
            { status: 429 },
          ),
        ),
      },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("x-roundhouse-model-stop-reason")).toBe(
      "budget",
    );
  });

  it("accepts a single AI Gateway error object", async () => {
    const response = await brokerRequest(
      modelRequest("openai-completions", "review-security", { messages: [] }),
      env,
      {
        run: vi.fn(async () =>
          Response.json(
            {
              success: false,
              error: { code: 2041, message: "Spend limit exceeded" },
            },
            { status: 429 },
          ),
        ),
      },
    );
    expect(response.headers.get("x-roundhouse-model-stop-reason")).toBe(
      "budget",
    );
  });

  it("leaves transient Workers AI capacity errors retryable", async () => {
    const response = await brokerRequest(
      modelRequest("openai-completions", "review-security", { messages: [] }),
      env,
      {
        run: vi.fn(async () =>
          Response.json(
            {
              success: false,
              errors: [{ code: 3040, message: "Out of capacity" }],
            },
            { status: 429 },
          ),
        ),
      },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("x-roundhouse-model-stop-reason")).toBeNull();
  });

  it("does not leak binding failures", async () => {
    const response = await brokerRequest(
      modelRequest("openai-responses", "qualify", { input: "hello" }),
      env,
      {
        run: vi.fn(async () => Promise.reject(new Error("credential detail"))),
      },
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "model_upstream_failed",
    });
  });
});
