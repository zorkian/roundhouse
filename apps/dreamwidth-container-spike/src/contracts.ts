// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

export const instanceIdSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);

export const verifyRequestSchema = z.object({
  commit: z.string().regex(/^[a-f0-9]{40}$/),
});

export type VerifyRequest = z.infer<typeof verifyRequestSchema>;
