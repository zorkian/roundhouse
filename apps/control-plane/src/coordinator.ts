// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  immutableAttemptId,
  type Attempt,
  type RunRepository,
  type RunSnapshot,
  type Wakeup,
} from "@roundhouse/core";

export interface AttemptDispatcher {
  submit(attempt: Attempt, run: RunSnapshot): Promise<void>;
}

export interface AttemptReporter {
  report(run: RunSnapshot, attempt: Attempt): Promise<void>;
}

export const attemptInactivityMilliseconds = 10 * 60_000;

export function qualificationTransition(attempt: Attempt) {
  const outcome = attempt.result?.qualification;
  if (!outcome || typeof outcome !== "object")
    return { status: "failed", stage: "qualify" } as const;
  const classification = (outcome as Record<string, unknown>).classification;
  if (["bug", "feature", "maintenance"].includes(String(classification)))
    return { status: "active", stage: "reproduce" } as const;
  if (classification === "unclear")
    return {
      status: "waiting",
      stage: "qualify",
      waitingReason: "clarification",
    } as const;
  return { status: "succeeded", stage: "qualify" } as const;
}

export function reproductionTransition(attempt: Attempt) {
  const outcome = attempt.result?.reproduction;
  if (!outcome || typeof outcome !== "object")
    return { status: "failed", stage: "reproduce" } as const;
  const status = (outcome as Record<string, unknown>).status;
  if (status === "confirmed")
    return { status: "active", stage: "plan" } as const;
  if (status === "not_reproduced")
    return {
      status: "waiting",
      stage: "reproduce",
      waitingReason: "clarification",
    } as const;
  if (status === "blocked")
    return {
      status: "waiting",
      stage: "reproduce",
      waitingReason: "clarification",
    } as const;
  return { status: "failed", stage: "reproduce" } as const;
}

export function planTransition(attempt: Attempt) {
  const outcome = attempt.result?.plan;
  if (!outcome || typeof outcome !== "object")
    return { status: "failed", stage: "plan" } as const;
  const status = (outcome as Record<string, unknown>).status;
  if (status === "ready")
    return { status: "active", stage: "implement" } as const;
  if (status === "needs_clarification")
    return {
      status: "waiting",
      stage: "plan",
      waitingReason: "clarification",
    } as const;
  return { status: "failed", stage: "plan" } as const;
}

export function implementationTransition(attempt: Attempt) {
  const outcome = attempt.result?.implementation;
  if (!outcome || typeof outcome !== "object" || !attempt.acceptedHead)
    return { status: "failed", stage: "implement" } as const;
  return {
    status: "active",
    stage: "review",
    acceptedHead: attempt.acceptedHead,
  } as const;
}

export function reviewTransition(attempt: Attempt) {
  const outcome = attempt.result?.review;
  if (!outcome || typeof outcome !== "object")
    return { status: "failed", stage: "review" } as const;
  const status = (outcome as Record<string, unknown>).status;
  if (status === "clean") return { status: "active", stage: "ci" } as const;
  if (status === "changes_requested")
    return { status: "active", stage: "implement" } as const;
  return { status: "failed", stage: "review" } as const;
}

export function ciTransition(attempt: Attempt) {
  const outcome = attempt.result?.ci as Record<string, unknown> | undefined;
  if (
    outcome?.head !== attempt.expectedHead ||
    !attempt.acceptedHead ||
    attempt.acceptedHead !== attempt.expectedHead
  )
    return { status: "failed", stage: "ci" } as const;
  if (outcome.status === "failure")
    return { status: "active", stage: "implement" } as const;
  if (outcome.status !== "success")
    return { status: "failed", stage: "ci" } as const;
  return {
    status: "active",
    stage: "merge",
    acceptedHead: attempt.acceptedHead,
  } as const;
}

export function mergeTransition(attempt: Attempt) {
  const outcome = attempt.result?.merge as Record<string, unknown> | undefined;
  if (
    outcome?.status !== "merged" ||
    outcome.head !== attempt.expectedHead ||
    outcome.mergeCommit !== attempt.acceptedHead ||
    !attempt.acceptedHead
  )
    return { status: "failed", stage: "merge" } as const;
  return {
    status: "succeeded",
    stage: "merge",
    acceptedHead: attempt.acceptedHead,
  } as const;
}

function completedTransition(attempt: Attempt) {
  if (attempt.stage === "qualify") return qualificationTransition(attempt);
  if (attempt.stage === "reproduce") return reproductionTransition(attempt);
  if (attempt.stage === "plan") return planTransition(attempt);
  if (attempt.stage === "implement") return implementationTransition(attempt);
  if (attempt.stage === "review") return reviewTransition(attempt);
  if (attempt.stage === "ci") return ciTransition(attempt);
  if (attempt.stage === "merge") return mergeTransition(attempt);
  return undefined;
}

export async function coordinate(
  repository: RunRepository,
  dispatcher: AttemptDispatcher,
  wakeup: Wakeup,
  now: number,
  leaseMilliseconds = attemptInactivityMilliseconds,
  reporter?: AttemptReporter,
): Promise<"dispatched" | "duplicate" | "stale"> {
  const run = await repository.get(wakeup.runId);
  if (
    !run ||
    run.revision !== wakeup.expectedRevision ||
    run.status !== "active"
  )
    return "stale";
  const attemptId = immutableAttemptId(run.id, run.revision);
  const previous = await repository.getAttempt(attemptId);
  if (previous?.state === "completed") {
    const transition = completedTransition(previous);
    if (!transition) return "stale";
    const next = await repository.transition(run.id, run.revision, transition);
    if (!next) return "stale";
    if (reporter) await reporter.report(next, previous);
    return "dispatched";
  }
  if (
    !new Set(["qualify", "reproduce", "plan", "implement", "review"]).has(
      run.stage,
    )
  )
    return "stale";
  const claimed = await repository.claimLease(
    run.id,
    run.revision,
    {
      attemptId,
      runRevision: run.revision,
      expiresAt: now + leaseMilliseconds,
    },
    now,
  );
  if (!claimed) return "duplicate";
  const attempt: Attempt = {
    id: attemptId,
    runId: run.id,
    runRevision: run.revision,
    kind: "agent",
    stage: run.stage,
    role: run.stage,
    state: "created",
    deadlineAt: now + leaseMilliseconds,
    baseCommit: run.baseCommit,
    expectedHead: run.currentHead,
  };
  const created = await repository.createAttempt(attempt);
  const durable = await repository.getAttempt(attemptId);
  if (created === "exists" && durable?.state === "completed")
    return "duplicate";
  try {
    await dispatcher.submit(attempt, run);
  } catch (error) {
    await repository.releaseLease(run.id, run.revision, attempt.id);
    throw error;
  }
  await repository.markDispatched(attemptId);
  return "dispatched";
}
