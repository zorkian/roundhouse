// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

import { roundhouseFormatterWriteCommand } from "@roundhouse/repository-profile/contracts";
export { roundhouseFormatterWriteCommand } from "@roundhouse/repository-profile/contracts";

import type { StageResult } from "./job-ports.js";

const boundedIdentity = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/);
const runIdentity = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const bugReproductionPlanSchema = z.discriminatedUnion("applicability", [
  z.object({
    applicability: z.literal("applicable"),
    command: z.string().min(1).max(500),
  }),
  z.object({
    applicability: z.literal("not_applicable"),
    rationale: z.string().min(1).max(500),
  }),
]);
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

const repositoryPathPrefixSchema = z
  .string()
  .min(2)
  .max(300)
  .refine(
    (value) =>
      repositoryRelativePathSchema.safeParse(
        value.endsWith("/") ? value.slice(0, -1) : value,
      ).success,
    "Prefix must be normalized and repository-relative",
  );

const repositoryBasenameSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(
    (value) =>
      !value.includes("/") &&
      !value.includes("\\") &&
      !/[\u0000-\u001f\u007f]/.test(value),
    "Basename must not contain separators or control characters",
  );

function uniqueValues<T>(values: T[]): boolean {
  return new Set(values).size === values.length;
}

export const repositoryPathPolicySchema = z.object({
  allowedExactPaths: z
    .array(repositoryRelativePathSchema)
    .max(50)
    .refine(uniqueValues),
  allowedPrefixes: z
    .array(repositoryPathPrefixSchema)
    .max(50)
    .refine(uniqueValues),
  deniedExactPaths: z
    .array(repositoryRelativePathSchema)
    .max(50)
    .refine(uniqueValues),
  deniedPrefixes: z
    .array(repositoryPathPrefixSchema)
    .max(50)
    .refine(uniqueValues),
  deniedBasenames: z
    .array(repositoryBasenameSchema)
    .max(50)
    .refine(uniqueValues),
  maxChangedFiles: z.number().int().positive().max(50),
});

export type RepositoryPathPolicy = z.infer<typeof repositoryPathPolicySchema>;

export function repositoryPathAllowed(
  policy: RepositoryPathPolicy,
  path: string,
): boolean {
  if (!repositoryRelativePathSchema.safeParse(path).success) return false;
  const basename = path.split("/").at(-1) ?? "";
  if (
    policy.deniedExactPaths.includes(path) ||
    policy.deniedPrefixes.some((prefix) => path.startsWith(prefix)) ||
    policy.deniedBasenames.includes(basename)
  )
    return false;
  return (
    policy.allowedExactPaths.includes(path) ||
    policy.allowedPrefixes.some((prefix) => path.startsWith(prefix))
  );
}

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

export const implementationModel = "gpt-5.5" as const;
export const implementationModelEffort = "medium" as const;

export const trustedImplementationRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: runIdentity,
    attemptId: boundedIdentity,
    attemptNumber: z.number().int().positive(),
    expectedRevision: z.number().int().positive(),
    repositoryUrl: z.literal("https://github.com/zorkian/roundhouse.git"),
    baseCommit: commit,
    subject: z.string().min(1).max(500),
    instructions: z.string().min(1).max(20_000),
    model: z.literal(implementationModel).optional(),
    modelEffort: z.literal(implementationModelEffort).optional(),
    retryContext: z.string().min(1).max(20_000).optional(),
    retryFromAttemptId: boundedIdentity.optional(),
    retryCandidate: z
      .object({
        attemptId: boundedIdentity,
        patch: z
          .string()
          .min(1)
          .max(512 * 1024),
        patchSha256: sha256,
        changedFiles: z.array(repositoryRelativePathSchema).min(1).max(50),
      })
      .optional(),
    allowedPaths: z.array(repositoryRelativePathSchema).min(1).max(50),
    pathPolicy: repositoryPathPolicySchema.optional(),
    validationLevel: z.enum(["quick", "full"]),
    formatter: z
      .object({
        command: z.literal(roundhouseFormatterWriteCommand.command),
        args: z.tuple([
          z.literal("exec"),
          z.literal("prettier"),
          z.literal("--write"),
        ]),
      })
      .default({
        command: roundhouseFormatterWriteCommand.command,
        args: [...roundhouseFormatterWriteCommand.args],
      }),
    bugReproduction: bugReproductionPlanSchema.optional(),
    planning: z
      .object({
        planId: z.string().regex(/^plan_[a-f0-9]{40}$/),
        planSha256: sha256,
      })
      .optional(),
    agentTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(2 * 60 * 60_000),
    validationTimeoutMs: z
      .number()
      .int()
      .positive()
      .max(30 * 60_000),
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
  })
  .superRefine((request, context) => {
    if ((request.model === undefined) !== (request.modelEffort === undefined))
      context.addIssue({
        code: "custom",
        path: [request.model === undefined ? "model" : "modelEffort"],
        message: "Model and effort must be routed together",
      });
    if (
      request.pathPolicy &&
      request.pathPolicy.maxChangedFiles !== request.maxChangedFiles
    )
      context.addIssue({
        code: "custom",
        path: ["maxChangedFiles"],
        message: "Changed-file limit must match the trusted path policy",
      });
  });

