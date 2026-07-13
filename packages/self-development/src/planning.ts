// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

import { repositoryRelativePathSchema } from "./trusted-loop.js";

const sha40 = z.string().regex(/^[a-f0-9]{40}$/);
const sha64 = z.string().regex(/^[a-f0-9]{64}$/);
export const maxPlannedInstructionCharacters = 18_000;
const maxRequestedPaths = 1_000;
const protectedManifestNames = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

export const roundhouseSelfDevelopmentProfile = {
  profileId: "roundhouse-self-development-v1",
  profileVersion: 1,
  allowedPrefixes: ["apps/", "packages/", "docs/"],
  deniedPrefixes: [
    ".github/",
    "containers/",
    "apps/control-plane-worker/migrations/",
    "apps/control-plane-worker/wrangler",
  ],
  deniedExactPaths: ["LICENSE", "NOTICE", "package.json", "pnpm-lock.yaml"],
  maxPaths: 12,
  maxPatchBytes: 512 * 1024,
  agentTimeoutSeconds: 900,
  modelRequestLimit: 256,
  automaticAttemptLimit: 3,
  operatorAttemptLimit: 10,
} as const;

export const qualificationIssueSchema = z.object({
  issueNumber: z.number().int().positive(),
  issueContentSha256: sha64,
  subject: z.string().min(1).max(500),
  instructions: z.string().min(1).max(maxPlannedInstructionCharacters),
  baseCommit: sha40,
  requestedPaths: z.array(z.string()).max(maxRequestedPaths),
});

export type QualificationIssue = z.infer<typeof qualificationIssueSchema>;

export const qualificationFindingSchema = z.object({
  code: z.enum([
    "missing_scope",
    "too_many_paths",
    "invalid_path",
    "path_not_enrolled",
    "protected_path",
  ]),
  path: z.string().optional(),
  message: z.string().min(1).max(300),
});

export const qualifiedPlanSchema = z.object({
  schemaVersion: z.literal(1),
  planId: z.string().regex(/^plan_[a-f0-9]{40}$/),
  revision: z.literal(1),
  status: z.literal("proposed"),
  profileId: z.literal(roundhouseSelfDevelopmentProfile.profileId),
  profileVersion: z.literal(roundhouseSelfDevelopmentProfile.profileVersion),
  issueNumber: z.number().int().positive(),
  issueContentSha256: sha64,
  subject: z.string().min(1).max(500),
  instructionsSha256: sha64,
  baseCommit: sha40,
  exactPaths: z.array(repositoryRelativePathSchema).min(1).max(12),
  validationLevel: z.literal("full"),
  risk: z.enum(["low", "medium"]),
  limits: z.object({
    maxPatchBytes: z.number().int().positive(),
    maxFiles: z.number().int().positive(),
    agentTimeoutSeconds: z.number().int().positive(),
    modelRequestLimit: z.number().int().positive(),
    automaticAttemptLimit: z.number().int().positive(),
    operatorAttemptLimit: z.number().int().positive(),
  }),
  createdAt: z.iso.datetime(),
  planSha256: sha64,
});

export type QualifiedPlan = z.infer<typeof qualifiedPlanSchema>;

export const rejectedQualificationSchema = z.object({
  schemaVersion: z.literal(1),
  planId: z.string().regex(/^plan_[a-f0-9]{40}$/),
  revision: z.literal(1),
  status: z.literal("rejected"),
  profileId: z.literal(roundhouseSelfDevelopmentProfile.profileId),
  profileVersion: z.literal(roundhouseSelfDevelopmentProfile.profileVersion),
  issueNumber: z.number().int().positive(),
  issueContentSha256: sha64,
  subject: z.string().min(1).max(500),
  baseCommit: sha40,
  requestedPaths: z.array(z.string()).max(maxRequestedPaths),
  findings: z.array(qualificationFindingSchema).min(1),
  createdAt: z.iso.datetime(),
  planSha256: sha64,
});

export type RejectedQualification = z.infer<typeof rejectedQualificationSchema>;
export type PlanningDecision = QualifiedPlan | RejectedQualification;

const encoder = new TextEncoder();

async function sha256(value: string): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalPaths(paths: string[]): string[] {
  return [...new Set(paths)].sort();
}

