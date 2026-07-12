// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type {
  JobStage,
  SelfDevelopmentRun,
  SelfDevelopmentRunState,
  SelfDevelopmentTask,
} from "./task.js";

export type Clock = { now(): Date };

export type JobClaim = {
  run: SelfDevelopmentRun;
  token: string;
};

export type AttemptFailure = {
  retryable: boolean;
  classification: string;
  error: string;
};

export type RunUpdates = Partial<
  Pick<SelfDevelopmentRun, "workspaceRef" | "workspacePath" | "commit">
>;

export interface JobStore {
  submit(runId: string, task: SelfDevelopmentTask, now: Date): Promise<void>;
  read(runId: string): Promise<SelfDevelopmentRun>;
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
