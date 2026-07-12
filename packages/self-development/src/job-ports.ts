// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type {
  ExecutionEvidence,
  JobStage,
  SelfDevelopmentRun,
  SelfDevelopmentRunState,
  SelfDevelopmentTask,
} from "./task.js";
import type { ExactApproval } from "./trusted-loop.js";

export type Clock = { now(): Date };

export type JobClaim = {
  run: SelfDevelopmentRun;
  token: string;
};

export type AttemptFailure = {
  retryable: boolean;
  classification: string;
  error: string;
  evidence?: ExecutionEvidence[];
};

export type RunUpdates = Partial<
  Pick<
    SelfDevelopmentRun,
    | "workspaceRef"
    | "workspacePath"
    | "commit"
    | "evidence"
    | "implementation"
    | "approval"
    | "publication"
  >
>;

export interface JobStore {
  submit(runId: string, task: SelfDevelopmentTask, now: Date): Promise<void>;
  read(runId: string): Promise<SelfDevelopmentRun>;
  cancel(
    runId: string,
    now: Date,
    expectedRevision?: number,
  ): Promise<SelfDevelopmentRun>;
  approve(
    runId: string,
    approval: ExactApproval,
    expectedRevision: number,
    now: Date,
  ): Promise<SelfDevelopmentRun>;
  recordPublication(
    runId: string,
    publication: NonNullable<SelfDevelopmentRun["publication"]>,
    expectedRevision: number,
    now: Date,
  ): Promise<SelfDevelopmentRun>;
  claim(
    runId: string,
    workerId: string,
    now: Date,
    leaseMs: number,
    expectedRevision?: number,
  ): Promise<JobClaim | null>;
  claimNext(
    workerId: string,
    now: Date,
    leaseMs: number,
  ): Promise<JobClaim | null>;
  renew(
    runId: string,
    token: string,
    now: Date,
    leaseMs: number,
  ): Promise<void>;
  release(runId: string, token: string, now: Date): Promise<void>;
  startAttempt(
    runId: string,
    token: string,
    stage: JobStage,
    now: Date,
  ): Promise<SelfDevelopmentRun>;
  completeAttempt(
    runId: string,
    token: string,
    stage: JobStage,
    state: SelfDevelopmentRunState,
    detail: Record<string, unknown>,
    updates: RunUpdates,
    now: Date,
  ): Promise<SelfDevelopmentRun>;
  failAttempt(
    runId: string,
    token: string,
    stage: JobStage,
    failure: AttemptFailure,
    terminal: boolean,
    now: Date,
  ): Promise<SelfDevelopmentRun>;
}

export type StageResult = {
  state: SelfDevelopmentRunState;
  detail?: Record<string, unknown>;
  updates?: RunUpdates;
};

export interface JobStageExecutor {
  execute(stage: JobStage, run: SelfDevelopmentRun): Promise<StageResult>;
}
