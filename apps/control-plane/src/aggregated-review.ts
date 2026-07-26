// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  reviewers,
  type AppliedProfile,
  type Attempt,
  type WorkflowReview,
} from "@roundhouse/core";

export interface AggregatedReviewFinding {
  readonly reviewer: string;
  readonly title: string;
  readonly details: string;
  readonly severity: string;
  readonly file?: string;
  readonly evidence: {
    readonly candidateHead: string;
    readonly reviewer: string;
    readonly fingerprint: string;
  };
}

export interface AggregatedReview {
  readonly status: "clean" | "changes_requested";
  readonly summary: string;
  readonly findings: readonly AggregatedReviewFinding[];
  readonly reviewers: readonly {
    readonly role: string;
    readonly routing: Attempt["routing"];
    readonly candidateHead: string;
  }[];
}

export function aggregatedReviewStatus(
  attempts: readonly Attempt[],
  profile?: AppliedProfile,
  configured?: WorkflowReview,
): AggregatedReview["status"] {
  const changesRequested = attempts.some((attempt) => {
    const review = attempt.result?.review as
      Record<string, unknown> | undefined;
    const profileName = attempt.role.replace("review-", "") as
      "holistic" | "security" | "data";
    const blocking = new Set<string>(
      configured?.reviewers.find((reviewer) => reviewer.id === attempt.role)
        ?.blockingSeverities ??
        profile?.reviewers?.[profileName]?.blockingSeverities ??
        reviewers.find((reviewer) => reviewer.role === attempt.role)
          ?.blockingSeverities ??
        [],
    );
    const mode = configured?.reviewers.find(
      (reviewer) => reviewer.id === attempt.role,
    )?.mode;
    return (
      (mode === undefined || mode === "blocking") &&
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
  configured?: WorkflowReview,
  status = aggregatedReviewStatus(attempts, profile, configured),
): AggregatedReview {
  const findings = attempts.flatMap((attempt) => {
    if (
      configured?.reviewers.find((reviewer) => reviewer.id === attempt.role)
        ?.mode === "shadow"
    )
      return [];
    const review = attempt.result?.review as
      Record<string, unknown> | undefined;
    if (!Array.isArray(review?.findings)) return [];
    return review.findings.flatMap((finding) => {
      if (!finding || typeof finding !== "object") return [];
      const value = finding as Record<string, unknown>;
      const file = String(value.file ?? "").trim();
      const evidenceSource = [
        attempt.role,
        attempt.expectedHead,
        String(value.title ?? "Finding").trim(),
        String(value.details ?? "").trim(),
        String(value.severity ?? "").trim(),
        file,
      ].join("\u001f");
      let fingerprint = 2166136261;
      for (let index = 0; index < evidenceSource.length; index += 1) {
        fingerprint ^= evidenceSource.charCodeAt(index);
        fingerprint = Math.imul(fingerprint, 16777619);
      }
      return [
        {
          reviewer: attempt.role,
          title: String(value.title ?? "Finding"),
          details: String(value.details ?? ""),
          severity: String(value.severity ?? ""),
          ...(file ? { file } : {}),
          evidence: {
            candidateHead: attempt.expectedHead,
            reviewer: attempt.role,
            fingerprint: `fnv1a-${(fingerprint >>> 0).toString(16).padStart(8, "0")}`,
          },
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
      candidateHead: attempt.expectedHead,
    })),
  };
}
