// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  BranchChangedError,
  callbackPayload,
  CheckpointRejectedError,
  signCallback,
  verifyCallback,
  type AttemptCallback,
  type AttemptCompletion,
} from "./callback.js";
import {
  annotateProtectedPathProposal,
  type Attempt,
  type CompetitionJudgement,
  type RunSnapshot,
} from "@roundhouse/core";
import { D1RunRepository, type D1Like } from "./d1-store.js";
import {
  artifactsNamespace,
  attemptSandbox,
  attemptWorkspaceBackupKey,
  attemptWorkspaceRef,
  SandboxCheckpointPublisher,
  SandboxCheckpointValidator,
  artifactRepositoryName,
  sandboxName,
  saveWorkspaceBackup,
  workspaceBackup,
  type SandboxNamespace,
} from "./attempt-runtime.js";
import type { CompetitionPromoter } from "./coordinator.js";
import type { GitHubEnv } from "./github.js";
import { publishWakeup } from "./liveness.js";

export type AttemptSettlementOutcome =
  "completed" | "duplicate" | "rejected" | "stale" | "unauthorized";

export interface AttemptSettlementResult {
  readonly outcome: AttemptSettlementOutcome;
  readonly attemptId: string;
  readonly sandboxName?: string;
}

export interface AttemptValidationResult {
  readonly outcome: "validated" | "duplicate" | "rejected" | "stale";
  readonly attemptId: string;
  readonly sandboxName?: string;
}

export interface AttemptBackupResult {
  readonly outcome: "completed" | "skipped" | "unavailable";
  readonly attemptId: string;
  readonly backupId?: string;
  readonly error?: string;
}

export interface AttemptPublicationResult {
  readonly outcome: "published" | "duplicate" | "rejected" | "stale";
  readonly attemptId: string;
  readonly sandboxName?: string;
}

export type AttemptSettlementEnv = Cloudflare.Env &
  GitHubEnv & {
    readonly DB: D1Like;
    readonly CALLBACK_SIGNING_SECRET: string;
    readonly ATTEMPT_SANDBOXES: SandboxNamespace;
  };

async function recordedCallback(
  env: AttemptSettlementEnv,
  completion: AttemptCompletion,
): Promise<AttemptCallback | undefined> {
  const repository = new D1RunRepository(env.DB);
  const attempt = await repository.getAttempt(completion.attemptId);
  if (
    !attempt ||
    attempt.runRevision !== completion.expectedRevision ||
    !["executed", "completed"].includes(attempt.state)
  )
    return undefined;
  const recorded = await repository.getAttemptCompletion(completion.attemptId);
  if (!recorded || callbackPayload(recorded) !== callbackPayload(completion))
    return undefined;
  return callbackForCompletion(env.CALLBACK_SIGNING_SECRET, completion);
}

async function settlementResult(
  repository: D1RunRepository,
  attemptId: string,
  outcome: AttemptSettlementOutcome,
): Promise<AttemptSettlementResult> {
  const attempt = await repository.getAttempt(attemptId);
  return {
    outcome,
    attemptId,
    ...(attempt ? { sandboxName: sandboxName(attempt) } : {}),
  };
}

async function enqueueAttemptWakeup(
  env: AttemptSettlementEnv,
  attempt: { readonly runId: string; readonly runRevision: number },
): Promise<void> {
  const wakeup = {
    runId: attempt.runId,
    expectedRevision: attempt.runRevision,
  };
  await publishWakeup(new D1RunRepository(env.DB), env.RUN_WAKEUPS, wakeup);
}

export async function recordAttemptCompletion(
  env: AttemptSettlementEnv,
  completion: AttemptCompletion,
): Promise<"recorded" | "duplicate" | "stale"> {
  const repository = new D1RunRepository(env.DB);
  const outcome = await repository.recordAttemptExecution(
    completion.attemptId,
    completion.expectedRevision,
    completion,
  );
  const payload = {
    phase: "execution_recorded",
    outcome,
    expectedRevision: completion.expectedRevision,
    inputHead: completion.checkpoint.inputHead,
    outputHead: completion.checkpoint.outputHead,
  };
  console.log(
    JSON.stringify({
      message: "attempt_execution_recorded",
      attemptId: completion.attemptId,
      ...payload,
    }),
  );
  await repository.recordAttemptEvent(
    completion.attemptId,
    "attempt_execution_recorded",
    payload,
  );
  return outcome;
}

