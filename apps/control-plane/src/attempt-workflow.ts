// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { getSandbox } from "@cloudflare/sandbox";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { RoundhouseAttemptSandbox } from "./attempt-container.js";
import { D1RunRepository } from "./d1-store.js";

export interface AttemptWorkflowParams {
  readonly attemptId: string;
  readonly sandboxName: string;
}

type AttemptWorkflowEnv = Cloudflare.Env & {
  readonly ATTEMPT_SANDBOXES: DurableObjectNamespace<RoundhouseAttemptSandbox>;
};

export class AttemptExecutionWorkflow extends WorkflowEntrypoint<
  AttemptWorkflowEnv,
  AttemptWorkflowParams
> {
  override async run(
    event: WorkflowEvent<AttemptWorkflowParams>,
    step: WorkflowStep,
  ): Promise<{ status: number }> {
    return step.do("restore workspace and dispatch attempt", async () => {
      const { attemptId, sandboxName } = event.payload;
      const startedAt = Date.now();
      const repository = new D1RunRepository(this.env.DB);
      const started = {
        phase: "attempt_workflow_step_started",
        workflowInstanceId: event.instanceId,
        sandboxName,
      };
      console.log(
        JSON.stringify({
          message: "attempt_workflow_trace",
          attemptId,
          ...started,
        }),
      );
      await repository.recordAttemptEvent(
        attemptId,
        "attempt_workflow_trace",
        started,
      );
      try {
        const sandbox = getSandbox(this.env.ATTEMPT_SANDBOXES, sandboxName, {
          enableDefaultSession: false,
        });
        const status = await sandbox.executePreparedAttempt(attemptId);
        const completed = {
          phase: "attempt_workflow_step_completed",
          durationMs: Date.now() - startedAt,
          workflowInstanceId: event.instanceId,
          sandboxName,
          status,
        };
        console.log(
          JSON.stringify({
            message: "attempt_workflow_trace",
            attemptId,
            ...completed,
          }),
        );
        await repository.recordAttemptEvent(
          attemptId,
          "attempt_workflow_trace",
          completed,
        );
        return { status };
      } catch (error) {
        const failure = {
          phase: "attempt_workflow_step_failed",
          durationMs: Date.now() - startedAt,
          workflowInstanceId: event.instanceId,
          sandboxName,
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
          error: error instanceof Error ? error.message : String(error),
        };
        console.error(
          JSON.stringify({
            message: "attempt_workflow_trace",
            attemptId,
            ...failure,
          }),
        );
        await repository.recordAttemptEvent(
          attemptId,
          "attempt_workflow_trace",
          failure,
        );
        throw error;
      }
    });
  }
}
