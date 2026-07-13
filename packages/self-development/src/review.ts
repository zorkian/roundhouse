// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

import { repositoryRelativePathSchema } from "./trusted-loop.js";

const commitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const boundedIdentitySchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/);
const runIdentitySchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);

export const reviewSeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
]);
export type ReviewSeverity = z.infer<typeof reviewSeveritySchema>;

export const reviewEvidenceBindingSchema = z.object({
  evidenceId: boundedIdentitySchema,
  objectKey: z.string().min(1).max(1_000),
  sha256: sha256Schema,
  size: z.number().int().nonnegative(),
});

export const independentReviewRequestSchema = z.object({
  schemaVersion: z.literal(1),
  reviewId: z.string().regex(/^review_[a-f0-9]{40}$/),
  attemptId: boundedIdentitySchema,
  attemptNumber: z.number().int().positive().max(3),
  cycle: z.number().int().min(1).max(2),
  runId: runIdentitySchema,
  repositoryUrl: z.literal("https://github.com/zorkian/roundhouse.git"),
  issueNumber: z.number().int().positive(),
  issueUrl: z
    .string()
    .regex(/^https:\/\/github\.com\/zorkian\/roundhouse\/issues\/[1-9][0-9]*$/),
  pullRequestNumber: z.number().int().positive(),
  pullRequestUrl: z
    .string()
    .regex(/^https:\/\/github\.com\/zorkian\/roundhouse\/pull\/[1-9][0-9]*$/),
  branch: z.string().regex(/^codex\/dogfood-[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/),
  baseCommit: commitSchema,
  headCommit: commitSchema,
  patchSha256: sha256Schema,
  subject: z.string().min(1).max(500),
  instructions: z.string().min(1).max(20_000),
  allowedPaths: z.array(repositoryRelativePathSchema).min(1).max(50),
  planning: z.object({
    planId: z.string().regex(/^plan_[a-f0-9]{40}$/),
    planRevision: z.number().int().positive(),
    planSha256: sha256Schema,
  }),
  evidence: z.array(reviewEvidenceBindingSchema).min(1).max(20),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(15 * 60_000),
  maxOutputBytes: z
    .number()
    .int()
    .positive()
    .max(256 * 1024),
  maxFindings: z.number().int().positive().max(50),
  scenario: z
    .enum(["success", "timeout", "interrupt-once", "invalid-output"])
    .default("success"),
});

export type IndependentReviewRequest = z.infer<
  typeof independentReviewRequestSchema
>;

export const rawReviewFindingSchema = z.object({
  severity: reviewSeveritySchema,
  path: repositoryRelativePathSchema,
  line: z.number().int().positive().max(1_000_000).optional(),
  title: z.string().min(1).max(200),
  rationale: z.string().min(1).max(4_000),
  recommendation: z.string().min(1).max(4_000),
});

export type RawReviewFinding = z.infer<typeof rawReviewFindingSchema>;

export const reviewFindingSchema = rawReviewFindingSchema.extend({
  findingId: z.string().regex(/^finding_[a-f0-9]{40}$/),
});

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

export const independentReviewResultSchema = z.object({
  schemaVersion: z.literal(1),
  reviewId: z.string().regex(/^review_[a-f0-9]{40}$/),
  attemptId: boundedIdentitySchema,
  cycle: z.number().int().min(1).max(2),
  runId: runIdentitySchema,
  baseCommit: commitSchema,
  headCommit: commitSchema,
  patchSha256: sha256Schema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  startupDurationMs: z.number().int().nonnegative().default(0),
  provider: z.literal("claude-subscription"),
  model: z.string().min(1).max(200),
  summary: z.string().max(20_000),
  findings: z.array(reviewFindingSchema).max(50),
  outputBytes: z
    .number()
    .int()
    .nonnegative()
    .max(256 * 1024),
  usage: z.object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    turns: z.number().int().nonnegative().max(20),
  }),
  network: z.object({
    checkoutHosts: z.array(z.literal("github.com")),
    modelHosts: z.array(z.literal("api.anthropic.com")).max(1),
    reviewerToolsEnabled: z.literal(false),
    arbitraryInternetEnabled: z.literal(false),
    deniedHttpProbe: z.literal(true),
    deniedTcpProbe: z.literal(true),
  }),
  credential: z.object({
    installedAtRuntime: z.literal(true),
    writtenToFilesystem: z.literal(false),
    absentFromEvidence: z.literal(true),
  }),
  resources: z.object({
    diskBytes: z.number().int().nonnegative(),
    memoryBytes: z.number().int().nonnegative(),
  }),
});

export type IndependentReviewResult = z.infer<
  typeof independentReviewResultSchema
>;

export const retainedReviewEvidenceSchema = reviewEvidenceBindingSchema.extend({
  attemptId: boundedIdentitySchema,
  mediaType: z.literal("application/json"),
  createdAt: z.iso.datetime(),
});