export function extractExactPaths(instructions: string): string[] {
  const lines = instructions.split(/\r?\n/);
  const marker = lines.findIndex((line) =>
    /^\s*(?:scope|paths?|files?)\s+is\s+exactly\s*:\s*$/i.test(line),
  );
  if (marker < 0) return [];
  const paths: string[] = [];
  for (const line of lines.slice(marker + 1)) {
    const match = /^\s*-\s+(?:`([^`]+)`|([^\s].*?))\s*$/.exec(line);
    if (!match) {
      if (line.trim() === "") continue;
      break;
    }
    paths.push((match[1] ?? match[2] ?? "").trim());
  }
  return paths;
}

function pathFindings(paths: string[]) {
  const findings: z.infer<typeof qualificationFindingSchema>[] = [];
  if (paths.length === 0)
    findings.push({
      code: "missing_scope",
      message:
        "Issue must include a Scope is exactly section with literal files",
    });
  if (paths.length > roundhouseSelfDevelopmentProfile.maxPaths)
    findings.push({
      code: "too_many_paths",
      message: `Scope exceeds ${roundhouseSelfDevelopmentProfile.maxPaths} files`,
    });
  for (const path of paths) {
    if (!repositoryRelativePathSchema.safeParse(path).success) {
      findings.push({
        code: "invalid_path",
        path,
        message: "Scope path must be one canonical repository-relative file",
      });
      continue;
    }
    if (
      roundhouseSelfDevelopmentProfile.deniedExactPaths.includes(
        path as never,
      ) ||
      protectedManifestNames.has(path.split("/").at(-1) ?? "") ||
      roundhouseSelfDevelopmentProfile.deniedPrefixes.some((prefix) =>
        path.startsWith(prefix),
      )
    ) {
      findings.push({
        code: "protected_path",
        path,
        message: "Scope path is protected by the enrolled profile",
      });
      continue;
    }
    if (
      !roundhouseSelfDevelopmentProfile.allowedPrefixes.some((prefix) =>
        path.startsWith(prefix),
      )
    )
      findings.push({
        code: "path_not_enrolled",
        path,
        message: "Scope path is outside the enrolled profile",
      });
  }
  return findings;
}

export async function qualifyAndPlan(
  input: QualificationIssue,
  now: Date,
): Promise<PlanningDecision> {
  const issue = qualificationIssueSchema.parse(input);
  const exactPaths = canonicalPaths(issue.requestedPaths);
  const identity = JSON.stringify({
    profileId: roundhouseSelfDevelopmentProfile.profileId,
    profileVersion: roundhouseSelfDevelopmentProfile.profileVersion,
    issueNumber: issue.issueNumber,
    issueContentSha256: issue.issueContentSha256,
    baseCommit: issue.baseCommit,
  });
  const planId = `plan_${(await sha256(identity)).slice(0, 40)}`;
  const createdAt = now.toISOString();
  const findings = pathFindings(exactPaths);
  if (findings.length > 0) {
    const value = {
      schemaVersion: 1 as const,
      planId,
      revision: 1 as const,
      status: "rejected" as const,
      profileId: roundhouseSelfDevelopmentProfile.profileId,
      profileVersion: roundhouseSelfDevelopmentProfile.profileVersion,
      issueNumber: issue.issueNumber,
      issueContentSha256: issue.issueContentSha256,
      subject: issue.subject,
      baseCommit: issue.baseCommit,
      requestedPaths: exactPaths,
      findings,
      createdAt,
    };
    return rejectedQualificationSchema.parse({
      ...value,
      planSha256: await sha256(JSON.stringify(value)),
    });
  }
  const value = {
    schemaVersion: 1 as const,
    planId,
    revision: 1 as const,
    status: "proposed" as const,
    profileId: roundhouseSelfDevelopmentProfile.profileId,
    profileVersion: roundhouseSelfDevelopmentProfile.profileVersion,
    issueNumber: issue.issueNumber,
    issueContentSha256: issue.issueContentSha256,
    subject: issue.subject,
    instructionsSha256: await sha256(issue.instructions),
    baseCommit: issue.baseCommit,
    exactPaths,
    validationLevel: "full" as const,
    risk: exactPaths.some((path) =>
      path.startsWith("apps/control-plane-worker/"),
    )
      ? ("medium" as const)
      : ("low" as const),
    limits: {
      maxPatchBytes: roundhouseSelfDevelopmentProfile.maxPatchBytes,
      maxFiles: exactPaths.length,
      agentTimeoutSeconds: roundhouseSelfDevelopmentProfile.agentTimeoutSeconds,
      modelRequestLimit: roundhouseSelfDevelopmentProfile.modelRequestLimit,
      automaticAttemptLimit:
        roundhouseSelfDevelopmentProfile.automaticAttemptLimit,
      operatorAttemptLimit:
        roundhouseSelfDevelopmentProfile.operatorAttemptLimit,
    },
    createdAt,
  };
  return qualifiedPlanSchema.parse({
    ...value,
    planSha256: await sha256(JSON.stringify(value)),
  });
}

export const planningBindingSchema = z.object({
  planId: z.string().regex(/^plan_[a-f0-9]{40}$/),
  planSha256: sha64,
  profileId: z.literal(roundhouseSelfDevelopmentProfile.profileId),
  profileVersion: z.literal(roundhouseSelfDevelopmentProfile.profileVersion),
  issueContentSha256: sha64,
  exactPathsSha256: sha64,
  approvedBy: z.string().min(1).max(200),
  approvedAt: z.iso.datetime(),
});

export async function exactPathsSha256(paths: string[]): Promise<string> {
  return sha256(JSON.stringify(canonicalPaths(paths)));
}
