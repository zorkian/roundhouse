// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isModelRoute, parseModelRoute } from "./contracts.js";

describe("model route contract", () => {
  it("accepts a complete native route", () => {
    expect(
      isModelRoute({
        provider: "openai",
        model: "openai/gpt-5.6-sol",
        protocol: "openai-responses",
        transport: "cloudflare-provider-native",
        thinkingLevel: "max",
        rule: "planning-default-v1",
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

describe("competition judgement contract", () => {
  const candidateIds = ["alpha", "beta"];
  const valid = {
    selected: "alpha",
    scores: [
      { candidateId: "alpha", score: 9, rationale: "Stronger result" },
      { candidateId: "beta", score: 6, rationale: "Weaker result" },
    ],
  };

  it("accepts a complete judgement covering every candidate", async () => {
    const { validateCompetitionJudgement } = await import("./contracts.js");
    expect(validateCompetitionJudgement(valid, candidateIds)).toEqual(valid);
  });

  it("rejects malformed, unknown, duplicated, and incomplete judgements", async () => {
    const { validateCompetitionJudgement } = await import("./contracts.js");
    expect(
      validateCompetitionJudgement(
        { ...valid, selected: "gamma" },
        candidateIds,
      ),
    ).toBeUndefined();
    expect(
      validateCompetitionJudgement(
        { ...valid, scores: valid.scores.slice(0, 1) },
        candidateIds,
      ),
    ).toBeUndefined();
    expect(
      validateCompetitionJudgement(
        {
          ...valid,
          scores: [
            ...valid.scores.slice(0, 1),
            { candidateId: "alpha", score: 1, rationale: "Duplicate" },
          ],
        },
        candidateIds,
      ),
    ).toBeUndefined();
    expect(
      validateCompetitionJudgement(
        {
          ...valid,
          scores: [
            valid.scores[0],
            { candidateId: "beta", score: "high", rationale: "Wrong type" },
          ],
        },
        candidateIds,
      ),
    ).toBeUndefined();
    expect(
      validateCompetitionJudgement(
        {
          ...valid,
          scores: [
            valid.scores[0],
            { candidateId: "beta", score: 5, rationale: "  " },
          ],
        },
        candidateIds,
      ),
    ).toBeUndefined();
    expect(validateCompetitionJudgement(null, candidateIds)).toBeUndefined();
    expect(validateCompetitionJudgement([], candidateIds)).toBeUndefined();
  });
});
