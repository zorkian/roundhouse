// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { brokerRequest, selectRoute, type BrokerEnv } from "./index.js";

const env = {
  AI: {} as Ai,
  AI_GATEWAY_ID: "roundhouse-v2-development",
  ROUTING_MODEL: "openai/gpt-5.6-sol",
  ROUTING_REASONING_EFFORT: "low",
} satisfies BrokerEnv;

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
});
