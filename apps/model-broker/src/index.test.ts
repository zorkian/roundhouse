// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { brokerRequest, resolveRoute, type BrokerEnv } from "./index.js";

const env = {
  AI: {} as Ai,
  AI_GATEWAY_ID: "roundhouse-v2-development",
  AI_GATEWAY_TOKEN: "gateway-token",
  ROUTING_MODEL: "openai/gpt-5.6-luna",
  ROUTING_REASONING_EFFORT: "high",
} satisfies BrokerEnv;

afterEach(() => vi.restoreAllMocks());

function modelRequest(
  protocol:
    | "openai-responses"
    | "openai-completions"
    | "anthropic-messages"
    | "google-generative-ai",
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
    "google-generative-ai": `/v1beta/models/${route.model}:streamGenerateContent?alt=sse`,
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
      ...(route.transport
        ? { "x-roundhouse-routing-transport": route.transport }
        : {}),
      "x-roundhouse-routing-thinking-level": route.thinkingLevel,
      "x-roundhouse-routing-rule": route.rule,
    },
    body: JSON.stringify(body),
  });
}

function nativeUpstream(
  implementation: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response> = async () => Response.json({ id: "response_1" }),
) {
  const getUrl = vi.fn(
    async (provider?: string) =>
      `https://gateway.ai.cloudflare.com/v1/account/gateway/${provider}`,
  );
  return {
    ai: {
      gateway: vi.fn(() => ({ getUrl })),
      run: vi.fn(async () => {
        throw new Error("unified_transport_not_expected");
      }),
    },
    getUrl,
    outboundFetch: vi.fn(implementation),
  };
}

