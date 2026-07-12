// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { JobStageExecutor, StageResult } from "./job-ports.js";
import type { JobStage, SelfDevelopmentRun } from "./task.js";

export type ExecutionDispatchRequest = {
  schemaVersion: 1;
  runId: string;
  stage: JobStage;
  attemptNumber: number;
  taskId: string;
  baseCommit: string;
  validationLevel: "quick" | "full";
};

export interface ExecutionDispatcher {
  dispatch(request: ExecutionDispatchRequest): Promise<StageResult>;
}

export class DispatchingStageExecutor implements JobStageExecutor {
  constructor(private readonly dispatcher: ExecutionDispatcher) {}

  execute(stage: JobStage, run: SelfDevelopmentRun): Promise<StageResult> {
    return this.dispatcher.dispatch({
      schemaVersion: 1,
      runId: run.runId,
      stage,
      attemptNumber: run.attempts.filter((attempt) => attempt.stage === stage)
        .length,
      taskId: run.task.taskId,
      baseCommit: run.task.baseCommit,
      validationLevel: run.task.validationLevel,
    });
  }
}