export const independentReviewExecutionSchema = z.object({
  result: independentReviewResultSchema,
  evidence: retainedReviewEvidenceSchema,
});

export type IndependentReviewExecution = z.infer<
  typeof independentReviewExecutionSchema
>;

export const reviewFindingDispositionSchema = z.object({
  schemaVersion: z.literal(1),
  reviewId: z.string().regex(/^review_[a-f0-9]{40}$/),
  findingId: z.string().regex(/^finding_[a-f0-9]{40}$/),
  disposition: z.enum(["accepted", "declined", "duplicate", "deferred"]),
  actorId: z.string().min(1).max(200),
  rationale: z.string().min(1).max(2_000),
  decidedAt: z.iso.datetime(),
});

export type ReviewFindingDisposition = z.infer<
  typeof reviewFindingDispositionSchema
>;

export const remediationBindingSchema = z.object({
  schemaVersion: z.literal(1),
  reviewId: z.string().regex(/^review_[a-f0-9]{40}$/),
  reviewEvidenceObjectKey: z.string().min(1).max(1_000),
  reviewEvidenceSha256: sha256Schema,
  reviewedHeadCommit: commitSchema,
  cycle: z.number().int().min(1).max(2),
  acceptedFindingIds: z
    .array(z.string().regex(/^finding_[a-f0-9]{40}$/))
    .min(1)
    .max(50),
});

export type RemediationBinding = z.infer<typeof remediationBindingSchema>;

export const independentReviewStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "remediation_pending",
  "remediated",
]);

export const independentReviewEventSchema = z.object({
  sequence: z.number().int().positive(),
  type: z.string().min(1).max(100),
  occurredAt: z.iso.datetime(),
  detail: z.record(z.string(), z.unknown()).default({}),
});

export const durableIndependentReviewSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().positive(),
  status: independentReviewStatusSchema,
  request: independentReviewRequestSchema,
  attemptCount: z.number().int().nonnegative().max(3),
  activeAttemptId: boundedIdentitySchema.optional(),
  lease: z
    .object({
      token: boundedIdentitySchema,
      workerId: boundedIdentitySchema,
      acquiredAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
    })
    .optional(),
  execution: independentReviewExecutionSchema.optional(),
  dispositions: z.array(reviewFindingDispositionSchema).max(50).default([]),
  remediationRunId: boundedIdentitySchema.optional(),
  retryable: z.boolean().optional(),
  failureClassification: z.string().min(1).max(100).optional(),
  failureReason: z.string().min(1).max(500).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  events: z.array(independentReviewEventSchema).min(1),
});

export type DurableIndependentReview = z.infer<
  typeof durableIndependentReviewSchema
>;

export const reviewDeliverySchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("independent_review"),
  reviewId: z.string().regex(/^review_[a-f0-9]{40}$/),
  deliveryId: boundedIdentitySchema,
});

export type ReviewDelivery = z.infer<typeof reviewDeliverySchema>;

export interface IndependentReviewBackend {
  execute(
    request: IndependentReviewRequest,
  ): Promise<IndependentReviewExecution>;
}

const encoder = new TextEncoder();

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function digest(value: unknown): Promise<string> {
  return hex(
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(JSON.stringify(value)),
    ),
  );
}

export async function reviewIdentity(input: {
  runId: string;
  headCommit: string;
  cycle: number;
}): Promise<string> {
  return `review_${(await digest(input)).slice(0, 40)}`;
}

export async function normalizeReviewFindings(
  reviewId: string,
  headCommit: string,
  values: unknown[],
  maximum: number,
): Promise<ReviewFinding[]> {
  const parsed = z.array(rawReviewFindingSchema).max(maximum).parse(values);
  const findings = await Promise.all(
    parsed.map(async (finding) => ({
      ...finding,
      findingId: `finding_${(
        await digest({ reviewId, headCommit, finding })
      ).slice(0, 40)}`,
    })),
  );
  const unique = new Map(
    findings.map((finding) => [finding.findingId, finding]),
  );
  return [...unique.values()].sort((left, right) =>
    left.findingId.localeCompare(right.findingId),
  );
}

export function defaultFindingDisposition(
  reviewId: string,
  finding: ReviewFinding,
  allowedPaths: string[],
  now: Date,
): ReviewFindingDisposition {
  const inScope = allowedPaths.includes(finding.path);
  const accepted =
    inScope && ["critical", "high", "medium"].includes(finding.severity);
  return reviewFindingDispositionSchema.parse({
    schemaVersion: 1,
    reviewId,
    findingId: finding.findingId,
    disposition: accepted ? "accepted" : "deferred",
    actorId: "internal:roundhouse-review-policy-v1",
    rationale: accepted
      ? "Finding is substantive and within the exact approved path set."
      : inScope
        ? "Low-severity finding is deferred during the functionality-first V1 milestone."
        : "Finding is outside the exact approved path set and cannot be remediated automatically.",
    decidedAt: now.toISOString(),
  });
}