export type TrustedImplementationRequest = z.infer<
  typeof trustedImplementationRequestSchema
>;

export const validationCommandEvidenceSchema = z.object({
  name: z.enum([
    "plan-compliance",
    "repository-policy",
    "bug-regression",
    "format-write",
    "diff-check",
    "format",
    "license",
    "typecheck",
    "test",
  ]),
  command: z.string().min(1).max(500),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  stdout: z.string(),
  stderr: z.string(),
  outputTruncated: z.boolean(),
});

export const trustedValidationEvidenceLimit = 8;

export const regressionEvidenceSchema = z
  .object({
    repositoryUrl: z.literal("https://github.com/zorkian/roundhouse.git"),
    baseCommit: commit,
    planId: z.string().regex(/^plan_[a-f0-9]{40}$/),
    planSha256: sha256,
    attemptId: boundedIdentity,
    headPatchSha256: sha256,
    command: z.string().min(1).max(500).optional(),
    preChange: z.object({
      outcome: z.enum([
        "reproduced",
        "cannot_reproduce",
        "timeout",
        "unsafe",
        "not_applicable",
      ]),
      summary: z.string().min(1).max(2_000),
      output: z.string().max(20_000),
      outputTruncated: z.boolean(),
    }),
    postChange: z
      .object({
        outcome: z.enum(["passed", "failed", "timeout", "unsafe"]),
        summary: z.string().min(1).max(2_000),
        output: z.string().max(20_000),
        outputTruncated: z.boolean(),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.preChange.outcome === "reproduced" && !value.postChange)
      context.addIssue({
        code: "custom",
        path: ["postChange"],
        message: "A reproduced bug requires a post-change regression result",
      });
    if (value.preChange.outcome === "not_applicable" && value.command)
      context.addIssue({
        code: "custom",
        path: ["command"],
        message: "Not-applicable evidence cannot authorize a command",
      });
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
  retryLineage: z
    .object({
      priorAttemptId: boundedIdentity,
      priorPatchSha256: sha256,
      priorChangedFiles: z.array(repositoryRelativePathSchema).min(1).max(50),
      retainedAllPriorPaths: z.boolean(),
    })
    .optional(),
  validationOutcome: z.enum(["passed", "failed"]).default("passed"),
  publicationManifest: trustedPublicationManifestSchema.optional(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  startupDurationMs: z.number().int().nonnegative().default(0),
  checkoutDurationMs: z.number().int().nonnegative(),
  agentDurationMs: z.number().int().nonnegative(),
  validationDurationMs: z.number().int().nonnegative(),
  agent: z.object({
    provider: z.literal("codex-subscription"),
    requestedModel: z.literal(implementationModel).optional(),
    requestedEffort: z.literal(implementationModelEffort).optional(),
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
  validation: z
    .array(validationCommandEvidenceSchema)
    .min(1)
    .max(trustedValidationEvidenceLimit),
  regressionEvidence: regressionEvidenceSchema.optional(),
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
