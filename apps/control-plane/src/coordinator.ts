// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  advanceWorkflow,
  immutableAttemptId,
  reviewerAttemptId,
  type AppliedProfile,
  type Attempt,
  type RunRepository,
  type RunSnapshot,
  type RunStage,
  type RunTransition,
  type WorkflowNode,
  type WorkflowReview,
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

function startNotificationApplies(run: RunSnapshot, attempt: Attempt): boolean {
  const review =
    attempt.nodeId && run.profile?.workflow
      ? run.profile.workflow.nodes[attempt.nodeId]?.review
      : undefined;
  const primaryReviewer = review?.reviewers.find(
    (reviewer) => reviewer.activation === "always",
  )?.id;
  return (
    attempt.stage === "implement" ||
    (attempt.stage === "review" &&
      attempt.role === (primaryReviewer ?? "review-holistic"))
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
  if (!reporter?.reportStarted || !startNotificationApplies(run, attempt))
    return;
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
  const screenshots = (outcome as Record<string, unknown>).screenshots;
  if (
    attempt.acceptedHead === attempt.expectedHead &&
    Array.isArray(screenshots) &&
    screenshots.length > 0
  )
    return {
      status: "succeeded",
      stage: "implement",
      acceptedHead: attempt.acceptedHead,
    } as const;
  return {
    status: "active",
    stage: "review",
    acceptedHead: attempt.acceptedHead,
    heads: { candidateHead: attempt.acceptedHead },
  } as const;
}

export function reviewTransition(attempt: Attempt) {
  const outcome = attempt.result?.review;
  if (!outcome || typeof outcome !== "object")
    return { status: "failed", stage: "review" } as const;
  const status = (outcome as Record<string, unknown>).status;
  if (status === "clean")
    return {
      status: "active",
      stage: "integrate",
      heads: { reviewedHead: attempt.expectedHead },
    } as const;
  if (status === "changes_requested")
    return { status: "active", stage: "implement" } as const;
  return { status: "failed", stage: "review" } as const;
}

export function integrateTransition(attempt: Attempt) {
  // The integration-delta review is the only gate between a conflict
  // resolution and CI; the original candidate review remains valid evidence.
  if (attempt.role === "review-integration") {
    const review = attempt.result?.review as
      Record<string, unknown> | undefined;
    if (review?.status === "clean")
      return {
        status: "active",
        stage: "ci",
        acceptedHead: attempt.expectedHead,
        heads: { integrationHead: attempt.expectedHead },
      } as const;
    if (review?.status === "changes_requested")
      return {
        status: "active",
        stage: "integrate",
        heads: { integrationHead: null },
      } as const;
    return { status: "failed", stage: "integrate" } as const;
  }
  const outcome = attempt.result?.integration as
    Record<string, unknown> | undefined;
  const baseHead = outcome?.baseHead;
  if (
    !outcome ||
    typeof baseHead !== "string" ||
    !/^[a-f0-9]{40}$/.test(baseHead)
  )
    return { status: "failed", stage: "integrate" } as const;
  if (outcome.status === "conflict" && attempt.role === "integrate")
    return {
      status: "active",
      stage: "integrate",
      // Select the conflicting base and clear any integration head validated
      // against an older base so the identities never mismatch.
      heads: { targetBaseHead: baseHead, integrationHead: null },
    } as const;
  if (
    outcome.status === "clean" &&
    outcome.head === attempt.acceptedHead &&
    outcome.candidateHead === attempt.expectedHead &&
    attempt.acceptedHead &&
    attempt.acceptedHead !== attempt.expectedHead
  ) {
    // A conflict resolution must integrate the base selected by the
    // preceding conflict, which is carried immutably on the attempt.
    if (attempt.role === "conflict-resolution") {
      if (baseHead !== attempt.baseCommit)
        return { status: "failed", stage: "integrate" } as const;
      return {
        status: "active",
        stage: "integrate",
        acceptedHead: attempt.acceptedHead,
        heads: {
          targetBaseHead: baseHead,
          integrationHead: attempt.acceptedHead,
        },
      } as const;
    }
    return {
      status: "active",
      stage: "ci",
      acceptedHead: attempt.acceptedHead,
      heads: {
        targetBaseHead: baseHead,
        integrationHead: attempt.acceptedHead,
      },
    } as const;
  }
  return { status: "failed", stage: "integrate" } as const;
}

export function ciTransition(attempt: Attempt, profile?: AppliedProfile) {
  const outcome = attempt.result?.ci as Record<string, unknown> | undefined;
  if (
    outcome?.head !== attempt.expectedHead ||
    !attempt.acceptedHead ||
    attempt.acceptedHead !== attempt.expectedHead
  )
    return { status: "failed", stage: "ci" } as const;
  if (outcome.status === "failure") {
    // A CI failure may only return to implementation with concrete,
    // newly retrieved failure evidence; missing diagnostics or evidence
    // already consumed by an earlier repair leaves the run waiting.
    if (
      outcome.reason === "diagnostics_unavailable" ||
      outcome.reason === "evidence_consumed"
    )
      return {
        status: "waiting",
        stage: "ci",
        waitingReason: "external_check",
      } as const;
    return { status: "active", stage: "implement" } as const;
  }
  if (outcome.status !== "success")
    return { status: "failed", stage: "ci" } as const;
  if (profile?.merge?.mode === "maintainer")
    return {
      status: "waiting",
      stage: "merge",
      waitingReason: "maintainer_merge",
      acceptedHead: attempt.acceptedHead,
    } as const;
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

function stageForWorkflowNode(nodeId: string, node: WorkflowNode): RunStage {
  if (node.agent?.task === "qualification") return "qualify";
  if (node.agent?.task === "investigation") return "reproduce";
  if (node.agent?.task === "planning") return "plan";
  if (node.agent?.task === "implementation") return "implement";
  if (node.executor === "review") return "review";
  if (node.executor === "github.publish") return "publish";
  if (node.executor === "github.checks") return "ci";
  if (node.executor === "github.merge") return "merge";
  if (node.role === "integrate") return "integrate";
  throw new Error(`workflow_node_has_no_execution_stage:${nodeId}`);
}

function integrationWorkflowOutput(attempt: Attempt): string | undefined {
  const transition = integrateTransition(attempt);
  if (transition.status === "failed") return undefined;
  if (transition.stage === "ci") return "ready";
  return "needs_resolution";
}

function evidenceForAttempt(
  attempt: Attempt,
  profile?: AppliedProfile,
): Pick<RunTransition, "acceptedHead" | "heads"> {
  if (attempt.stage === "implement") return implementationTransition(attempt);
  if (attempt.stage === "review") return reviewTransition(attempt);
  if (attempt.stage === "integrate") return integrateTransition(attempt);
  if (attempt.stage === "ci") {
    const ci = attempt.result?.ci as Record<string, unknown> | undefined;
    if (ci?.status === "reintegrate")
      return {
        acceptedHead: attempt.acceptedHead,
        heads: { integrationHead: null, targetBaseHead: null },
      };
    return ciTransition(attempt, profile);
  }
  if (attempt.stage === "merge") {
    const merge = attempt.result?.merge as Record<string, unknown> | undefined;
    if (merge?.status === "reintegrate")
      return {
        acceptedHead: attempt.acceptedHead,
        heads: { integrationHead: null, targetBaseHead: null },
      };
    return mergeTransition(attempt);
  }
  return {};
}

function workflowAdvanceForAttempt(run: RunSnapshot, attempt: Attempt) {
  const workflow = run.profile?.workflow;
  const nodeId = run.currentNodeId;
  if (!workflow || !nodeId || run.workflowHash !== workflow.hash)
    throw new Error("run_workflow_snapshot_missing");
  const node = workflow.nodes[nodeId];
  if (!node) throw new Error("run_workflow_node_missing");
  const integrationStatus =
    node.executor === "validate" && node.role === "integrate"
      ? integrationWorkflowOutput(attempt)
      : undefined;
  const output = integrationStatus
    ? {
        ...attempt.result,
        integration: {
          ...(attempt.result?.integration as
            Record<string, unknown> | undefined),
          status: integrationStatus,
        },
      }
    : attempt.result;
  const implementation = attempt.result?.implementation as
    Record<string, unknown> | undefined;
  const advance = advanceWorkflow(workflow, nodeId, {
    output: output ?? {},
    attempt: {
      expectedHead: attempt.expectedHead,
      acceptedHead: attempt.acceptedHead,
      changed:
        Boolean(attempt.acceptedHead) &&
        attempt.acceptedHead !== attempt.expectedHead,
      hasScreenshots:
        Array.isArray(implementation?.screenshots) &&
        implementation.screenshots.length > 0,
    },
    run: {
      revision: run.revision,
      mergeMode: run.profile?.merge?.mode ?? "automatic",
    },
  });
  return { workflow, nodeId, node, advance };
}

export function graphCompletedTransition(run: RunSnapshot, attempt: Attempt) {
  const { workflow, nodeId, node, advance } = workflowAdvanceForAttempt(
    run,
    attempt,
  );
  const destination = workflow.nodes[advance.currentNodeId]!;
  const stage = stageForWorkflowNode(advance.currentNodeId, destination);
  const evidence = evidenceForAttempt(attempt, run.profile);
  console.log(
    JSON.stringify({
      message: "workflow_transition_selected",
      runId: run.id,
      revision: run.revision,
      attemptId: attempt.id,
      workflowHash: workflow.hash,
      fromNodeId: nodeId,
      toNodeId: advance.currentNodeId,
      status: advance.status,
      waitingReason: advance.waitingReason ?? null,
      condition: advance.selected.when ?? null,
      executor: node.executor,
    }),
  );
  return {
    status: advance.status,
    stage,
    currentNodeId: advance.currentNodeId,
    ...(advance.waitingReason ? { waitingReason: advance.waitingReason } : {}),
    ...evidence,
  };
}

async function recordWorkflowTransition(
  repository: RunRepository,
  run: RunSnapshot,
  attempt: Attempt,
  next: RunSnapshot,
): Promise<void> {
  if (!run.profile?.workflow || !run.currentNodeId) return;
  const { workflow, nodeId, node, advance } = workflowAdvanceForAttempt(
    run,
    attempt,
  );
  await repository.recordEvent?.(run.id, attempt.id, "workflow_transition", {
    workflowHash: workflow.hash,
    fromNodeId: nodeId,
    toNodeId: advance.currentNodeId,
    executor: node.executor,
    capabilities: node.capabilities,
    condition: advance.selected.when ?? null,
    status: next.status,
    waitingReason: next.waitingReason ?? null,
    inputHead: attempt.expectedHead,
    outputHead: attempt.acceptedHead ?? attempt.expectedHead,
    runRevision: next.revision,
  });
}

function selectedReviewers(
  attempt: Attempt,
  expected: readonly string[],
): readonly string[] | undefined {
  const review = attempt.result?.review as Record<string, unknown> | undefined;
  const selections = review?.selections;
  if (!Array.isArray(selections)) return undefined;
  const decisions = new Map<string, boolean>();
  for (const selection of selections) {
    if (!selection || typeof selection !== "object") return undefined;
    const value = selection as Record<string, unknown>;
    if (
      !expected.includes(String(value.role)) ||
      typeof value.applicable !== "boolean" ||
      typeof value.rationale !== "string" ||
      decisions.has(String(value.role))
    )
      return undefined;
    decisions.set(String(value.role), value.applicable);
  }
  if (expected.some((role) => !decisions.has(role))) return undefined;
  return [...decisions].flatMap(([role, applicable]) =>
    applicable ? [role] : [],
  );
}

function aggregateReviews(
  attempts: readonly Attempt[],
  profile?: AppliedProfile,
  configured?: WorkflowReview,
): Attempt {
  const source = attempts[attempts.length - 1]!;
  return {
    ...source,
    result: {
      review: aggregatedReview(attempts, profile, configured),
    },
  };
}

export function aggregateReviewAttempts(
  attempts: readonly Attempt[],
  profile?: AppliedProfile,
  configured?: WorkflowReview,
): Attempt | undefined {
  const legacy = !configured;
  const definitions = configured?.reviewers ?? [
    {
      id: "review-holistic",
      activation: "always",
      selects: ["review-security", "review-data"],
    },
    {
      id: "review-security",
      activation: "selected",
      selectedBy: "review-holistic",
      selects: [],
    },
    {
      id: "review-data",
      activation: "selected",
      selectedBy: "review-holistic",
      selects: [],
    },
  ];
  const always = definitions.filter(
    (reviewer) => reviewer.activation === "always",
  );
  const completed = new Map(
    attempts
      .filter((attempt) => attempt.state === "completed")
      .map((attempt) => [attempt.role, attempt]),
  );
  if (always.some((reviewer) => !completed.has(reviewer.id))) return undefined;
  const selected = new Set(always.map((reviewer) => reviewer.id));
  for (const selector of definitions.filter(
    (reviewer) => reviewer.selects.length,
  )) {
    const attempt = completed.get(selector.id);
    if (!attempt) return undefined;
    const decisions = selectedReviewers(attempt, selector.selects);
    if (!decisions) return undefined;
    for (const role of decisions) {
      if (legacy) {
        const name = role.replace("review-", "") as "security" | "data";
        if (profile?.reviewers?.[name]?.enabled === false) continue;
      }
      selected.add(role);
    }
  }
  const required = definitions
    .filter((reviewer) => selected.has(reviewer.id))
    .map((reviewer) => completed.get(reviewer.id));
  if (required.some((attempt) => !attempt)) return undefined;
  const exact = required as Attempt[];
  const candidateHead = exact[exact.length - 1]!.expectedHead;
  if (
    !candidateHead ||
    exact.some(
      (attempt) =>
        attempt.expectedHead !== candidateHead ||
        attempt.acceptedHead !== candidateHead,
    )
  )
    return undefined;
  return aggregateReviews(exact, profile, configured);
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
  const workflow = run.profile.workflow;
  const currentWorkflowNode =
    workflow && run.currentNodeId
      ? workflow.nodes[run.currentNodeId]
      : undefined;
  if (!workflow || !currentWorkflowNode || run.workflowHash !== workflow.hash) {
    console.error(
      JSON.stringify({
        message: "run_workflow_snapshot_invalid",
        runId: run.id,
        revision: run.revision,
        profileHash: run.profile.hash,
        workflowHash: run.workflowHash ?? null,
        profileWorkflowHash: workflow?.hash ?? null,
        currentNodeId: run.currentNodeId ?? null,
      }),
    );
    const next = await repository.transition(run.id, run.revision, {
      status: "waiting",
      stage: run.stage,
      waitingReason: "profile_error",
    });
    return next ? "dispatched" : "stale";
  }
  if (
    currentWorkflowNode &&
    stageForWorkflowNode(run.currentNodeId!, currentWorkflowNode) !== run.stage
  )
    throw new Error("run_workflow_stage_mismatch");
  if (currentWorkflowNode.executor === "review") {
    const review = currentWorkflowNode.review!;
    const current = await repository.attemptsForRevision(run.id, run.revision);
    const required = new Set(
      review.reviewers
        .filter((reviewer) => reviewer.activation === "always")
        .map((reviewer) => reviewer.id),
    );
    for (const selector of review.reviewers.filter(
      (reviewer) => reviewer.selects.length,
    )) {
      const attempt = current.find(
        (candidate) =>
          candidate.role === selector.id && candidate.state === "completed",
      );
      if (!attempt) continue;
      const selection = selectedReviewers(attempt, selector.selects);
      if (!selection) {
        const next = await repository.transition(run.id, run.revision, {
          status: "failed",
          stage: "review",
        });
        if (!next) return "stale";
        if (reporter) await reporter.report(next, attempt);
        return "dispatched";
      }
      selection.forEach((role) => required.add(role));
    }
    console.log(
      JSON.stringify({
        message: "workflow_review_fanout_resolved",
        runId: run.id,
        revision: run.revision,
        workflowHash: run.workflowHash,
        nodeId: run.currentNodeId,
        requiredReviewers: [...required],
        candidateHead: run.currentHead,
      }),
    );
    await repository.recordEvent?.(
      run.id,
      undefined,
      "workflow_review_fanout",
      {
        workflowHash: run.workflowHash,
        nodeId: run.currentNodeId,
        requiredReviewers: [...required],
        candidateHead: run.currentHead,
      },
    );
    for (const definition of review.reviewers.filter((reviewer) =>
      required.has(reviewer.id),
    )) {
      const role = definition.id;
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
    const aggregate = aggregateReviewAttempts(current, run.profile, review);
    if (!aggregate) return "stale";
    await repository.recordEvent?.(
      run.id,
      aggregate.id,
      "workflow_review_join",
      {
        workflowHash: run.workflowHash,
        nodeId: run.currentNodeId,
        candidateHead: run.currentHead,
        reviewers: [...required],
        status: (aggregate.result?.review as Record<string, unknown>)?.status,
      },
    );
    const next = await repository.transition(
      run.id,
      run.revision,
      graphCompletedTransition(run, aggregate),
    );
    if (!next) return "stale";
    await recordWorkflowTransition(repository, run, aggregate, next);
    if (reporter) await reporter.report(next, aggregate);
    return "dispatched";
  }
  const attemptId = immutableAttemptId(run.id, run.revision);
  const previous = await repository.getAttempt(attemptId);
  if (previous?.state === "completed") {
    const transition = graphCompletedTransition(run, previous);
    const next = await repository.transition(run.id, run.revision, transition);
    if (!next) return "stale";
    await recordWorkflowTransition(repository, run, previous, next);
    if (reporter) await reporter.report(next, previous);
    return "dispatched";
  }
  if (
    !new Set(["agent.read", "agent.write", "validate"]).has(
      currentWorkflowNode.executor,
    )
  )
    return "stale";
  // A conflicted mechanical integration is followed by exactly one narrowly
  // scoped conflict-resolution attempt for the same reviewed candidate; any
  // other integrate wakeup retries the no-model mechanical merge.
  const integrateRole = async (): Promise<string> => {
    if (currentWorkflowNode.role !== "integrate")
      return currentWorkflowNode.role ?? run.stage;
    const previous = await repository.latestCompletedAttempt(
      run.id,
      "integrate",
      run.revision,
    );
    const integration = previous?.result?.integration as
      Record<string, unknown> | undefined;
    if (integration?.status === "conflict") return "conflict-resolution";
    // A conflict resolution is reviewed as an integration delta before CI.
    if (
      previous?.role === "conflict-resolution" &&
      integration?.status === "clean"
    )
      return "review-integration";
    const deltaReview = previous?.result?.review as
      Record<string, unknown> | undefined;
    if (
      previous?.role === "review-integration" &&
      deltaReview?.status === "changes_requested"
    )
      return "conflict-resolution";
    return "integrate";
  };
  const role = await integrateRole();
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
    nodeId: run.currentNodeId,
    executor: currentWorkflowNode.executor,
    stage: run.stage,
    role,
    state: "created",
    deadlineAt: now + leaseMilliseconds,
    baseCommit:
      run.stage === "integrate" && role !== "integrate"
        ? (run.targetBaseHead ?? run.baseCommit)
        : run.baseCommit,
    expectedHead:
      run.stage === "integrate"
        ? role === "review-integration"
          ? (run.integrationHead ?? run.currentHead)
          : (run.reviewedHead ?? run.currentHead)
        : run.currentHead,
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
  role: string,
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
    ...(run.currentNodeId && run.profile?.workflow
      ? { nodeId: run.currentNodeId, executor: "review" as const }
      : {}),
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
