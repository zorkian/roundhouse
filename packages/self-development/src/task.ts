// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

import {
  exactApprovalSchema,
  implementationModel,
  implementationModelEffort,
  publicationAuthorEmailSchema,
  publicationAuthorNameSchema,
  repositoryPathPolicySchema,
  repositoryRelativePathSchema,
} from "./trusted-loop.js";
import {
  bugReproductionPlanSchema,
  planningBindingSchema,
} from "./planning.js";

export const selfDevelopmentTaskSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
  subject: z.string().min(1).max(500),
  instructions: z.string().min(1).max(20_000),
  repositoryPath: z.string().min(1),
  baseCommit: z.string().regex(/^[a-f0-9]{40}$/),
  validationLevel: z.enum(["quick", "full"]).default("quick"),
  allowedPaths: z.array(z.string().min(1)).min(1),
  pathPolicy: repositoryPathPolicySchema.optional(),
  planning: planningBindingSchema.optional(),
  continuation: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("independent_review"),
        sourceRunId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
        sourceRevision: z.number().int().positive(),
        sourceHeadCommit: z.string().regex(/^[a-f0-9]{40}$/),
        evidenceId: z.string().regex(/^review_[a-f0-9]{40}$/),
        evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
        acceptedFindingIds: z
          .array(z.string().regex(/^finding_[a-f0-9]{40}$/))
          .min(1)
          .max(50),
      }),
      z
        .object({
          kind: z.literal("repository_ci"),
          sourceRunId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
          sourceRevision: z.number().int().positive(),
          sourceHeadCommit: z.string().regex(/^[a-f0-9]{40}$/),
          evidenceId: z.string().regex(/^check_run:[1-9][0-9]*$/),
          evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
          pullRequestNumber: z.number().int().positive(),
          checkRunId: z.number().int().positive(),
        })
        .refine(
          (value) => value.evidenceId === `check_run:${value.checkRunId}`,
          { message: "evidenceId must match checkRunId" },
        ),
    ])
    .optional(),
  bugReproduction: bugReproductionPlanSchema.optional(),
  source: z
    .object({
      kind: z.literal("github_issue"),
      roundhouseEnvironment: z.enum(["development", "production"]).optional(),
      owner: z.literal("zorkian"),
      repository: z.literal("roundhouse"),
      issueNumber: z.number().int().positive(),
      issueUrl: z
        .string()
        .regex(
          /^https:\/\/github\.com\/zorkian\/roundhouse\/issues\/[1-9][0-9]*$/,
        ),
      nodeId: z.string().min(1).max(200),
      contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
      updatedAt: z.iso.datetime(),
    })
    .optional(),
  publication: z.object({
    remote: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/)
      .default("origin"),
    remoteUrl: z.string().min(1),
    branch: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/),
    expectedRemoteHead: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    commitMessage: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
    authorName: publicationAuthorNameSchema,
    authorEmail: publicationAuthorEmailSchema,
  }),
});

export type SelfDevelopmentTask = z.infer<typeof selfDevelopmentTaskSchema>;

export const runStates = [
  "created",
  "workspace_ready",
  "implementing",
  "validating",
  "awaiting_approval",
  "awaiting_publication",
  "approved",
  "committed",
  "pushed",
  "completed",
  "failed",
  "cancelled",
] as const;

export const runStateSchema = z.enum(runStates);
export type SelfDevelopmentRunState = z.infer<typeof runStateSchema>;

export const runEventSchema = z.object({
  sequence: z.number().int().positive(),
  type: z.string().min(1),
  state: runStateSchema,
  occurredAt: z.iso.datetime(),
  detail: z.record(z.string(), z.unknown()).default({}),
});

export const jobStageSchema = z.enum([
  "prepare",
  "implement",
  "validate",
  "commit",
  "push",
  "complete",
]);
export type JobStage = z.infer<typeof jobStageSchema>;

export const runAttemptSchema = z.object({
  attemptId: z.string().min(1),
  stage: jobStageSchema,
  number: z.number().int().positive(),
  status: z.enum(["running", "succeeded", "failed"]),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  retryable: z.boolean().optional(),
  automaticRepair: z.boolean().optional(),
  classification: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});

export const runLeaseSchema = z.object({
  token: z.string().min(1),
  workerId: z.string().min(1),
  acquiredAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

export const executionEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  evidenceId: z.string().min(1),
  attemptId: z.string().min(1),
  objectKey: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
  mediaType: z.literal("application/json"),
  approvalEligible: z.boolean().optional(),
  createdAt: z.iso.datetime(),
});

export type ExecutionEvidence = z.infer<typeof executionEvidenceSchema>;

export const selfDevelopmentRunSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
  revision: z.number().int().positive().default(1),
  task: selfDevelopmentTaskSchema,
  state: runStateSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  workspacePath: z.string().optional(),
  workspaceRef: z.string().min(1).optional(),
  commit: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .optional(),
  lease: runLeaseSchema.optional(),
  attempts: z.array(runAttemptSchema).default([]),
  evidence: z.array(executionEvidenceSchema).default([]),
  implementation: z
    .object({
      patchSha256: z.string().regex(/^[a-f0-9]{64}$/),
      patchBytes: z
        .number()
        .int()
        .nonnegative()
        .max(512 * 1024),
      changedFiles: z.array(repositoryRelativePathSchema).min(1).max(50),
      evidenceId: z.string().min(1),
      objectKey: z.string().min(1),
      requestedModel: z.literal(implementationModel).optional(),
      requestedEffort: z.literal(implementationModelEffort).optional(),
    })
    .optional(),
  approval: exactApprovalSchema.optional(),
  publication: z
    .object({
      branch: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/),
      commit: z.string().regex(/^[a-f0-9]{40}$/),
      remoteUrl: z.string().min(1),
      verifiedAt: z.iso.datetime(),
      pullRequestUrl: z.string().url().optional(),
    })
    .optional(),
  events: z.array(runEventSchema).min(1),
});

export type SelfDevelopmentRun = z.infer<typeof selfDevelopmentRunSchema>;