export async function loadRecordedAttemptCompletion(
  env: AttemptSettlementEnv,
  attemptId: string,
): Promise<AttemptCompletion> {
  const repository = new D1RunRepository(env.DB);
  const attempt = await repository.getAttempt(attemptId);
  const completion = await repository.getAttemptCompletion(attemptId);
  if (
    !attempt ||
    !completion ||
    !["executed", "completed"].includes(attempt.state)
  )
    throw new Error("recorded_attempt_completion_missing");
  console.log(
    JSON.stringify({
      message: "attempt_execution_loaded",
      attemptId,
      state: attempt.state,
      expectedRevision: completion.expectedRevision,
      inputHead: completion.checkpoint.inputHead,
      outputHead: completion.checkpoint.outputHead,
    }),
  );
  return completion;
}

export function observedBranchHead(detail: string): string | undefined {
  try {
    const parsed = JSON.parse(detail) as { detail?: unknown };
    const message = typeof parsed.detail === "string" ? parsed.detail : detail;
    return /^publish_branch_changed:([a-f0-9]{40})$/.exec(message)?.[1];
  } catch {
    return /^publish_branch_changed:([a-f0-9]{40})$/.exec(detail)?.[1];
  }
}

async function recordRejectedAttemptOutcome(
  env: AttemptSettlementEnv,
  input: AttemptCallback,
  kind: "checkpoint_rejected" | "branch_superseded",
  status: number,
  detail: string,
): Promise<AttemptSettlementResult> {
  const repository = new D1RunRepository(env.DB);
  const attempt = await repository.getAttempt(input.attemptId);
  if (!attempt || attempt.runRevision !== input.expectedRevision)
    return settlementResult(repository, input.attemptId, "stale");
  const observedHead =
    kind === "branch_superseded" ? observedBranchHead(detail) : undefined;
  if (kind === "branch_superseded" && !observedHead)
    throw new Error("branch_superseded_head_missing");
  const outcome =
    kind === "branch_superseded"
      ? {
          kind,
          source: "checkpoint_publisher" as const,
          status,
          detail,
          observedHead: observedHead!,
        }
      : {
          kind,
          source: "checkpoint_validator" as const,
          status,
          detail,
        };
  const settled = await repository.settleAttemptOutcome(
    input.attemptId,
    input.expectedRevision,
    "completed",
    outcome,
    observedHead ?? attempt.expectedHead,
    input.result,
  );
  if (settled === "completed" || settled === "duplicate")
    await enqueueAttemptWakeup(env, attempt);
  const payload = {
    phase: "attempt_outcome_recorded",
    runId: attempt.runId,
    attemptRevision: attempt.runRevision,
    stage: attempt.stage,
    nodeId: attempt.nodeId,
    outcome,
    attemptSettlement: settled,
  };
  console.log(
    JSON.stringify({
      message: "attempt_outcome_recorded",
      attemptId: attempt.id,
      ...payload,
    }),
  );
  await repository.recordAttemptEvent(attempt.id, "attempt_outcome", payload);
  return settlementResult(repository, input.attemptId, "rejected");
}

export async function validateRecordedAttemptCompletion(
  env: AttemptSettlementEnv,
  completion: AttemptCompletion,
): Promise<AttemptValidationResult> {
  const repository = new D1RunRepository(env.DB);
  const input = await recordedCallback(env, completion);
  if (!input)
    return settlementResult(
      repository,
      completion.attemptId,
      "stale",
    ) as Promise<AttemptValidationResult>;
  const attempt = await repository.getAttempt(input.attemptId);
  if (attempt?.state === "completed") {
    if (attempt.outcome) await enqueueAttemptWakeup(env, attempt);
    return settlementResult(
      repository,
      input.attemptId,
      "duplicate",
    ) as Promise<AttemptValidationResult>;
  }
  try {
    await new SandboxCheckpointValidator(
      env.ATTEMPT_SANDBOXES,
      artifactsNamespace(env),
      repository,
    ).validate(input);
  } catch (error) {
    if (!(error instanceof CheckpointRejectedError)) throw error;
    return (await recordRejectedAttemptOutcome(
      env,
      input,
      "checkpoint_rejected",
      error.status,
      error.detail,
    )) as AttemptValidationResult;
  }
  console.log(
    JSON.stringify({
      message: "attempt_checkpoint_validated",
      attemptId: input.attemptId,
      expectedRevision: input.expectedRevision,
      outputHead: input.checkpoint.outputHead,
    }),
  );
  await repository.recordAttemptEvent(input.attemptId, "attempt_settlement", {
    phase: "checkpoint_validated",
    expectedRevision: input.expectedRevision,
    outputHead: input.checkpoint.outputHead,
  });
  return {
    outcome: "validated",
    attemptId: input.attemptId,
    ...(attempt ? { sandboxName: sandboxName(attempt) } : {}),
  };
}

