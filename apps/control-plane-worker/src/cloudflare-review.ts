// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  independentReviewRequestSchema,
  independentReviewResultSchema,
  normalizeReviewFindings,
  type IndependentReviewBackend,
  type IndependentReviewExecution,
  type IndependentReviewRequest,
  type IndependentReviewResult,
} from "@roundhouse/self-development/cloudflare";

import type {
  EvidenceBucketPort,
  ExecutionContainerNamespacePort,
} from "./cloudflare-execution.js";

const encoder = new TextEncoder();

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function key(request: IndependentReviewRequest): string {
  return `reviews/${request.reviewId}/attempts/${request.attemptId}/review.json`;
}

function boundedReason(error: unknown): string {
  return (error instanceof Error ? `${error.name}: ${error.message}` : "Error")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\/(?:[^\s/:]+\/)+[^\s:]+/g, "[path]")
    .slice(0, 240);
}

async function validateResult(
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
    result.outputBytes > request.maxOutputBytes ||
    JSON.stringify(result.findings) !== JSON.stringify(normalized)
  )
    throw new Error("Independent review result binding mismatch");
  return result;
}

async function parseEvidence(
  request: IndependentReviewRequest,
  text: string,
): Promise<IndependentReviewResult> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Independent review evidence is not valid JSON");
  }
  return validateResult(request, value);
}

export class CloudflareIndependentReviewBackend implements IndependentReviewBackend {
  private readonly oauthToken: string;

  constructor(
    private readonly containers: ExecutionContainerNamespacePort,
    private readonly evidence: EvidenceBucketPort,
    private readonly claudeAuthJson: string,
  ) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(claudeAuthJson);
    } catch {
      throw new Error("Claude review credential is invalid");
    }
    const token =
      parsed && typeof parsed === "object" && "oauthToken" in parsed
        ? (parsed as { oauthToken?: unknown }).oauthToken
        : undefined;
    if (typeof token !== "string" || token.length < 32 || token.length > 4_096)
      throw new Error("Claude review credential is invalid");
    this.oauthToken = token;
  }

  async execute(
    input: IndependentReviewRequest,
  ): Promise<IndependentReviewExecution> {
    const request = independentReviewRequestSchema.parse(input);
    const objectKey = key(request);
    let text: string;
    let result: IndependentReviewResult;
    const existing = await this.evidence.get(objectKey);
    if (existing) {
      text = await existing.text();
      if (text.includes(this.oauthToken))
        throw new Error("Claude review credential leaked into evidence");
      result = await parseEvidence(request, text);
    } else {
      const container = this.containers.getByName(request.attemptId);
      if (!container.runReviewJob)
        throw new Error("Independent review Container adapter is unavailable");
      try {
        result = await validateResult(
          request,
          await container.runReviewJob(request, this.claudeAuthJson),
        );
      } catch (error) {
        await container.destroy().catch(() => undefined);
        throw new Error(
          `Independent review execution failed: ${boundedReason(error)}`,
        );
      }
      text = JSON.stringify(result);
      if (text.includes(this.oauthToken))
        throw new Error("Claude review credential leaked into evidence");
      const bytes = encoder.encode(text);
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes),
      );
      const stored = await this.evidence
        .put(objectKey, bytes, {
          onlyIf: { etagDoesNotMatch: "*" },
          httpMetadata: { contentType: "application/json" },
          customMetadata: {
            reviewId: request.reviewId,
            attemptId: request.attemptId,
            headCommit: request.headCommit,
          },
          sha256: digest,
        })
        .catch(() => null);
      if (!stored) {
        const raced = await this.evidence.get(objectKey).catch(() => null);
        if (!raced)
          throw new Error("Independent review evidence was not retained");
        text = await raced.text();
        result = await parseEvidence(request, text);
      }
    }
    const bytes = encoder.encode(text);
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    return {
      result,
      evidence: {
        evidenceId: `review_evidence_${request.attemptId}`,
        attemptId: request.attemptId,
        objectKey,
        sha256,
        size: bytes.byteLength,
        mediaType: "application/json",
        createdAt: result.completedAt,
      },
    };
  }
}
