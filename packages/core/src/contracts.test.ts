// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isModelRoute, parseModelRoute } from "./contracts.js";

describe("model route contract", () => {
  it("accepts a complete native route", () => {
    expect(
      isModelRoute({
        provider: "moonshotai",
        model: "moonshotai/kimi-k3",
        protocol: "openai-completions",
        thinkingLevel: "low",
        rule: "review-data-v1",
      }),
    ).toBe(true);
  });

  it("rejects the legacy partial route stored by existing attempts", () => {
    expect(
      isModelRoute({
        provider: "moonshotai",
        model: "moonshotai/kimi-k3",
        reasoningEffort: "low",
        rule: "review-data-v1",
      }),
    ).toBe(false);
    expect(
      parseModelRoute(
        '{"provider":"moonshotai","model":"moonshotai/kimi-k3","reasoningEffort":"low","rule":"review-data-v1"}',
      ),
    ).toBeUndefined();
  });

  it("treats malformed persisted JSON as no route", () => {
    expect(parseModelRoute("not-json")).toBeUndefined();
  });
});
