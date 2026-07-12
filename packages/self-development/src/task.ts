// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

export const selfDevelopmentTaskSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
  subject: z.string().min(1).max(500),
  instructions: z.string().min(1).max(20_000),
  repositoryPath: z.string().min(1),
  baseCommit: z.string().regex(/^[a-f0-9]{40}$/),
  validationLevel: z.enum(["quick", "full"]).default("quick"),
  allowedPaths: z.array(z.string().min(1)).min(1),
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
      .refine((value) => !value.includes("\n")),
    authorName: z.string().min(1).max(200),
    authorEmail: z.string().email(),
  }),
});

export type SelfDevelopmentTask = z.infer<typeof selfDevelopmentTaskSchema>;

export const runStates = [
  "created",
  "workspace_ready",
  "implementing",
  "validating",
  "awaiting_approval",
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

export const selfDevelopmentRunSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
  task: selfDevelopmentTaskSchema,
  state: runStateSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  workspacePath: z.string().optional(),
  events: z.array(runEventSchema).min(1),
});

export type SelfDevelopmentRun = z.infer<typeof selfDevelopmentRunSchema>;
