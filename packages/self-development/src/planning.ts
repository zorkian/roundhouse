// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

import {
  bugReproductionPlanSchema,
  repositoryRelativePathSchema,
  type RepositoryPathPolicy,
} from "./trusted-loop.js";

const sha40 = z.string().regex(/^[a-f0-9]{40}$/);
const sha64 = z.string().regex(/^[a-f0-9]{64}$/);
export { bugReproductionPlanSchema } from "./trusted-loop.js";
export const maxPlannedInstructionCharacters = 18_000;
const maxRequestedPaths = 1_000;
const protectedManifestNames = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
] as const;

export const roundhouseSelfDevelopmentPathPolicy = {
  allowedExactPaths: ["README.md"],
  allowedPrefixes: ["apps/", "docs/", "packages/"],
  deniedExactPaths: ["LICENSE", "NOTICE", "package.json", "pnpm-lock.yaml"],
  deniedPrefixes: [
    ".github/",
    "apps/control-plane-worker/migrations/",
    "apps/control-plane-worker/wrangler",
    "containers/",
  ],
  deniedBasenames: [...protectedManifestNames],
  maxChangedFiles: 12,
} satisfies RepositoryPathPolicy;

export function selfDevelopmentPathPolicyForProfile(
  profileVersion: number,
): RepositoryPathPolicy | undefined {
  if (profileVersion < 3) return undefined;
  return {
    allowedExactPaths: [
      ...roundhouseSelfDevelopmentPathPolicy.allowedExactPaths,
    ],
    allowedPrefixes: [...roundhouseSelfDevelopmentPathPolicy.allowedPrefixes],
    deniedExactPaths: [...roundhouseSelfDevelopmentPathPolicy.deniedExactPaths],
    deniedPrefixes: [...roundhouseSelfDevelopmentPathPolicy.deniedPrefixes],
    deniedBasenames: [...roundhouseSelfDevelopmentPathPolicy.deniedBasenames],
    maxChangedFiles: roundhouseSelfDevelopmentPathPolicy.maxChangedFiles,
  };
}

export const roundhouseSelfDevelopmentProfile = {
  profileId: "roundhouse-self-development-v1",
  profileVersion: 3,
  allowedExactPaths: roundhouseSelfDevelopmentPathPolicy.allowedExactPaths,
  allowedPrefixes: roundhouseSelfDevelopmentPathPolicy.allowedPrefixes,
  deniedPrefixes: roundhouseSelfDevelopmentPathPolicy.deniedPrefixes,
  deniedExactPaths: roundhouseSelfDevelopmentPathPolicy.deniedExactPaths,
  maxPaths: roundhouseSelfDevelopmentPathPolicy.maxChangedFiles,
  maxPatchBytes: 512 * 1024,
  agentTimeoutSeconds: 900,
  modelRequestLimit: 256,
  automaticAttemptLimit: 3,
  operatorAttemptLimit: 10,
} as const;

const roundhouseSelfDevelopmentProfileVersionSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(roundhouseSelfDevelopmentProfile.profileVersion),
]);

export const qualificationIssueSchema = z.object({
  issueNumber: z.number().int().positive(),
  issueContentSha256: sha64,
  subject: z.string().min(1).max(500),
  instructions: z.string().min(1).max(maxPlannedInstructionCharacters),
  baseCommit: sha40,
  requestedPaths: z.array(z.string()).max(maxRequestedPaths),
  planningAttemptId: z
    .string()
    .regex(/^planning_[a-f0-9]{40}$/)
    .optional(),
  understanding: z.string().min(1).max(4_000).optional(),
  acceptanceCriteria: z.array(z.string().min(1).max(500)).max(20).default([]),
  clarificationQuestions: z
    .array(z.string().min(1).max(500))
    .max(5)
    .default([]),
  suggestedRisk: z.enum(["low", "medium", "high"]).optional(),
  outcome: z
    .enum([
      "proposed",
      "needs_clarification",
      "already_satisfied",
      "duplicate",
      "rejected",
    ])
    .optional(),
  evidence: z.array(z.string().min(1).max(1_000)).max(20).default([]),
  duplicateOf: z
    .union([
      z.literal("").transform(() => undefined),
      z.string().min(1).max(1_000),
    ])
    .optional(),
  planningEvidence: z.array(z.string().min(1).max(10_000)).max(20).default([]),
  bugReproduction: bugReproductionPlanSchema.optional(),
});

export type QualificationIssue = z.input<typeof qualificationIssueSchema>;

export const planningAgentRequestSchema = z.object({
  schemaVersion: z.literal(1),
  attemptId: z.string().regex(/^planning_[a-f0-9]{40}$/),
  repositoryUrl: z.literal("https://github.com/zorkian/roundhouse.git"),
  baseCommit: sha40,
  issueNumber: z.number().int().positive(),
  subject: z.string().min(1).max(500),
  instructions: z.string().min(1).max(maxPlannedInstructionCharacters),
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
});

export type PlanningAgentRequest = z.infer<typeof planningAgentRequestSchema>;

