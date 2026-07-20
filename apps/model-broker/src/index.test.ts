// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { brokerRequest, resolveRoute, type BrokerEnv } from "./index.js";

const env = {
  AI: {} as Ai,
  AI_GATEWAY_ID: "roundhouse-v2-development",
  ROUTING_MODEL: "openai/gpt-5.6-sol",
  ROUTING_REASONING_EFFORT: "low",
} satisfies BrokerEnv;

afterEach(() => vi.restoreAllMocks());

function modelRequest(
  protocol: "openai-responses" | "openai-completions" | "anthropic-messages",
  role: string,
  body: Record<string, unknown>,
) {
  const route = resolveRoute(
    {
      role,
      taskType: role.startsWith("review") ? "review" : role,
      complexity: "unknown",
    },
    env,
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
  it.each([
    [
      "qualify",
      "openai",
      "openai/gpt-5.6-sol",
      "openai-responses",
      "qualification-default-v1",
    ],
    [
      "reproduce",
      "openai",
      "openai/gpt-5.6-sol",
      "openai-responses",
      "reproduction-default-v1",
    ],
    [
      "plan",
      "anthropic",
      "anthropic/claude-opus-4.8",
      "anthropic-messages",
      "planning-default-v1",
    ],
    [
      "implement",
      "openai",
      "openai/gpt-5.6-sol",
      "openai-responses",
      "implementation-default-v1",
    ],
    [
      "review-holistic",
      "anthropic",
      "anthropic/claude-fable-5",
      "anthropic-messages",
      "review-holistic-v1",
    ],
    [
      "review-security",
      "moonshotai",
      "moonshotai/kimi-k3",
      "openai-completions",
      "review-security-v1",
    ],
    [
      "review-data",
      "moonshotai",
      "moonshotai/kimi-k3",
      "openai-completions",
      "review-data-v1",
    ],
  ] as const)(
    "resolves the native route for %s",
    (role, provider, model, protocol, rule) => {
      expect(
        resolveRoute(
          { role, taskType: "validation", complexity: "unknown" },
          env,
        ),
      ).toEqual({
        provider,
        model,
        protocol,
        thinkingLevel: "low",
        rule,
      });
    },
  );

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
      provider: "anthropic",
      protocol: "anthropic-messages",
    });
  });

  it("passes native OpenAI Responses input and adds hosted research", async () => {
    const run = vi.fn(async () => new Response("event: done\n\n"));
    const body = { model: "untrusted", input: "Research this", stream: true };
    const response = await brokerRequest(
      modelRequest("openai-responses", "qualify", body),
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
    const run = vi.fn(async () => Response.json({ id: "msg_1" }));
    const body = {
      messages: [{ role: "user", content: "Plan it" }],
      max_tokens: 100,
    };
    await brokerRequest(modelRequest("anthropic-messages", "plan", body), env, {
      run,
    });
    expect(run).toHaveBeenCalledWith(
      "anthropic/claude-opus-4.8",
      {
        ...body,
        model: "anthropic/claude-opus-4.8",
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      },
      expect.anything(),
    );
  });

  it("passes Pi's Moonshot chat payload without synthesizing messages", async () => {
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
      modelRequest("openai-completions", "review-security", body),
      env,
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
      modelRequest("openai-completions", "review-data", { messages: [] }),
      env,
      { run: vi.fn(async () => Response.json({ id: "chat_1", choices: [] })) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "chat_1",
      choices: [],
    });
    expect(response.headers.get("x-roundhouse-routing-model")).toBe(
      "moonshotai/kimi-k3",
    );
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
