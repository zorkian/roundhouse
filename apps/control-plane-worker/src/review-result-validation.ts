// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  independentReviewResultSchema,
  normalizeReviewFindings,
  type IndependentReviewRequest,
  type IndependentReviewResult,
} from "@roundhouse/self-development/cloudflare";

export async function validateIndependentReviewResult(
  request: IndependentReviewRequest,
  value: unknown,
): Promise<IndependentReviewResult> {
  const result = independentReviewResultSchema.parse(value);
  const normalized = await normalizeReviewFindings(
    request.reviewId,
    request.headCommit,
    result.findings.map(({ findingId: _findingId, ...finding }) => finding),
    request.maxFindings,
  );
  if (
    result.reviewId !== request.reviewId ||
    result.attemptId !== request.attemptId ||
    result.cycle !== request.cycle ||
    result.runId !== request.runId ||
    result.baseCommit !== request.baseCommit ||
    result.headCommit !== request.headCommit ||
    result.patchSha256 !== request.patchSha256 ||
    (request.model !== undefined &&
      (result.requestedModel !== request.model ||
        result.requestedEffort !== request.modelEffort ||
        result.model !== request.model)) ||
    result.outputBytes > request.maxOutputBytes ||
    JSON.stringify(result.findings) !== JSON.stringify(normalized)
  )
    throw new Error("Independent review result binding mismatch");
  return result;
}