export const planningAgentResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    attemptId: z.string().regex(/^planning_[a-f0-9]{40}$/),
    baseCommit: sha40,
    status: z.enum([
      "proposed",
      "needs_clarification",
      "already_satisfied",
      "duplicate",
      "rejected",
      "clarification",
    ]),
    summary: z.string().min(1).max(4_000),
    exactPaths: z.array(repositoryRelativePathSchema).max(50),
    acceptanceCriteria: z.array(z.string().min(1).max(500)).min(1).max(20),
    questions: z.array(z.string().min(1).max(500)).max(5),
    risk: z.enum(["low", "medium", "high"]),
    evidence: z.array(z.string().min(1).max(1_000)).max(20).optional(),
    duplicateOf: z.string().max(1_000).optional(),
    bugReproduction: bugReproductionPlanSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.status === "proposed" && value.exactPaths.length === 0)
      context.addIssue({
        code: "custom",
        path: ["exactPaths"],
        message: "A proposed plan requires at least one likely path",
      });
    if (
      ["clarification", "needs_clarification"].includes(value.status) &&
      value.questions.length === 0
    )
      context.addIssue({
        code: "custom",
        path: ["questions"],
        message: "Clarification requires targeted questions",
      });
    if (
      value.status === "already_satisfied" &&
      (value.evidence?.length ?? 0) === 0
    )
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "Already satisfied requires concrete repository evidence",
      });
    if (value.status === "duplicate" && !value.duplicateOf)
      context.addIssue({
        code: "custom",
        path: ["duplicateOf"],
        message: "Duplicate requires a durable repository-qualified identity",
      });
  });

export type PlanningAgentResult = z.infer<typeof planningAgentResultSchema>;

export const qualificationFindingSchema = z.object({
  code: z.enum([
    "missing_scope",
    "too_many_paths",
    "invalid_path",
    "path_not_enrolled",
    "protected_path",
    "clarification_required",
  ]),
  path: z.string().optional(),
  message: z.string().min(1).max(500),
});

export const qualifiedPlanSchema = z.object({
  schemaVersion: z.literal(1),
  planId: z.string().regex(/^plan_[a-f0-9]{40}$/),
  revision: z.literal(1),
  status: z.literal("proposed"),
  profileId: z.literal(roundhouseSelfDevelopmentProfile.profileId),
  profileVersion: roundhouseSelfDevelopmentProfileVersionSchema,
  issueNumber: z.number().int().positive(),
  issueContentSha256: sha64,
  subject: z.string().min(1).max(500),
  instructionsSha256: sha64,
  baseCommit: sha40,
  exactPaths: z.array(repositoryRelativePathSchema).min(1).max(50),
  validationLevel: z.enum(["quick", "full"]),
  risk: z.enum(["low", "medium", "high"]),
  understanding: z.string().min(1).max(4_000).optional(),
  acceptanceCriteria: z.array(z.string().min(1).max(500)).max(20).default([]),
  planningAttemptId: z
    .string()
    .regex(/^planning_[a-f0-9]{40}$/)
    .optional(),
  planningEvidence: z.array(z.string().min(1).max(10_000)).max(20).default([]),
  bugReproduction: bugReproductionPlanSchema.optional(),
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
  profileVersion: roundhouseSelfDevelopmentProfileVersionSchema,
  issueNumber: z.number().int().positive(),
  issueContentSha256: sha64,
  subject: z.string().min(1).max(500),
  baseCommit: sha40,
  requestedPaths: z.array(z.string()).max(maxRequestedPaths),
  findings: z.array(qualificationFindingSchema).min(1),
  planningEvidence: z.array(z.string().min(1).max(10_000)).max(20).default([]),
  createdAt: z.iso.datetime(),
  planSha256: sha64,
});

export const nonImplementationQualificationSchema = z
  .object({
    schemaVersion: z.literal(1),
    planId: z.string().regex(/^plan_[a-f0-9]{40}$/),
    revision: z.literal(1),
    status: z.enum(["needs_clarification", "already_satisfied", "duplicate"]),
    profileId: z.literal(roundhouseSelfDevelopmentProfile.profileId),
    profileVersion: roundhouseSelfDevelopmentProfileVersionSchema,
    issueNumber: z.number().int().positive(),
    issueContentSha256: sha64,
    subject: z.string().min(1).max(500),
    baseCommit: sha40,
    understanding: z.string().min(1).max(4_000),
    questions: z.array(z.string().min(1).max(500)).max(5).default([]),
    evidence: z.array(z.string().min(1).max(1_000)).max(20).default([]),
    duplicateOf: z.string().min(1).max(1_000).optional(),
    planningEvidence: z
      .array(z.string().min(1).max(10_000))
      .max(20)
      .default([]),
    createdAt: z.iso.datetime(),
    planSha256: sha64,
  })
  .superRefine((value, context) => {
    if (value.status === "needs_clarification" && value.questions.length === 0)
      context.addIssue({
        code: "custom",
        path: ["questions"],
        message: "Clarification requires targeted questions",
      });
    if (value.status === "already_satisfied" && value.evidence.length === 0)
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "Already satisfied requires concrete repository evidence",
      });
    if (value.status === "duplicate" && !value.duplicateOf)
      context.addIssue({
        code: "custom",
        path: ["duplicateOf"],
        message: "Duplicate requires a durable repository-qualified identity",
      });
  });

