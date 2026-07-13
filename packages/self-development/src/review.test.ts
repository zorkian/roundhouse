// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  defaultFindingDisposition,
  independentReviewRequestSchema,
  independentReviewResultSchema,
  normalizeReviewFindings,
  reviewIdentity,
} from "./review.js";

describe("independent review contracts", () => {
  it("keeps review run identity aligned with the durable run contract", async () => {
    const maximumRunId = `run_${"x".repeat(124)}`;
    const oversizedRunId = `${maximumRunId}x`;
    expect(maximumRunId).toHaveLength(128);
    expect(oversizedRunId).toHaveLength(129);
    expect(
      independentReviewRequestSchema.shape.runId.safeParse(maximumRunId)
        .success,
    ).toBe(true);
    expect(
      independentReviewRequestSchema.shape.runId.safeParse(oversizedRunId)
        .success,
    ).toBe(false);
    expect(
      independentReviewResultSchema.shape.runId.safeParse(oversizedRunId)
        .success,
    ).toBe(false);
  });
  it("creates deterministic review and finding identities", async () => {
    const reviewId = await reviewIdentity({
      runId: "run_review_contract",
      headCommit: "a".repeat(40),
      cycle: 1,
    });
    const findings = await normalizeReviewFindings(
      reviewId,
      "a".repeat(40),
      [
        {
          severity: "high",
          path: "packages/domain/src/ids.ts",
          line: 24,
          title: "Reject malformed identity",
          rationale: "The new predicate accepts malformed values.",
          recommendation: "Validate the complete branded identity syntax.",
        },
        {
          severity: "high",
          path: "packages/domain/src/ids.ts",
          line: 24,
          title: "Reject malformed identity",
          rationale: "The new predicate accepts malformed values.",
          recommendation: "Validate the complete branded identity syntax.",
        },
      ],
      10,
    );

    expect(reviewId).toMatch(/^review_[a-f0-9]{40}$/);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.findingId).toMatch(/^finding_[a-f0-9]{40}$/);
    await expect(
      normalizeReviewFindings(reviewId, "a".repeat(40), [], 10),
    ).resolves.toEqual([]);
  });

  it("accepts only substantive findings inside the approved path set", async () => {
    const findings = await normalizeReviewFindings(
      `review_${"b".repeat(40)}`,
      "c".repeat(40),
      [
        {
          severity: "medium",
          path: "packages/domain/src/ids.ts",
          title: "Substantive",
          rationale: "A behavior is incorrect.",
          recommendation: "Correct it.",
        },
        {
          severity: "low",
          path: "packages/domain/src/ids.ts",
          title: "Minor",
          rationale: "A name could be clearer.",
          recommendation: "Rename it.",
        },
        {
          severity: "critical",
          path: "apps/control-plane-worker/src/index.ts",
          title: "Outside scope",
          rationale: "This path was not approved.",
          recommendation: "Do not change it automatically.",
        },
      ],
      10,
    );
    const now = new Date("2026-07-12T00:00:00Z");
    const allowed = ["packages/domain/src/ids.ts"];
    const substantive = findings.find(
      (finding) => finding.title === "Substantive",
    )!;
    const low = findings.find((finding) => finding.title === "Minor")!;
    const outside = findings.find(
      (finding) => finding.title === "Outside scope",
    )!;

    expect(
      defaultFindingDisposition(
        `review_${"b".repeat(40)}`,
        substantive!,
        allowed,
        now,
      ).disposition,
    ).toBe("accepted");
    expect(
      defaultFindingDisposition(`review_${"b".repeat(40)}`, low!, allowed, now)
        .disposition,
    ).toBe("deferred");
    expect(
      defaultFindingDisposition(
        `review_${"b".repeat(40)}`,
        outside!,
        allowed,
        now,
      ).disposition,
    ).toBe("deferred");
  });

  it("rejects an unbounded model finding set", async () => {
    await expect(
      normalizeReviewFindings(
        `review_${"d".repeat(40)}`,
        "e".repeat(40),
        Array.from({ length: 3 }, (_, index) => ({
          severity: "low",
          path: "packages/domain/src/ids.ts",
          title: `Finding ${index}`,
          rationale: "Bounded rationale.",
          recommendation: "Bounded recommendation.",
        })),
        2,
      ),
    ).rejects.toThrow();
  });
});
