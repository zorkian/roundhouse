// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { getSandbox } from "@cloudflare/sandbox";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { AttemptCompletion } from "./callback.js";
import type { RoundhouseAttemptSandbox } from "./attempt-container.js";
import {
  prepareAttemptExecution,
  type AttemptPreparationEnv,
  type AttemptWorkflowParams,
} from "./attempt-dispatch.js";
import {
  destroyAttemptSandboxWithTrace,
  type SandboxNamespace,
} from "./attempt-runtime.js";
import {
  acceptRecordedAttemptCompletion,
  backupRecordedAttemptWorkspace,
  loadRecordedAttemptCompletion,
  publishRecordedAttemptCompletion,
  validateRecordedAttemptCompletion,
  type AttemptSettlementEnv,
  type AttemptSettlementResult,
} from "./attempt-settlement.js";
import { D1RunRepository } from "./d1-store.js";
import { publishWakeup } from "./liveness.js";

type AttemptWorkflowEnv = AttemptSettlementEnv &
  AttemptPreparationEnv & {
    readonly ATTEMPT_SANDBOXES: SandboxNamespace;
  };

const noExecutionRetry = {
  retries: {
    limit: 0,
    delay: 0,
    backoff: "constant",
  },
} as const;
// D1 activity leases, rather than the transport, decide when an attempt has
// become inactive. Use the platform's maximum step timeout so an attached
// runner request is not cut off while progress is still arriving.
const attachedStepTimeout = "365 days";

