// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  approvalEvidenceBindingSchema,
  dogfoodPublicationBranchSchema,
  selfDevelopmentTaskSchema,
} from "@roundhouse/self-development/cloudflare";
import { z } from "zod";

export const submitRunSchema = z.object({
  schemaVersion: z.literal(1),
  task: selfDevelopmentTaskSchema,
});

export type SubmitRun = z.infer<typeof submitRunSchema>;

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[a-zA-Z0-9._:-]+$/);

export const approveRunSchema = z.object({
  schemaVersion: z.literal(1),
  expectedRevision: z.number().int().positive(),
  patchSha256: z.string().regex(/^[a-f0-9]{64}$/),
  evidence: z.array(approvalEvidenceBindingSchema).min(1).max(20),
  approver: z.string().min(1).max(200),
});

export const recordPublicationSchema = z.object({
  schemaVersion: z.literal(1),
  expectedRevision: z.number().int().positive(),
  branch: dogfoodPublicationBranchSchema,
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  remoteUrl: z.literal("https://github.com/zorkian/roundhouse.git"),
  pullRequestUrl: z
    .string()
    .regex(/^https:\/\/github\.com\/zorkian\/roundhouse\/pull\/[1-9][0-9]*$/)
    .optional(),
});

export const revisionMutationSchema = z.object({
  schemaVersion: z.literal(1),
  expectedRevision: z.number().int().positive(),
});

export const recoveryRequestSchema = z.object({
  schemaVersion: z.literal(1),
});
