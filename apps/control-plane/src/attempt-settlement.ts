// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  acceptCallback,
  callbackPayload,
  signCallback,
  type AttemptCallback,
  type AttemptCompletion,
} from "./callback.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";
import {
  artifactsNamespace,
  SandboxCheckpointValidator,
  sandboxName,
  type SandboxNamespace,
} from "./attempt-runtime.js";
import {
  githubClientForRun,
  postRunCommentOnce,
  type GitHubEnv,
} from "./github.js";

export type AttemptSettlementOutcome =
  "completed" | "duplicate" | "rejected" | "stale" | "unauthorized";

export interface AttemptSettlementResult {
  readonly outcome: AttemptSettlementOutcome;
  readonly attemptId: string;
  readonly sandboxName?: string;
}

export type AttemptSettlementEnv = Cloudflare.Env &
  GitHubEnv & {
    readonly DB: D1Like;
    readonly CALLBACK_SIGNING_SECRET: string;
    readonly ATTEMPT_SANDBOXES: SandboxNamespace;
  };

export async function settleAttempt(
  env: AttemptSettlementEnv,
  input: AttemptCallback,
): Promise<AttemptSettlementResult> {
  const repository = new D1RunRepository(env.DB);
  const outcome = await acceptCallback(
    repository,
    await signCallback(env.CALLBACK_SIGNING_SECRET, input.attemptId),
    new SandboxCheckpointValidator(
      env.ATTEMPT_SANDBOXES,
      artifactsNamespace(env),
      repository,
      env,
    ),
    input,
  );
  const settled = ["completed", "duplicate", "rejected"].includes(outcome);
  const attempt = settled
    ? await repository.getAttempt(input.attemptId)
    : undefined;
  if (attempt && (outcome === "completed" || outcome === "duplicate"))
    await env.RUN_WAKEUPS.send({
      runId: attempt.runId,
      expectedRevision: attempt.runRevision,
    });
  if (attempt && outcome === "rejected") {
    const run = await repository.get(attempt.runId);
    const failure = attempt.result?.failure;
    await repository.recordAttemptEvent(attempt.id, "checkpoint_rejected", {
      phase: "checkpoint_rejection_settled",
      runId: attempt.runId,
      runRevision: run?.revision ?? null,
      attemptRevision: attempt.runRevision,
      stage: attempt.stage,
      nodeId: attempt.nodeId,
      failure: failure ?? null,
    });
    console.error(
      JSON.stringify({
        message: "checkpoint_rejection_settlement_completed",
        runId: attempt.runId,
        attemptId: attempt.id,
        runRevision: run?.revision ?? null,
        attemptRevision: attempt.runRevision,
        stage: attempt.stage,
        nodeId: attempt.nodeId,
        failure: failure ?? null,
      }),
    );
    if (run)
      await postRunCommentOnce(
        githubClientForRun(env, run),
        run,
        `checkpoint-rejected-${attempt.id}`,
        `## Roundhouse needs attention\n\nRoundhouse could not validate the work checkpoint, so this run is paused instead of repeating the work. After the validation problem is fixed, a maintainer can restart it with \`${env.GITHUB_START_COMMAND}\`.`,
        env.PUBLIC_ORIGIN,
      );
  }
  return {
    outcome,
    attemptId: input.attemptId,
    ...(attempt ? { sandboxName: sandboxName(attempt) } : {}),
  };
}

export async function settleAttemptCompletion(
  env: AttemptSettlementEnv,
  completion: AttemptCompletion,
): Promise<AttemptSettlementResult> {
  return settleAttempt(
    env,
    await callbackForCompletion(env.CALLBACK_SIGNING_SECRET, completion),
  );
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