export type NonImplementationQualification = z.infer<
  typeof nonImplementationQualificationSchema
>;

export type RejectedQualification = z.infer<typeof rejectedQualificationSchema>;
export type PlanningDecision =
  QualifiedPlan | RejectedQualification | NonImplementationQualification;

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
    /^\s*(?:#{1,6}\s+)?(?:scope|paths?|files?)\s+is\s+exactly\s*:\s*$/i.test(
      line,
    ),
  );
  if (marker < 0) return [];
  const paths: string[] = [];
  for (const line of lines.slice(marker + 1)) {
    const match = /^\s*[-*+]\s+(?:`([^`]+)`|(\S+))\s*$/.exec(line);
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
  if (paths.length > 50)
    findings.push({
      code: "too_many_paths",
      message: "Advisory planning scope exceeds 50 paths",
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
      protectedManifestNames.includes(
        (path.split("/").at(-1) ??
          "") as (typeof protectedManifestNames)[number],
      ) ||
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
      !roundhouseSelfDevelopmentProfile.allowedExactPaths.includes(
        path as never,
      ) &&
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

export function repositoryRisk(paths: string[]): "low" | "medium" {
  const topLevelPrefixes = new Set(paths.map((path) => path.split("/", 1)[0]));
  return paths.length > 4 ||
    topLevelPrefixes.size > 1 ||
    paths.some((path) => path.startsWith("apps/control-plane-worker/"))
    ? "medium"
    : "low";
}

function effectiveRisk(
  paths: string[],
  suggested: "low" | "medium" | "high" | undefined,
): "low" | "medium" | "high" {
  const policyRisk = repositoryRisk(paths);
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return suggested && rank[suggested] > rank[policyRisk]
    ? suggested
    : policyRisk;
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
    planningAttemptId: issue.planningAttemptId,
    requestedPaths: exactPaths,
    understanding: issue.understanding,
    acceptanceCriteria: issue.acceptanceCriteria,
    clarificationQuestions: issue.clarificationQuestions,
    outcome: issue.outcome,
    evidence: issue.evidence,
    duplicateOf: issue.duplicateOf,
    planningEvidence: issue.planningEvidence,
    bugReproduction: issue.bugReproduction,
  });
  const planId = `plan_${(await sha256(identity)).slice(0, 40)}`;
  const createdAt = now.toISOString();
  const outcome =
    issue.outcome ??
    (issue.clarificationQuestions.length > 0
      ? "needs_clarification"
      : "proposed");
  if (
    outcome === "needs_clarification" ||
    outcome === "already_satisfied" ||
    outcome === "duplicate"
  ) {
    const value = {
      schemaVersion: 1 as const,
      planId,
      revision: 1 as const,
      status: outcome,
      profileId: roundhouseSelfDevelopmentProfile.profileId,
      profileVersion: roundhouseSelfDevelopmentProfile.profileVersion,
      issueNumber: issue.issueNumber,
      issueContentSha256: issue.issueContentSha256,
      subject: issue.subject,
      baseCommit: issue.baseCommit,
      understanding:
        issue.understanding ?? "Roundhouse needs more information to proceed.",
      questions: issue.clarificationQuestions,
      evidence: issue.evidence,
      duplicateOf: issue.duplicateOf,
      planningEvidence: issue.planningEvidence,
      createdAt,
    };
    return nonImplementationQualificationSchema.parse({
      ...value,
      planSha256: await sha256(JSON.stringify(value)),
    });
  }
  const findings = pathFindings(exactPaths).filter(
    (finding) =>
      issue.clarificationQuestions.length === 0 ||
      finding.code !== "missing_scope",
  );
  findings.push(
    ...issue.clarificationQuestions.map((question) => ({
      code: "clarification_required" as const,
      message: question,
    })),
  );
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
      planningEvidence: issue.planningEvidence,
      createdAt,
    };
    return rejectedQualificationSchema.parse({
      ...value,
      planSha256: await sha256(JSON.stringify(value)),
    });
  }
  const risk = effectiveRisk(exactPaths, issue.suggestedRisk);
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
    validationLevel: risk === "low" ? ("quick" as const) : ("full" as const),
    risk,
    understanding: issue.understanding,
    acceptanceCriteria: issue.acceptanceCriteria,
    planningAttemptId: issue.planningAttemptId,
    planningEvidence: issue.planningEvidence,
    bugReproduction: issue.bugReproduction,
    limits: {
      maxPatchBytes: roundhouseSelfDevelopmentProfile.maxPatchBytes,
      maxFiles: roundhouseSelfDevelopmentProfile.maxPaths,
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
  profileVersion: roundhouseSelfDevelopmentProfileVersionSchema,
  issueContentSha256: sha64,
  // Historical bindings retain this field. Repository policy, rather than a
  // predicted path-set digest, is authoritative for newly issued plans.
  exactPathsSha256: sha64.optional(),
  approvedBy: z.string().min(1).max(200),
  approvedAt: z.iso.datetime(),
});
