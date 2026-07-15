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
  it("accepts safe manual branches and rejects unsafe ref syntax", () => {
    const branch = independentReviewRequestSchema.shape.branch;
    expect(branch.safeParse("codex/issue-92-manual-review").success).toBe(true);
    expect(branch.safeParse("feature/manual-review").success).toBe(true);
    expect(branch.safeParse("feature/../main").success).toBe(false);
    expect(branch.safeParse("feature//review").success).toBe(false);
    expect(branch.safeParse("feature/review.lock").success).toBe(false);
  });

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

  it("keeps pull-request review provenance distinct from issue-run provenance", () => {
    const request = {
      schemaVersion: 1,
      reviewId: `review_${"a".repeat(40)}`,
      attemptId: `review_${"a".repeat(40)}-attempt-1`,
      attemptNumber: 1,
      cycle: 1,
      sourceKind: "pull_request",
      manualFallback: true,
      advisoryOnly: true,
      runId: `manual_pr_23_${"b".repeat(40)}`,
      repositoryUrl: "https://github.com/zorkian/roundhouse.git",
      pullRequestNumber: 23,
      pullRequestUrl: "https://github.com/zorkian/roundhouse/pull/23",
      branch: "codex/advisory-review",
      baseCommit: "c".repeat(40),
      headCommit: "d".repeat(40),
      patchSha256: "e".repeat(64),
      subject: "Review an existing pull request",
      instructions: "Review the exact pull request patch.",
      allowedPaths: ["packages/self-development/src/review.ts"],
      evidence: [],
      timeoutMs: 60_000,
      maxOutputBytes: 64_000,
      maxFindings: 10,
      scenario: "success",
    } as const;

    expect(independentReviewRequestSchema.safeParse(request).success).toBe(
      true,
    );
    expect(
      independentReviewRequestSchema.safeParse({
        ...request,
        issueNumber: 23,
        issueUrl: "https://github.com/zorkian/roundhouse/issues/23",
        planning: {
          planId: `plan_${"f".repeat(40)}`,
          planRevision: 1,
          planSha256: "f".repeat(64),
        },
        evidence: [
          {
            evidenceId: "fabricated",
            objectKey: "https://github.com/zorkian/roundhouse/pull/23.diff",
            sha256: "e".repeat(64),
            size: 100,
          },
        ],
      }).success,
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

    expect(reviewId).toBe("review_a4ba1fe06c33ffc1e14f567747e5dfdb4abcd619");
    await expect(
      reviewIdentity({
        cycle: 1,
        headCommit: "a".repeat(40),
        runId: "run_review_contract",
        ignored: "caller-only metadata",
      } as Parameters<typeof reviewIdentity>[0]),
    ).resolves.toBe(reviewId);
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
