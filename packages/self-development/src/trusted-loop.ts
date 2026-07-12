// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

import type { StageResult } from "./job-ports.js";

const boundedIdentity = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/);
const runIdentity = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const publicationAuthorNameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
export const publicationAuthorEmailSchema = z
  .string()
  .email()
  .max(320)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
export const repositoryRelativePathSchema = z
  .string()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !/[\u0000-\u001f\u007f]/.test(value) &&
      !/[?*[\]{}!]/.test(value) &&
      value
        .split("/")
        .every(
          (segment) => segment !== "" && segment !== "." && segment !== "..",
        ),
    "Path must be a normalized repository-relative path",
  );

export const publicationFileSchema = z.discriminatedUnion("operation", [
  z.object({
    path: repositoryRelativePathSchema,
    operation: z.literal("upsert"),
    contentBase64: z.string().max(700_000),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(512 * 1024),
    sha256,
  }),
  z.object({
    path: repositoryRelativePathSchema,
    operation: z.literal("delete"),
  }),
]);

export const trustedPublicationManifestSchema = z.object({
  schemaVersion: z.literal(1),
  baseCommit: commit,
  patchSha256: sha256,
  files: z.array(publicationFileSchema).min(1).max(50),
  sha256,
});

export type TrustedPublicationManifest = z.infer<
  typeof trustedPublicationManifestSchema
>;

export const trustedImplementationRequestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: runIdentity,
  attemptId: boundedIdentity,
  attemptNumber: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
  repositoryUrl: z.literal("https://github.com/zorkian/roundhouse.git"),
  baseCommit: commit,
  subject: z.string().min(1).max(500),
  instructions: z.string().min(1).max(20_000),
  allowedPaths: z.array(repositoryRelativePathSchema).min(1).max(50),
  validationLevel: z.enum(["quick", "full"]),
  agentTimeoutMs: z
    .number()
    .int()
    .positive()
    .max(20 * 60_000),
  validationTimeoutMs: z
    .number()
    .int()
    .positive()
    .max(15 * 60_000),
  maxPatchBytes: z
    .number()
    .int()
    .positive()
    .max(512 * 1024),
  maxChangedFiles: z.number().int().positive().max(50),
  maxOutputBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
  scenario: z
    .enum([
      "success",
      "agent-failure",
      "timeout",
      "interrupt-once",
      "credential-cleanup-failure",
    ])
    .default("success"),
});

export type TrustedImplementationRequest = z.infer<
  typeof trustedImplementationRequestSchema
>;

export const validationCommandEvidenceSchema = z.object({
  name: z.enum(["diff-check", "format", "license", "typecheck", "test"]),
  command: z.string().min(1).max(500),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  stdout: z.string(),
  stderr: z.string(),
  outputTruncated: z.boolean(),
});

export const trustedImplementationResultSchema = z.object({
  schemaVersion: z.literal(1),
  runId: runIdentity,
  attemptId: boundedIdentity,
  baseCommit: commit,
  checkoutCommit: commit,
  patch: z
    .string()
    .min(1)
    .max(512 * 1024),
  patchSha256: sha256,
  patchBytes: z
    .number()
    .int()
    .positive()
    .max(512 * 1024),
  changedFiles: z.array(repositoryRelativePathSchema).min(1).max(50),
  publicationManifest: trustedPublicationManifestSchema.optional(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  startupDurationMs: z.number().int().nonnegative().default(0),
  checkoutDurationMs: z.number().int().nonnegative(),
  agentDurationMs: z.number().int().nonnegative(),
  validationDurationMs: z.number().int().nonnegative(),
  agent: z.object({
    provider: z.literal("codex-subscription"),
    sessionId: z.string().min(1).max(300).optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    outcome: z.enum(["succeeded", "failed", "cancelled"]),
    summary: z.string().max(20_000),
    eventBytes: z
      .number()
      .int()
      .nonnegative()
      .max(5 * 1024 * 1024),
  }),
  validation: z.array(validationCommandEvidenceSchema).min(1).max(5),
  network: z.object({
    checkoutHosts: z.array(z.literal("github.com")),
    modelHosts: z.array(z.string().min(1).max(253)).max(10),
    agentToolInternetEnabled: z.literal(false),
    validationInternetEnabled: z.literal(false),
    deniedHttpProbe: z.literal(true),
    deniedTcpProbe: z.literal(true),
  }),
  credential: z.object({
    installedAtRuntime: z.literal(true),
    removedBeforeValidation: z.literal(true),
    absentFromEvidence: z.literal(true),
  }),
  resources: z.object({
    diskBytes: z.number().int().nonnegative(),
    memoryBytes: z.number().int().nonnegative(),
  }),
});

export type TrustedImplementationResult = z.infer<
  typeof trustedImplementationResultSchema
>;

export interface TrustedImplementationBackend {
  execute(request: TrustedImplementationRequest): Promise<StageResult>;
}

export const approvalEvidenceBindingSchema = z.object({
  evidenceId: boundedIdentity,
  objectKey: z.string().min(1).max(1_000),
  sha256,
  size: z.number().int().nonnegative(),
});

export const exactApprovalSchema = z.object({
  schemaVersion: z.literal(1),
  runId: runIdentity,
  baseCommit: commit,
  patchSha256: sha256,
  evidence: z.array(approvalEvidenceBindingSchema).min(1).max(20),
  approver: z.string().min(1).max(200),
  approvedAt: z.iso.datetime(),
});

export type ExactApproval = z.infer<typeof exactApprovalSchema>;

export const dogfoodPublicationBranchSchema = z
  .string()
  .regex(/^codex\/dogfood-[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/);

export const publicationRequestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: runIdentity,
  expectedRevision: z.number().int().positive(),
  approval: exactApprovalSchema,
  repositoryUrl: z.literal("https://github.com/zorkian/roundhouse.git"),
  baseCommit: commit,
  branch: dogfoodPublicationBranchSchema,
  commitMessage: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
});

export type PublicationRequest = z.infer<typeof publicationRequestSchema>;

export function pullRequestMatchesRemote(
  pullRequestUrl: string | undefined,
  remoteUrl: string,
): boolean {
  if (pullRequestUrl === undefined) return true;
  if (!/^https:\/\/github\.com\/[^/?#]+\/[^/?#]+\.git$/.test(remoteUrl))
    return false;
  const prefix = `${remoteUrl.slice(0, -4)}/pull/`;
  return (
    pullRequestUrl.startsWith(prefix) &&
    /^[1-9][0-9]*$/.test(pullRequestUrl.slice(prefix.length))
  );
}

export function approvalMatches(
  approvalValue: unknown,
  expected: Pick<ExactApproval, "runId" | "baseCommit" | "patchSha256"> & {
    evidence: ExactApproval["evidence"];
  },
): boolean {
  const parsed = exactApprovalSchema.safeParse(approvalValue);
  if (!parsed.success) return false;
  const approval = parsed.data;
  if (
    approval.runId !== expected.runId ||
    approval.baseCommit !== expected.baseCommit ||
    approval.patchSha256 !== expected.patchSha256 ||
    approval.evidence.length !== expected.evidence.length
  )
    return false;
  return approval.evidence.every((value, index) => {
    const bound = expected.evidence[index];
    return (
      bound !== undefined &&
      value.evidenceId === bound.evidenceId &&
      value.objectKey === bound.objectKey &&
      value.sha256 === bound.sha256 &&
      value.size === bound.size
    );
  });
}
