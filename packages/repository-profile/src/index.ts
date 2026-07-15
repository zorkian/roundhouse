// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { z } from "zod";

const commandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
});

const quickValidationSchema = z.object({
  format: commandSchema.extend({
    include: z.array(z.string().min(1)).min(1),
  }),
  fullWhenChanged: z.array(z.string().min(1)).default([]),
});

export const roundhouseFormatterWriteCommand = Object.freeze({
  command: "pnpm" as const,
  args: ["exec", "prettier", "--write"] as const,
});

export const repositoryProfileSchema = z.object({
  version: z.literal(1),
  runtime: z.object({
    image: z.string().min(1),
    workspace: z.string().startsWith("/"),
  }),
  bootstrap: commandSchema,
  validation: z.object({
    license: commandSchema.optional(),
    format: commandSchema,
    formatWrite: commandSchema.optional(),
    compile: commandSchema,
    targeted: commandSchema,
    quick: quickValidationSchema.optional(),
    timeoutMinutes: z.number().int().positive().max(120),
  }),
  network: z.object({
    default: z.literal("deny"),
    capabilities: z.array(z.string().min(1)).default([]),
  }),
  protectedPaths: z.array(z.string().min(1)).default([]),
  artifacts: z.object({ include: z.array(z.string().min(1)).default([]) }),
});

export type RepositoryProfile = z.infer<typeof repositoryProfileSchema>;
export type ProfileCommand = z.infer<typeof commandSchema>;

export function parseRepositoryProfile(source: string): RepositoryProfile {
  return repositoryProfileSchema.parse(parse(source));
}

export async function loadRepositoryProfile(
  path: string,
): Promise<RepositoryProfile> {
  return parseRepositoryProfile(await readFile(path, "utf8"));
}