function outboundBody(outboundFetch: ReturnType<typeof vi.fn>) {
  return JSON.parse(
    String((outboundFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
  ) as Record<string, unknown>;
}

describe("model broker", () => {
  it("resolves the distinct default routing classes", () => {
    expect(
      resolveRoute(
        {
          role: "conversation",
          taskType: "conversation",
          complexity: "unknown",
        },
        env,
      ),
    ).toMatchObject({
      provider: "openai",
      model: "openai/gpt-5.6-sol",
      protocol: "openai-responses",
      thinkingLevel: "high",
      rule: "conversation-default-v1",
    });
    expect(
      resolveRoute(
        { role: "qualify", taskType: "qualification", complexity: "unknown" },
        env,
      ),
    ).toMatchObject({
      provider: "openai",
      model: "openai/gpt-5.6-luna",
      protocol: "openai-responses",
      transport: "cloudflare-provider-native",
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
      transport: "cloudflare-provider-native",
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

  it("honors an allowlisted model selected by a repository profile", () => {
    const approvedEnv = {
      ...env,
      ROUTING_MODELS: JSON.stringify({
        "google/gemini-3.5-flash": {
          provider: "google",
          model: "google/gemini-3.5-flash",
          protocol: "google-generative-ai",
          transport: "cloudflare-provider-native",
        },
      }),
    };
    expect(
      resolveRoute(
        {
          role: "implement",
          taskType: "implementation",
          complexity: "unknown",
          requestedModel: "google/gemini-3.5-flash",
          requestedReasoning: "medium",
          profileHash: "a".repeat(64),
        },
        approvedEnv,
      ),
    ).toMatchObject({
      provider: "google",
      model: "google/gemini-3.5-flash",
      protocol: "google-generative-ai",
      transport: "cloudflare-provider-native",
      thinkingLevel: "medium",
      rule: "profile-implement-v2",
    });
  });

  it("rejects a profile model outside the deployment allowlist", () => {
    expect(() =>
      resolveRoute(
        {
          role: "conversation",
          taskType: "conversation",
          complexity: "unknown",
          requestedModel: "google/unapproved-model",
        },
        env,
      ),
    ).toThrow("model_not_approved");
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
      transport: "cloudflare-provider-native",
    });
  });

  it("carries max reasoning through route resolution", () => {
    expect(
      resolveRoute(
        {
          role: "plan",
          taskType: "planning",
          complexity: "unknown",
          requestedModel: "openai/gpt-5.6-sol",
          requestedReasoning: "max",
        },
        env,
      ),
    ).toMatchObject({
      transport: "cloudflare-provider-native",
      thinkingLevel: "max",
    });
  });

  it("adds hosted research from attempt authority rather than the role name", async () => {
    const upstream = nativeUpstream(
      async () => new Response("event: done\n\n"),
    );
    const body = { model: "untrusted", input: "Research this", stream: true };
    const response = await brokerRequest(
      modelRequest("openai-responses", "review-data", body, env, true),
      env,
      upstream.ai,
      upstream.outboundFetch as unknown as typeof fetch,
    );
    expect(upstream.outboundFetch).toHaveBeenCalledWith(
      "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/responses",
      expect.objectContaining({ method: "POST", redirect: "manual" }),
    );
    expect(outboundBody(upstream.outboundFetch)).toEqual({
      ...body,
      model: "gpt-5.6-sol",
      tools: [{ type: "web_search_preview" }],
    });
    const headers = new Headers(
      upstream.outboundFetch.mock.calls[0]?.[1]?.headers,
    );
    expect(headers.get("cf-aig-authorization")).toBe("Bearer gateway-token");
    expect(headers.get("cf-aig-collect-log")).toBe("true");
    expect(headers.get("cf-aig-collect-log-payload")).toBe("false");
    expect(headers.get("cf-aig-skip-cache")).toBe("true");
    expect(headers.get("cf-aig-zdr")).toBe("true");
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
    const upstream = nativeUpstream(async () => Response.json({ id: "msg_1" }));
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
      upstream.ai,
      upstream.outboundFetch as unknown as typeof fetch,
    );
    expect(upstream.outboundFetch.mock.calls[0]?.[0]).toBe(
      "https://gateway.ai.cloudflare.com/v1/account/gateway/anthropic/v1/messages",
    );
    expect(outboundBody(upstream.outboundFetch)).toEqual({
      ...body,
      system: "Review the change",
      model: "claude-opus-5",
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });
  });

  it("removes caller-supplied OpenAI hosted search without research authority", async () => {
    const upstream = nativeUpstream(
      async () => new Response("event: done\n\n"),
    );
    await brokerRequest(
      modelRequest("openai-responses", "review-data", {
        input: "Implement it",
        tools: [
          { type: "function", name: "submit_result" },
          { type: "web_search_preview" },
        ],
      }),
      env,
      upstream.ai,
      upstream.outboundFetch as unknown as typeof fetch,
    );
    expect(outboundBody(upstream.outboundFetch)).toMatchObject({
      tools: [{ type: "function", name: "submit_result" }],
    });
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
    const upstream = nativeUpstream(async () => Response.json({ id: "msg_1" }));
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
      upstream.ai,
      upstream.outboundFetch as unknown as typeof fetch,
    );
    expect(outboundBody(upstream.outboundFetch)).not.toHaveProperty("tools");
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
      {
        gateway: {
          id: "roundhouse-v2-development",
          collectLog: true,
          skipCache: true,
        },
        extraHeaders: {
          "cf-aig-collect-log-payload": "false",
          "cf-aig-zdr": "true",
        },
        returnRawResponse: true,
      },
    );
    expect(sent?.messages).not.toContainEqual({
      role: "developer",
      content: "",
    });
  });

  it("rewrites Google model paths for the provider-native gateway", async () => {
    const googleEnv = {
      ...env,
      ROUTING_ROUTES: JSON.stringify({
        plan: {
          provider: "google",
          model: "google/gemini-3.5-flash",
          protocol: "google-generative-ai",
          thinkingLevel: "high",
        },
      }),
    };
    const upstream = nativeUpstream(
      async () => new Response("data: response\n\n"),
    );
    await brokerRequest(
      modelRequest(
        "google-generative-ai",
        "plan",
        { contents: [{ role: "user", parts: [{ text: "Plan it" }] }] },
        googleEnv,
      ),
      googleEnv,
      upstream.ai,
      upstream.outboundFetch as unknown as typeof fetch,
    );
    expect(upstream.getUrl).toHaveBeenCalledWith("google-ai-studio");
    expect(upstream.outboundFetch.mock.calls[0]?.[0]).toBe(
      "https://gateway.ai.cloudflare.com/v1/account/gateway/google-ai-studio/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse",
    );
    expect(outboundBody(upstream.outboundFetch)).not.toHaveProperty("model");
  });

  it("applies provider policy to routes snapshotted before transport existed", async () => {
    const request = modelRequest("openai-responses", "plan", {
      input: "Plan it",
    });
    request.headers.delete("x-roundhouse-routing-transport");
    const upstream = nativeUpstream(async () =>
      Response.json({ id: "legacy_response" }),
    );
    const response = await brokerRequest(
      request,
      env,
      upstream.ai,
      upstream.outboundFetch as unknown as typeof fetch,
    );
    expect(upstream.outboundFetch).toHaveBeenCalledOnce();
    expect(response.headers.get("x-roundhouse-routing-transport")).toBe(
      "cloudflare-provider-native",
    );
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
    const upstream = nativeUpstream(async () =>
      Response.json({ id: "response_1", output: [] }),
    );
    const response = await brokerRequest(
      modelRequest("openai-responses", "review-data", { input: [] }),
      env,
      upstream.ai,
      upstream.outboundFetch as unknown as typeof fetch,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "response_1",
      output: [],
    });
    expect(response.headers.get("x-roundhouse-routing-model")).toBe(
      "openai/gpt-5.6-sol",
    );
    expect(response.headers.get("x-roundhouse-routing-transport")).toBe(
      "cloudflare-provider-native",
    );
  });

  it("does not write conversation model output into general logs", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const upstream = nativeUpstream(async () =>
      Response.json({
        id: "response_1",
        output_text: "private transcript answer",
      }),
    );
    const request = modelRequest("openai-responses", "conversation", {
      input: [{ role: "user", content: "private transcript question" }],
    });
    request.headers.set("x-roundhouse-workload", "conversation");
    const response = await brokerRequest(
      request,
      env,
      upstream.ai,
      upstream.outboundFetch as unknown as typeof fetch,
    );
    await expect(response.json()).resolves.toMatchObject({ id: "response_1" });
    const entries = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(entries).toContain("model_response_received");
    expect(entries).not.toContain("private transcript answer");
    expect(entries).not.toContain("private transcript question");
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

  it("does not leak provider-native failures", async () => {
    const upstream = nativeUpstream(async () =>
      Promise.reject(new Error("credential detail")),
    );
    const response = await brokerRequest(
      modelRequest("openai-responses", "qualify", { input: "hello" }),
      env,
      upstream.ai,
      upstream.outboundFetch as unknown as typeof fetch,
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "model_upstream_failed",
    });
  });
});
