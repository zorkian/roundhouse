// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  immutableAttemptId,
  reviewerAttemptId,
  reviewers,
  type Attempt,
  type RunRepository,
  type RunSnapshot,
  type Wakeup,
} from "@roundhouse/core";
import { aggregatedReview } from "./aggregated-review.js";

export interface AttemptDispatcher {
  submit(attempt: Attempt, run: RunSnapshot): Promise<void>;
}

export interface AttemptReporter {
  report(run: RunSnapshot, attempt: Attempt): Promise<void>;
  reportStarted?(run: RunSnapshot, attempt: Attempt): Promise<void>;
}

export const attemptInactivityMilliseconds = 10 * 60_000;

function startNotificationApplies(attempt: Attempt): boolean {
  return (
    attempt.stage === "implement" ||
    (attempt.stage === "review" && attempt.role === "review-holistic")
  );
}

// A start notification describes work that is already durably dispatched, so
// delivering it must never change the coordination outcome: failures are
// logged, and the reporter's immutable comment markers make revisiting the
// notification safe.
async function reportStarted(
  reporter: AttemptReporter | undefined,
  run: RunSnapshot,
  attempt: Attempt,
): Promise<void> {
  if (!reporter?.reportStarted || !startNotificationApplies(attempt)) return;
  try {
    await reporter.reportStarted(run, attempt);
  } catch (error) {
    console.error("report_started_failed", error);
  }
}

// A duplicate wakeup for a durably dispatched attempt revisits the start
// notification without redispatching the work, so a comment that failed to
// post earlier still goes out while the attempt is running. An attempt that
// is only leased but not yet marked dispatched must stay silent: its
// submission can still fail.
async function revisitStarted(
  repository: RunRepository,
  reporter: AttemptReporter | undefined,
  run: RunSnapshot,
  attemptId: string,
): Promise<void> {
  if (!reporter?.reportStarted) return;
  const attempt = await repository.getAttempt(attemptId);
  if (attempt?.state === "dispatched")
    await reportStarted(reporter, run, attempt);
}

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

function selectedSpecialists(attempt: Attempt): readonly string[] | undefined {
  const review = attempt.result?.review as Record<string, unknown> | undefined;
  const selections = review?.selections;
  if (!Array.isArray(selections)) return undefined;
  const decisions = new Map<string, boolean>();
  for (const selection of selections) {
    if (!selection || typeof selection !== "object") return undefined;
    const value = selection as Record<string, unknown>;
    if (
      !["review-security", "review-data"].includes(String(value.role)) ||
      typeof value.applicable !== "boolean" ||
      typeof value.rationale !== "string" ||
      decisions.has(String(value.role))
    )
      return undefined;
    decisions.set(String(value.role), value.applicable);
  }
  if (!decisions.has("review-security") || !decisions.has("review-data"))
    return undefined;
  return [...decisions].flatMap(([role, applicable]) =>
    applicable ? [role] : [],
  );
}

function aggregateReviews(attempts: readonly Attempt[]): Attempt {
  const source = attempts[attempts.length - 1]!;
  return {
    ...source,
    result: {
      review: aggregatedReview(attempts),
    },
  };
}

export function aggregateReviewAttempts(
  attempts: readonly Attempt[],
): Attempt | undefined {
  const holistic = attempts.find(
    (attempt) =>
      attempt.role === "review-holistic" && attempt.state === "completed",
  );
  if (!holistic) return undefined;
  const selected = selectedSpecialists(holistic);
  if (!selected) return undefined;
  const specialists = selected.map((role) =>
    attempts.find(
      (attempt) => attempt.role === role && attempt.state === "completed",
    ),
  );
  if (specialists.some((attempt) => !attempt)) return undefined;
  const required = [holistic, ...(specialists as Attempt[])];
  const candidateHead = required[required.length - 1]!.expectedHead;
  if (
    !candidateHead ||
    required.some(
      (attempt) =>
        attempt.expectedHead !== candidateHead ||
        attempt.acceptedHead !== candidateHead,
    )
  )
    return undefined;
  return aggregateReviews(required);
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
  // Runs persisted before repository profiles were introduced must not be
  // dispatched under an unknown policy.
  if (!run.profile) {
    await repository.transition(run.id, run.revision, {
      status: "waiting",
      stage: run.stage,
      waitingReason: "profile_error",
    });
    return "stale";
  }
  if (run.stage === "review") {
    const current = await repository.attemptsForRevision(run.id, run.revision);
    const holisticRole = "review-holistic" as const;
    const holistic = current.find((attempt) => attempt.role === holisticRole);
    if (!holistic || holistic.state !== "completed") {
      return dispatchReview(
        repository,
        dispatcher,
        run,
        holisticRole,
        now,
        leaseMilliseconds,
        reporter,
      );
    }
    const allowed = new Set(
      reviewers.slice(1).map((reviewer) => reviewer.role),
    );
    const selection = selectedSpecialists(holistic);
    if (!selection) {
      const next = await repository.transition(run.id, run.revision, {
        status: "failed",
        stage: "review",
      });
      if (!next) return "stale";
      if (reporter) await reporter.report(next, holistic);
      return "dispatched";
    }
    const selected = selection.filter((role) =>
      allowed.has(role as "review-security" | "review-data"),
    ) as ("review-security" | "review-data")[];
    for (const role of selected) {
      const attempt = current.find((candidate) => candidate.role === role);
      if (!attempt || attempt.state !== "completed")
        return dispatchReview(
          repository,
          dispatcher,
          run,
          role,
          now,
          leaseMilliseconds,
          reporter,
        );
    }
    const aggregate = aggregateReviewAttempts(current);
    if (!aggregate) return "stale";
    const next = await repository.transition(
      run.id,
      run.revision,
      reviewTransition(aggregate),
    );
    if (!next) return "stale";
    if (reporter) await reporter.report(next, aggregate);
    return "dispatched";
  }
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
  if (!claimed) {
    await revisitStarted(repository, reporter, run, attemptId);
    return "duplicate";
  }
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
  await reportStarted(reporter, run, attempt);
  return "dispatched";
}

async function dispatchReview(
  repository: RunRepository,
  dispatcher: AttemptDispatcher,
  run: RunSnapshot,
  role: "review-holistic" | "review-security" | "review-data",
  now: number,
  leaseMilliseconds: number,
  reporter?: AttemptReporter,
): Promise<"dispatched" | "duplicate"> {
  const attemptId = reviewerAttemptId(run.id, run.revision, role);
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
  if (!claimed) {
    await revisitStarted(repository, reporter, run, attemptId);
    return "duplicate";
  }
  const attempt: Attempt = {
    id: attemptId,
    runId: run.id,
    runRevision: run.revision,
    kind: "agent",
    stage: "review",
    role,
    state: "created",
    deadlineAt: now + leaseMilliseconds,
    baseCommit: run.baseCommit,
    expectedHead: run.currentHead,
  };
  await repository.createAttempt(attempt);
  try {
    await dispatcher.submit(attempt, run);
  } catch (error) {
    await repository.releaseLease(run.id, run.revision, attempt.id);
    throw error;
  }
  await repository.markDispatched(attempt.id);
  await reportStarted(reporter, run, attempt);
  return "dispatched";
}
