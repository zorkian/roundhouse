// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { JobStage, SelfDevelopmentRun } from "./task.js";
import type { Clock, JobStageExecutor, JobStore } from "./job-ports.js";

export class StageFailure extends Error {
  constructor(
    message: string,
    readonly classification: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

function stageFor(run: SelfDevelopmentRun): JobStage | null {
  switch (run.state) {
    case "created":
      return "prepare";
    case "workspace_ready":
    case "implementing":
      return "implement";
    case "validating":
      return "validate";
    case "approved":
      return "commit";
    case "committed":
      return "push";
    case "pushed":
      return "complete";
    case "awaiting_approval":
    case "completed":
    case "failed":
    case "cancelled":
      return null;
  }
}

export type ResumableCoordinatorOptions = {
  workerId: string;
  leaseMs?: number;
  maxAttemptsPerStage?: number;
};

export class ResumableCoordinator {
  constructor(
    private readonly store: JobStore,
    private readonly executor: JobStageExecutor,
    private readonly clock: Clock,
    private readonly options: ResumableCoordinatorOptions,
  ) {}

  async submit(runId: string, task: SelfDevelopmentRun["task"]): Promise<void> {
    await this.store.submit(runId, task, this.clock.now());
  }

  async workOnce(): Promise<SelfDevelopmentRun | null> {
    const leaseMs = this.options.leaseMs ?? 30_000;
    const claim = await this.store.claimNext(
      this.options.workerId,
      this.clock.now(),
      leaseMs,
    );
    if (!claim) return null;
    const stage = stageFor(claim.run);
    if (!stage) {
      await this.store.release(claim.run.runId, claim.token);
      return claim.run;
    }
    const started = await this.store.startAttempt(
      claim.run.runId,
      claim.token,
      stage,
      this.clock.now(),
    );
    const attemptCount = started.attempts.filter(
      (attempt) => attempt.stage === stage,
    ).length;
    try {
      const result = await this.executor.execute(stage, started);
      const completed = await this.store.completeAttempt(
        started.runId,
        claim.token,
        stage,
        result.state,
        result.detail ?? {},
        result.updates ?? {},
        this.clock.now(),
      );
      await this.store.release(started.runId, claim.token);
      return completed;
    } catch (error) {
      const failure =
        error instanceof StageFailure
          ? error
          : new StageFailure(
              error instanceof Error ? error.message : "Unknown stage error",
              "unexpected",
              false,
            );
      const terminal =
        !failure.retryable ||
        attemptCount >= (this.options.maxAttemptsPerStage ?? 3);
      const failed = await this.store.failAttempt(
        started.runId,
        claim.token,
        stage,
        {
          retryable: failure.retryable,
          classification: failure.classification,
          error: failure.message,
        },
        terminal,
        this.clock.now(),
      );
      await this.store.release(started.runId, claim.token);
      return failed;
    }
  }
}