export async function backupRecordedAttemptWorkspace(
  env: AttemptSettlementEnv,
  completion: AttemptCompletion,
): Promise<AttemptBackupResult> {
  const repository = new D1RunRepository(env.DB);
  const attempt = await repository.getAttempt(completion.attemptId);
  if (!attempt || attempt.runRevision !== completion.expectedRevision)
    return {
      outcome: "unavailable",
      attemptId: completion.attemptId,
      error: "attempt_not_found",
    };
  if (attempt.stage !== "implement")
    return { outcome: "skipped", attemptId: attempt.id };
  const startedAt = Date.now();
  try {
    const backup = await attemptSandbox(
      env.ATTEMPT_SANDBOXES,
      sandboxName(attempt),
    ).backupWorkspace(attempt.id, attempt.runId);
    await saveWorkspaceBackup(
      repository.database,
      attemptWorkspaceBackupKey(attempt),
      attempt.id,
      backup,
    );
    const payload = {
      phase: "workspace_backup_completed",
      backupId: backup.id,
      durationMs: Date.now() - startedAt,
    };
    console.log(
      JSON.stringify({
        message: "attempt_workspace_backup_completed",
        attemptId: attempt.id,
        ...payload,
      }),
    );
    await repository.recordAttemptEvent(
      attempt.id,
      "attempt_settlement",
      payload,
    );
    return { outcome: "completed", attemptId: attempt.id, backupId: backup.id };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const payload = {
      phase: "workspace_backup_unavailable",
      durationMs: Date.now() - startedAt,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      error: detail,
    };
    console.error(
      JSON.stringify({
        message: "attempt_workspace_backup_unavailable",
        attemptId: attempt.id,
        ...payload,
      }),
    );
    await repository.recordAttemptEvent(
      attempt.id,
      "attempt_settlement",
      payload,
    );
    return { outcome: "unavailable", attemptId: attempt.id, error: detail };
  }
}

export async function publishRecordedAttemptCompletion(
  env: AttemptSettlementEnv,
  completion: AttemptCompletion,
): Promise<AttemptPublicationResult> {
  const repository = new D1RunRepository(env.DB);
  const input = await recordedCallback(env, completion);
  if (!input)
    return settlementResult(
      repository,
      completion.attemptId,
      "stale",
    ) as Promise<AttemptPublicationResult>;
  const attempt = await repository.getAttempt(input.attemptId);
  if (attempt?.state === "completed") {
    if (attempt.outcome) await enqueueAttemptWakeup(env, attempt);
    return settlementResult(
      repository,
      input.attemptId,
      "duplicate",
    ) as Promise<AttemptPublicationResult>;
  }
  try {
    await new SandboxCheckpointPublisher(
      env.ATTEMPT_SANDBOXES,
      artifactsNamespace(env),
      repository,
      env,
    ).publish(input);
  } catch (error) {
    if (!(error instanceof BranchChangedError)) throw error;
    return (await recordRejectedAttemptOutcome(
      env,
      input,
      "branch_superseded",
      error.status,
      error.detail,
    )) as AttemptPublicationResult;
  }
  console.log(
    JSON.stringify({
      message: "attempt_checkpoint_published",
      attemptId: input.attemptId,
      expectedRevision: input.expectedRevision,
      outputHead: input.checkpoint.outputHead,
    }),
  );
  await repository.recordAttemptEvent(input.attemptId, "attempt_settlement", {
    phase: "checkpoint_published",
    expectedRevision: input.expectedRevision,
    outputHead: input.checkpoint.outputHead,
  });
  return {
    outcome: "published",
    attemptId: input.attemptId,
    ...(attempt ? { sandboxName: sandboxName(attempt) } : {}),
  };
}

