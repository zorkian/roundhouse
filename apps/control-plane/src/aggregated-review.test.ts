// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { Attempt, WorkflowReview } from "@roundhouse/core";
import { describe, expect, it } from "vitest";
import { aggregatedReview } from "./aggregated-review.js";

const head = "b".repeat(40);
const configured: WorkflowReview = {
  reviewers: [
    {
      id: "review-accessibility",
      label: "Accessibility",
      activation: "always",
      selects: [],
      mode: "advisory",
      blockingSeverities: ["high"],
      model: { id: "openai/gpt-5.6-sol", reasoning: "low" },
    },
  ],
};
const attempt: Attempt = {
  id: "review",
  runId: "run",
  runRevision: 1,
  kind: "agent",
  nodeId: "review",
  executor: "review",
  stage: "review",
  role: "review-accessibility",
  state: "completed",
  deadlineAt: 1,
  baseCommit: "a".repeat(40),
  expectedHead: head,
  acceptedHead: head,
  result: {
    review: {
      status: "changes_requested",
      summary: "Keyboard issue",
      findings: [
        {
          title: "Missing focus",
          details: "The dialog does not receive focus.",
          severity: "high",
          file: "src/dialog.ts",
        },
      ],
    },
  },
};

describe("aggregated workflow review", () => {
  it("binds stable finding evidence to the exact candidate and honors advisory mode", () => {
    const first = aggregatedReview([attempt], undefined, configured);
    const second = aggregatedReview([attempt], undefined, configured);
    expect(first.status).toBe("clean");
    expect(first.findings[0]?.evidence).toEqual({
      candidateHead: head,
      reviewer: "review-accessibility",
      fingerprint: second.findings[0]?.evidence.fingerprint,
    });
    expect(first.reviewers[0]?.candidateHead).toBe(head);
  });
});
