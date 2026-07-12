// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { selfDevelopmentTaskSchema } from "@roundhouse/self-development";
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