export async function acceptRecordedAttemptCompletion(
  env: AttemptSettlementEnv,
  completion: AttemptCompletion,
): Promise<AttemptSettlementResult> {
  const repository = new D1RunRepository(env.DB);
  const input = await recordedCallback(env, completion);
  if (!input)
    return settlementResult(repository, completion.attemptId, "stale");
  const existing = await repository.getAttempt(input.attemptId);
  const run = existing ? await repository.get(existing.runId) : undefined;
  const outcome = await repository.completeAttempt(
    input.attemptId,
    input.expectedRevision,
    input.checkpoint.outputHead,
    annotateProtectedPathProposal(
      input.result,
      input.checkpoint.changedPaths,
      run?.profile,
    ),
  );
  const attempt = await repository.getAttempt(input.attemptId);
  if (attempt && (outcome === "completed" || outcome === "duplicate"))
    await enqueueAttemptWakeup(env, attempt);
  console.log(
    JSON.stringify({
      message: "attempt_settlement_accepted",
      attemptId: input.attemptId,
      expectedRevision: input.expectedRevision,
      outputHead: input.checkpoint.outputHead,
      outcome,
    }),
  );
  await repository.recordAttemptEvent(input.attemptId, "attempt_settlement", {
    phase: "settlement_accepted",
    expectedRevision: input.expectedRevision,
    outputHead: input.checkpoint.outputHead,
    outcome,
  });
  return settlementResult(repository, input.attemptId, outcome);
}

// Promotes the judged winner's repository state to the run's canonical
// locations: the workspace backup becomes the run backup and the winner's
// already-validated checkpoint is published to the GitHub branch. Losing
// candidates keep their candidate-keyed backups and refs as evidence only.
export function competitionPromoter(
  env: AttemptSettlementEnv,
): CompetitionPromoter {
  return {
    async promote(
      run: RunSnapshot,
      winner: Attempt,
      judgement: CompetitionJudgement,
    ): Promise<void> {
      const repository = new D1RunRepository(env.DB);
      const startedAt = Date.now();
      const backup = await workspaceBackup(
        repository.database,
        attemptWorkspaceBackupKey(winner),
      );
      if (backup)
        await saveWorkspaceBackup(
          repository.database,
          run.id,
          winner.id,
          backup,
        );
      await new SandboxCheckpointPublisher(
        env.ATTEMPT_SANDBOXES,
        artifactsNamespace(env),
        repository,
        env,
      ).publish(
        {
          attemptId: winner.id,
          expectedRevision: run.revision,
          checkpoint: {
            repositoryId: "",
            repository: artifactRepositoryName(winner),
            baseCommit: winner.baseCommit,
            ref: attemptWorkspaceRef(winner),
            inputHead: winner.expectedHead,
            outputHead: winner.acceptedHead ?? winner.expectedHead,
            changedPaths: [],
          },
          artifactTokenId: "",
          result: winner.result ?? {},
          signature: "",
        },
        { promoteCompetitionWinner: true },
      );
      console.log(
        JSON.stringify({
          message: "competition_winner_state_promoted",
          runId: run.id,
          revision: run.revision,
          winnerAttemptId: winner.id,
          selected: judgement.selected,
          acceptedHead: winner.acceptedHead ?? winner.expectedHead,
          hadBackup: Boolean(backup),
          durationMs: Date.now() - startedAt,
        }),
      );
    },
  };
}

export async function settleAttempt(
  env: AttemptSettlementEnv,
  input: AttemptCallback,
): Promise<AttemptSettlementResult> {
  const { signature, ...completion } = input;
  const attemptSecret = await signCallback(
    env.CALLBACK_SIGNING_SECRET,
    input.attemptId,
  );
  if (
    !(await verifyCallback(
      attemptSecret,
      callbackPayload(completion),
      signature,
    ))
  )
    return { outcome: "unauthorized", attemptId: input.attemptId };
  return settleAttemptCompletion(env, completion);
}

export async function settleAttemptCompletion(
  env: AttemptSettlementEnv,
  completion: AttemptCompletion,
): Promise<AttemptSettlementResult> {
  const recorded = await recordAttemptCompletion(env, completion);
  if (recorded === "stale")
    return { outcome: "stale", attemptId: completion.attemptId };
  const validation = await validateRecordedAttemptCompletion(env, completion);
  if (validation.outcome !== "validated")
    return validation as AttemptSettlementResult;
  await backupRecordedAttemptWorkspace(env, completion);
  const publication = await publishRecordedAttemptCompletion(env, completion);
  if (publication.outcome !== "published")
    return publication as AttemptSettlementResult;
  return acceptRecordedAttemptCompletion(env, completion);
}

export async function callbackForCompletion(
  signingSecret: string,
  completion: AttemptCompletion,
): Promise<AttemptCallback> {
  const attemptSecret = await signCallback(signingSecret, completion.attemptId);
  return {
    ...completion,
    signature: await signCallback(attemptSecret, callbackPayload(completion)),
  };
}