async function trace(
  repository: D1RunRepository,
  attemptId: string,
  workflowInstanceId: string,
  sandboxName: string,
  phase: string,
  startedAt?: number,
  detail: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  const payload = {
    phase,
    workflowInstanceId,
    sandboxName,
    ...(startedAt === undefined ? {} : { durationMs: Date.now() - startedAt }),
    ...detail,
  };
  const log = { message: "attempt_workflow_trace", attemptId, ...payload };
  if (phase.endsWith("_failed")) console.error(JSON.stringify(log));
  else console.log(JSON.stringify(log));
  try {
    await repository.recordAttemptEvent(
      attemptId,
      "attempt_workflow_trace",
      payload,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "attempt_workflow_trace_record_failed",
        attemptId,
        workflowInstanceId,
        phase,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function recordTerminalWorkflowFailure(
  env: AttemptWorkflowEnv,
  event: WorkflowEvent<AttemptWorkflowParams>,
  error: unknown,
): Promise<void> {
  const { attemptId, mode, sandboxName } = event.payload;
  const repository = new D1RunRepository(env.DB);
  const attempt = await repository.getAttempt(attemptId);
  const payload = {
    phase: "attempt_workflow_terminal_failure",
    workflowInstanceId: event.instanceId,
    mode: mode ?? "execute",
    attemptState: attempt?.state ?? "missing",
    errorType: error instanceof Error ? error.constructor.name : typeof error,
    error: error instanceof Error ? error.message : String(error),
  };
  console.error(
    JSON.stringify({
      message: "attempt_workflow_terminal_failure",
      attemptId,
      ...payload,
    }),
  );
  if (!attempt) return;
  await repository.recordAttemptEvent(
    attemptId,
    "attempt_workflow_terminal_failure",
    payload,
  );
  const wakeup = {
    runId: attempt.runId,
    expectedRevision: attempt.runRevision,
  };
  let settlement: "completed" | "failed" | "duplicate" | "stale" | "deferred";
  if (attempt.state === "created" || attempt.state === "dispatched") {
    settlement = await repository.settleAttemptOutcome(
      attempt.id,
      attempt.runRevision,
      "failed",
      {
        kind: "execution_interrupted",
        source: "attempt_workflow",
      },
    );
  } else {
    settlement = "deferred";
    await repository.requestWakeup(wakeup);
  }
  console.log(
    JSON.stringify({
      message: "attempt_workflow_terminal_failure_recorded",
      attemptId,
      runId: attempt.runId,
      expectedRevision: attempt.runRevision,
      attemptState: attempt.state,
      settlement,
    }),
  );
  if (settlement === "failed" && sandboxName !== attempt.runId) {
    try {
      await destroyAttemptSandboxWithTrace(
        env.ATTEMPT_SANDBOXES,
        sandboxName,
        attemptId,
        async (tracedAttemptId, phase, detail) => {
          await repository.recordAttemptEvent(
            tracedAttemptId,
            "sandbox_trace",
            {
              phase,
              workflowInstanceId: event.instanceId,
              reason: "terminal_workflow_failure",
              ...detail,
            },
          );
        },
      );
    } catch (cleanupError) {
      console.error(
        JSON.stringify({
          message: "attempt_workflow_terminal_failure_cleanup_failed",
          attemptId,
          runId: attempt.runId,
          workflowInstanceId: event.instanceId,
          sandboxName,
          errorType:
            cleanupError instanceof Error
              ? cleanupError.constructor.name
              : typeof cleanupError,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        }),
      );
    }
  }
  await publishWakeup(repository, env.RUN_WAKEUPS, wakeup);
}

export class AttemptExecutionWorkflow extends WorkflowEntrypoint<
  AttemptWorkflowEnv,
  AttemptWorkflowParams
> {
  override async run(
    event: WorkflowEvent<AttemptWorkflowParams>,
    step: WorkflowStep,
  ): Promise<AttemptSettlementResult> {
    try {
      return await this.execute(event, step);
    } catch (error) {
      try {
        await recordTerminalWorkflowFailure(this.env, event, error);
      } catch (recordError) {
        console.error(
          JSON.stringify({
            message: "attempt_workflow_terminal_failure_record_failed",
            attemptId: event.payload.attemptId,
            workflowInstanceId: event.instanceId,
            errorType:
              recordError instanceof Error
                ? recordError.constructor.name
                : typeof recordError,
            error:
              recordError instanceof Error
                ? recordError.message
                : String(recordError),
          }),
        );
      }
      throw error;
    }
  }

  private async execute(
    event: WorkflowEvent<AttemptWorkflowParams>,
    step: WorkflowStep,
  ): Promise<AttemptSettlementResult> {
    const { attemptId, sandboxName } = event.payload;
    const mode = event.payload.mode ?? "execute";
    const repository = new D1RunRepository(this.env.DB);
    const sandbox = getSandbox(this.env.ATTEMPT_SANDBOXES, sandboxName, {
      enableDefaultSession: false,
    });

    if (mode === "execute") {
      await step.do("confirm durable dispatch", async (): Promise<void> => {
        const startedAt = Date.now();
        await repository.markDispatched(attemptId);
        await trace(
          repository,
          attemptId,
          event.instanceId,
          sandboxName,
          "attempt_workflow_dispatch_confirmed",
          startedAt,
        );
      });

      await step.do(
        "prepare attempt",
        { timeout: attachedStepTimeout },
        async (): Promise<void> => {
          const startedAt = Date.now();
          await trace(
            repository,
            attemptId,
            event.instanceId,
            sandboxName,
            "attempt_workflow_preparation_started",
          );
          try {
            await prepareAttemptExecution(this.env, attemptId);
            await trace(
              repository,
              attemptId,
              event.instanceId,
              sandboxName,
              "attempt_workflow_preparation_completed",
              startedAt,
            );
          } catch (error) {
            await trace(
              repository,
              attemptId,
              event.instanceId,
              sandboxName,
              "attempt_workflow_preparation_failed",
              startedAt,
              {
                errorType:
                  error instanceof Error
                    ? error.constructor.name
                    : typeof error,
                error: error instanceof Error ? error.message : String(error),
              },
            );
            throw error;
          }
        },
      );

      await step.do(
        "restore prepared workspace",
        { timeout: attachedStepTimeout },
        async (): Promise<void> => {
          const startedAt = Date.now();
          await trace(
            repository,
            attemptId,
            event.instanceId,
            sandboxName,
            "attempt_workflow_restore_started",
          );
          try {
            await sandbox.restorePreparedAttempt(attemptId);
            await trace(
              repository,
              attemptId,
              event.instanceId,
              sandboxName,
              "attempt_workflow_restore_completed",
              startedAt,
            );
          } catch (error) {
            await trace(
              repository,
              attemptId,
              event.instanceId,
              sandboxName,
              "attempt_workflow_restore_failed",
              startedAt,
              {
                errorType:
                  error instanceof Error
                    ? error.constructor.name
                    : typeof error,
                error: error instanceof Error ? error.message : String(error),
              },
            );
            throw error;
          }
        },
      );

      await step.do(
        "execute prepared attempt",
        { ...noExecutionRetry, timeout: attachedStepTimeout },
        async (): Promise<void> => {
          const startedAt = Date.now();
          await trace(
            repository,
            attemptId,
            event.instanceId,
            sandboxName,
            "attempt_workflow_execution_started",
          );
          try {
            await sandbox.executePreparedAttempt(attemptId);
            await trace(
              repository,
              attemptId,
              event.instanceId,
              sandboxName,
              "attempt_workflow_execution_completed",
              startedAt,
            );
          } catch (error) {
            await trace(
              repository,
              attemptId,
              event.instanceId,
              sandboxName,
              "attempt_workflow_execution_failed",
              startedAt,
              {
                errorType:
                  error instanceof Error
                    ? error.constructor.name
                    : typeof error,
                error: error instanceof Error ? error.message : String(error),
              },
            );
            throw error;
          }
        },
      );
    }
    const serializedCompletion = await step.do(
      "load recorded execution",
      async (): Promise<string> =>
        JSON.stringify(
          await loadRecordedAttemptCompletion(this.env, attemptId),
        ),
    );
    const completion = JSON.parse(serializedCompletion) as AttemptCompletion;
    await trace(
      repository,
      attemptId,
      event.instanceId,
      sandboxName,
      mode === "settle"
        ? "attempt_workflow_settlement_resumed"
        : "attempt_workflow_completion_loaded",
      undefined,
      {
        expectedRevision: completion.expectedRevision,
        outputHead: completion.checkpoint.outputHead,
      },
    );

    const validation = await step.do(
      "validate completed attempt",
      { timeout: attachedStepTimeout },
      async () => {
        const startedAt = Date.now();
        await trace(
          repository,
          attemptId,
          event.instanceId,
          sandboxName,
          "attempt_workflow_validation_started",
        );
        try {
          const result = await validateRecordedAttemptCompletion(
            this.env,
            completion,
          );
          await trace(
            repository,
            attemptId,
            event.instanceId,
            sandboxName,
            "attempt_workflow_validation_completed",
            startedAt,
            { outcome: result.outcome },
          );
          return result;
        } catch (error) {
          await trace(
            repository,
            attemptId,
            event.instanceId,
            sandboxName,
            "attempt_workflow_validation_failed",
            startedAt,
            {
              errorType:
                error instanceof Error ? error.constructor.name : typeof error,
              error: error instanceof Error ? error.message : String(error),
            },
          );
          throw error;
        }
      },
    );
    if (validation.outcome !== "validated") {
      if (validation.sandboxName)
        await step.do("destroy rejected attempt sandbox", async () => {
          await destroyAttemptSandboxWithTrace(
            this.env.ATTEMPT_SANDBOXES,
            validation.sandboxName!,
            attemptId,
          );
        });
      return validation as AttemptSettlementResult;
    }

    await step.do("backup completed workspace", noExecutionRetry, async () =>
      backupRecordedAttemptWorkspace(this.env, completion),
    );

    const publication = await step.do(
      "publish completed attempt",
      { timeout: attachedStepTimeout },
      async () => {
        const startedAt = Date.now();
        await trace(
          repository,
          attemptId,
          event.instanceId,
          sandboxName,
          "attempt_workflow_publication_started",
        );
        try {
          const result = await publishRecordedAttemptCompletion(
            this.env,
            completion,
          );
          await trace(
            repository,
            attemptId,
            event.instanceId,
            sandboxName,
            "attempt_workflow_publication_completed",
            startedAt,
            { outcome: result.outcome },
          );
          return result;
        } catch (error) {
          await trace(
            repository,
            attemptId,
            event.instanceId,
            sandboxName,
            "attempt_workflow_publication_failed",
            startedAt,
            {
              errorType:
                error instanceof Error ? error.constructor.name : typeof error,
              error: error instanceof Error ? error.message : String(error),
            },
          );
          throw error;
        }
      },
    );
    if (publication.outcome !== "published") {
      if (publication.sandboxName)
        await step.do("destroy unpublished attempt sandbox", async () => {
          await destroyAttemptSandboxWithTrace(
            this.env.ATTEMPT_SANDBOXES,
            publication.sandboxName!,
            attemptId,
          );
        });
      return publication as AttemptSettlementResult;
    }

    const settlement = await step.do(
      "accept completed attempt",
      async (): Promise<AttemptSettlementResult> => {
        const startedAt = Date.now();
        await trace(
          repository,
          attemptId,
          event.instanceId,
          sandboxName,
          "attempt_workflow_settlement_started",
        );
        try {
          const result = await acceptRecordedAttemptCompletion(
            this.env,
            completion,
          );
          await trace(
            repository,
            attemptId,
            event.instanceId,
            sandboxName,
            "attempt_workflow_settlement_completed",
            startedAt,
            { outcome: result.outcome },
          );
          return result;
        } catch (error) {
          await trace(
            repository,
            attemptId,
            event.instanceId,
            sandboxName,
            "attempt_workflow_settlement_failed",
            startedAt,
            {
              errorType:
                error instanceof Error ? error.constructor.name : typeof error,
              error: error instanceof Error ? error.message : String(error),
            },
          );
          throw error;
        }
      },
    );

    if (settlement.sandboxName)
      await step.do("destroy settled attempt sandbox", async () => {
        await destroyAttemptSandboxWithTrace(
          this.env.ATTEMPT_SANDBOXES,
          settlement.sandboxName!,
          attemptId,
          async (tracedAttemptId, phase, detail) => {
            await repository.recordAttemptEvent(
              tracedAttemptId,
              "sandbox_trace",
              { phase, ...detail },
            );
          },
        );
      });

    return settlement;
  }
}
