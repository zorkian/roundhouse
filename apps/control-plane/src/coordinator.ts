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

function selectedSpecialists(attempt: Attempt): readonly string[] {
  const review = attempt.result?.review as Record<string, unknown> | undefined;
  const selections = review?.selections;
  if (!Array.isArray(selections)) return [];
  return selections.flatMap((selection) => {
    if (typeof selection === "string") return [selection];
    if (!selection || typeof selection !== "object") return [];
    const value = selection as Record<string, unknown>;
    return value.applicable === false || typeof value.role !== "string"
      ? []
      : [value.role];
  });
}

function aggregateReviews(attempts: readonly Attempt[]): Attempt {
  const findings = attempts.flatMap((attempt) => {
    const review = attempt.result?.review as
      Record<string, unknown> | undefined;
    return Array.isArray(review?.findings)
      ? review.findings.map((finding) => ({ reviewer: attempt.role, finding }))
      : [];
  });
  const changesRequested = attempts.some(
    (attempt) =>
      (attempt.result?.review as Record<string, unknown> | undefined)
        ?.status === "changes_requested",
  );
  const source = attempts[attempts.length - 1]!;
  return {
    ...source,
    result: {
      review: {
        status: changesRequested ? "changes_requested" : "clean",
        findings,
        reviewers: attempts.map((attempt) => ({
          role: attempt.role,
          routing: attempt.routing,
        })),
      },
    },
  };
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
      );
    }
    const allowed = new Set(
      reviewers.slice(1).map((reviewer) => reviewer.role),
    );
    const selected = selectedSpecialists(holistic).filter((role) =>
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
        );
    }
    const aggregate = aggregateReviews([
      holistic,
      ...selected.map((role) =>
        current.find((attempt) => attempt.role === role)!,
      ),
    ]);
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

async function dispatchReview(
  repository: RunRepository,
  dispatcher: AttemptDispatcher,
  run: RunSnapshot,
  role: "review-holistic" | "review-security" | "review-data",
  now: number,
  leaseMilliseconds: number,
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
  if (!claimed) return "duplicate";
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
    routing: {
      provider: reviewers.find((reviewer) => reviewer.role === role)!.provider,
      configuredModel: reviewers.find((reviewer) => reviewer.role === role)!
        .model,
      rule: `${role}-v1`,
    },
  };
  await repository.createAttempt(attempt);
  try {
    await dispatcher.submit(attempt, run);
  } catch (error) {
    await repository.releaseLease(run.id, run.revision, attempt.id);
    throw error;
  }
  await repository.markDispatched(attempt.id);
  return "dispatched";
}
