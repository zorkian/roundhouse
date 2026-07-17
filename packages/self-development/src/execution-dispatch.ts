// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

import { bugReproductionPlanSchema } from "./planning.js";
import type { JobStageExecutor, StageResult } from "./job-ports.js";
import type { JobStage, SelfDevelopmentRun } from "./task.js";
import type { RepositoryPathPolicy } from "./trusted-loop.js";

export const repositoryExecutionRequestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
  attemptId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/),
  attemptNumber: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
  repositoryUrl: z.literal("https://github.com/zorkian/roundhouse.git"),
  baseCommit: z.string().regex(/^[a-f0-9]{40}$/),
  profile: z.literal("roundhouse.v1"),
  command: z.literal("license"),
  scenario: z
    .enum(["success", "nonzero", "timeout", "interrupt-once"])
    .default("success"),
  timeoutMs: z.number().int().positive().max(120_000),
  maxOutputBytes: z.number().int().positive().max(262_144),
});

export type RepositoryExecutionRequest = z.infer<
  typeof repositoryExecutionRequestSchema
>;

export const repositoryExecutionResultSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  baseCommit: z.string().regex(/^[a-f0-9]{40}$/),
  checkoutCommit: z.string().regex(/^[a-f0-9]{40}$/),
  command: z.literal("license"),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  startupDurationMs: z.number().int().nonnegative().default(0),
  checkoutDurationMs: z.number().int().nonnegative().default(0),
  durationMs: z.number().int().nonnegative(),
  stdout: z.string(),
  stderr: z.string(),
  outputTruncated: z.boolean(),
  changedFiles: z.array(z.string()),
  network: z.object({
    checkoutHosts: z.array(z.string()),
    executionInternetEnabled: z.literal(false),
    deniedProbe: z.literal(true),
  }),
  resources: z.object({
    diskBytes: z.number().int().nonnegative(),
    memoryBytes: z.number().int().nonnegative(),
  }),
});

export type RepositoryExecutionResult = z.infer<
  typeof repositoryExecutionResultSchema
>;

export interface RepositoryExecutionBackend {
  execute(request: RepositoryExecutionRequest): Promise<StageResult>;
}

export type ExecutionDispatchRequest = {
  schemaVersion: 1;
  runId: string;
  stage: JobStage;
  attemptNumber: number;
  expectedRevision: number;
  taskId: string;
  subject: string;
  instructions: string;
  retryContext?: string;
  retryFromAttemptId?: string;
  allowedPaths: string[];
  pathPolicy?: RepositoryPathPolicy;
  baseCommit: string;
  validationLevel: "quick" | "full";
  bugReproduction?: z.infer<typeof bugReproductionPlanSchema>;
  planning?: {
    planId: string;
    planSha256: string;
  };
};

export interface ExecutionDispatcher {
  dispatch(request: ExecutionDispatchRequest): Promise<StageResult>;
}

export class DispatchingStageExecutor implements JobStageExecutor {
  constructor(private readonly dispatcher: ExecutionDispatcher) {}

  execute(stage: JobStage, run: SelfDevelopmentRun): Promise<StageResult> {
    const attempt = run.attempts.at(-1);
    if (!attempt || attempt.stage !== stage || attempt.status !== "running")
      throw new Error("Execution dispatch requires a running stage attempt");
    const previousAttempt = run.attempts.at(-2);
    const priorFailure =
      previousAttempt?.classification === "implementation_binding_mismatch"
        ? undefined
        : run.attempts.findLast(
            (value) =>
              value.stage === stage &&
              value.status === "failed" &&
              value.classification === "validation_failed" &&
              value.attemptId !== attempt.attemptId,
          );
    return this.dispatcher.dispatch({
      schemaVersion: 1,
      runId: run.runId,
      stage,
      attemptNumber: attempt.number,
      expectedRevision: run.revision,
      taskId: run.task.taskId,
      subject: run.task.subject,
      instructions: run.task.instructions,
      retryContext: priorFailure?.error,
      retryFromAttemptId: priorFailure?.attemptId,
      allowedPaths: run.task.allowedPaths,
      pathPolicy: run.task.pathPolicy,
      baseCommit: run.task.baseCommit,
      validationLevel: run.task.validationLevel,
      bugReproduction: run.task.bugReproduction,
      planning: run.task.planning
        ? {
            planId: run.task.planning.planId,
            planSha256: run.task.planning.planSha256,
          }
        : undefined,
    });
  }
}
