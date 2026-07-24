// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { reviewers, type AppliedProfile, type Attempt } from "@roundhouse/core";

export interface AggregatedReviewFinding {
  readonly reviewer: string;
  readonly title: string;
  readonly details: string;
  readonly severity: string;
  readonly file?: string;
}

export interface AggregatedReview {
  readonly status: "clean" | "changes_requested";
  readonly summary: string;
  readonly findings: readonly AggregatedReviewFinding[];
  readonly reviewers: readonly {
    readonly role: string;
    readonly routing: Attempt["routing"];
  }[];
}

export function aggregatedReviewStatus(
  attempts: readonly Attempt[],
  profile?: AppliedProfile,
): AggregatedReview["status"] {
  const changesRequested = attempts.some((attempt) => {
    const review = attempt.result?.review as
      Record<string, unknown> | undefined;
    const profileName = attempt.role.replace("review-", "") as
      "holistic" | "security" | "data";
    const blocking = new Set<string>(
      profile?.reviewers?.[profileName]?.blockingSeverities ??
        reviewers.find((reviewer) => reviewer.role === attempt.role)
          ?.blockingSeverities ??
        [],
    );
    return (
      Array.isArray(review?.findings) &&
      review.findings.some(
        (finding) =>
          !!finding &&
          typeof finding === "object" &&
          blocking.has(String((finding as Record<string, unknown>).severity)),
      )
    );
  });
  return changesRequested ? "changes_requested" : "clean";
}

export function aggregatedReview(
  attempts: readonly Attempt[],
  profile?: AppliedProfile,
  status = aggregatedReviewStatus(attempts, profile),
): AggregatedReview {
  const findings = attempts.flatMap((attempt) => {
    const review = attempt.result?.review as
      Record<string, unknown> | undefined;
    if (!Array.isArray(review?.findings)) return [];
    return review.findings.flatMap((finding) => {
      if (!finding || typeof finding !== "object") return [];
      const value = finding as Record<string, unknown>;
      const file = String(value.file ?? "").trim();
      return [
        {
          reviewer: attempt.role,
          title: String(value.title ?? "Finding"),
          details: String(value.details ?? ""),
          severity: String(value.severity ?? ""),
          ...(file ? { file } : {}),
        },
      ];
    });
  });
  const reviewerNames = attempts.map((attempt) => attempt.role).join(", ");
  const findingCount = findings.length;
  return {
    status,
    summary: findingCount
      ? `${reviewerNames} reported ${findingCount} ${findingCount === 1 ? "finding" : "findings"}.`
      : `${reviewerNames} completed the review with no findings.`,
    findings,
    reviewers: attempts.map((attempt) => ({
      role: attempt.role,
      routing: attempt.routing,
    })),
  };
}
