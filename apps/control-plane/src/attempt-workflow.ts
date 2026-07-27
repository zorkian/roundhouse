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
  destroyAttemptSandboxWithTrace,
  type SandboxNamespace,
} from "./attempt-runtime.js";
import {
  acceptRecordedAttemptCompletion,
  backupRecordedAttemptWorkspace,
  loadRecordedAttemptCompletion,
  publishRecordedAttemptCompletion,
  recordAttemptCompletion,
  validateRecordedAttemptCompletion,
  type AttemptSettlementEnv,
  type AttemptSettlementResult,
} from "./attempt-settlement.js";
import { D1RunRepository } from "./d1-store.js";

export interface AttemptWorkflowParams {
  readonly attemptId: string;
  readonly sandboxName: string;
  readonly mode?: "execute" | "settle";
}

type AttemptWorkflowEnv = AttemptSettlementEnv & {
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

export class AttemptExecutionWorkflow extends WorkflowEntrypoint<
  AttemptWorkflowEnv,
  AttemptWorkflowParams
> {
  override async run(
    event: WorkflowEvent<AttemptWorkflowParams>,
    step: WorkflowStep,
  ): Promise<AttemptSettlementResult> {
    const { attemptId, sandboxName } = event.payload;
    const mode = event.payload.mode ?? "execute";
    const repository = new D1RunRepository(this.env.DB);
    const sandbox = getSandbox(this.env.ATTEMPT_SANDBOXES, sandboxName, {
      enableDefaultSession: false,
    });

    let completion: AttemptCompletion;
    if (mode === "execute") {
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

      const serializedCompletion = await step.do(
        "execute prepared attempt",
        { ...noExecutionRetry, timeout: attachedStepTimeout },
        async (): Promise<string> => {
          const startedAt = Date.now();
          await trace(
            repository,
            attemptId,
            event.instanceId,
            sandboxName,
            "attempt_workflow_execution_started",
          );
          try {
            const result = await sandbox.executePreparedAttempt(attemptId);
            await trace(
              repository,
              attemptId,
              event.instanceId,
              sandboxName,
              "attempt_workflow_execution_completed",
              startedAt,
            );
            return JSON.stringify(result);
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
      completion = JSON.parse(serializedCompletion) as AttemptCompletion;
      const recorded = await step.do(
        "record completed execution",
        async (): Promise<"recorded" | "duplicate" | "stale"> =>
          recordAttemptCompletion(this.env, completion),
      );
      if (recorded === "stale")
        throw new Error("attempt_execution_record_stale");
    } else {
      const serializedCompletion = await step.do(
        "load recorded execution",
        async (): Promise<string> =>
          JSON.stringify(
            await loadRecordedAttemptCompletion(this.env, attemptId),
          ),
      );
      completion = JSON.parse(serializedCompletion) as AttemptCompletion;
      await trace(
        repository,
        attemptId,
        event.instanceId,
        sandboxName,
        "attempt_workflow_settlement_resumed",
        undefined,
        {
          expectedRevision: completion.expectedRevision,
          outputHead: completion.checkpoint.outputHead,
        },
      );
    }

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
