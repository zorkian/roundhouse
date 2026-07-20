// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  brokerRequest,
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
      model: "openai/gpt-5.6-sol",
      reasoningEffort: "low",
      rule: "qualification-default-v1",
    });
  });

  it("selects the reproduction policy from the trusted role envelope", () => {
    const reproduction = request();
    reproduction.headers.set("x-roundhouse-role", "reproduce");
    expect(selectRoute(reproduction, env)).toEqual({
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
      model: "openai/gpt-5.6-sol",
      reasoningEffort: "low",
      rule: "planning-default-v1",
    });
  });

  it("selects the implementation policy from the trusted role envelope", () => {
    const implementation = request();
    implementation.headers.set("x-roundhouse-role", "implement");
    implementation.headers.set("x-roundhouse-task-type", "implementation");
    expect(selectRoute(implementation, env)).toEqual({
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
      model: "openai/gpt-5.6-sol",
      reasoningEffort: "low",
      rule: "review-default-v1",
    });
  });

  it.each([
    ["review-holistic", "review-holistic-v1"],
    ["review-security", "review-security-v1"],
    ["review-data", "review-data-v1"],
  ] as const satisfies readonly (readonly [string, BrokerRoute["rule"]])[])(
    "routes the %s role to a Responses-compatible independent model",
    (role, rule) => {
      const review = request();
      review.headers.set("x-roundhouse-role", role);
      review.headers.set("x-roundhouse-task-type", "review");
      expect(selectRoute(review, env)).toEqual({
        model: "openai/gpt-5.4",
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
