// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  advanceWorkflow,
  competitionAttemptId,
  competitionCandidateRole,
  competitionJudgeRole,
  immutableAttemptId,
  reviewerAttemptId,
  validateCompetitionJudgement,
  type AppliedProfile,
  type Attempt,
  type AttemptCompetition,
  type CompetitionJudgement,
  type RunRepository,
  type RunSnapshot,
  type RunStage,
  type RunTransition,
  type WorkflowCapability,
  type WorkflowCompetition,
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

// Publishes the judged winner's repository state (workspace backup and Git
// refs) to the run's canonical locations. Wired from the environment in
// production; tests promote durably without external side effects.
export interface CompetitionPromoter {
  promote(
    run: RunSnapshot,
    winner: Attempt,
    judgement: CompetitionJudgement,
  ): Promise<void>;
}

export const attemptInactivityMilliseconds = 10 * 60_000;

export function effectiveAttemptCapabilities(
  node: WorkflowNode,
  role: string,
): readonly WorkflowCapability[] {
  const capabilities = new Set(node.capabilities);
  // Integration is currently a built-in composite executor. Its
  // integration-delta review is a strictly read-only sub-operation of the
  // repository-configured node, so it receives an attenuated capability set.
  if (node.executor === "validate" && role === "review-integration") {
    capabilities.delete("artifact.write");
    capabilities.delete("commands.execute");
  }
  return [...capabilities].sort();
}

function implementationNode(run: RunSnapshot): [string, WorkflowNode] {
  const entry = Object.entries(run.profile?.workflow?.nodes ?? {}).find(
    ([, node]) => node.agent?.task === "implementation",
  );
  if (!entry) throw new Error("workflow_implementation_node_missing");
  return entry;
}

export function attemptOutcomeTransition(
  run: RunSnapshot,
  attempt: Attempt,
): RunTransition {
  if (!attempt.outcome) throw new Error("attempt_outcome_missing");
  if (attempt.outcome.kind === "branch_superseded") {
    const [nodeId, node] = implementationNode(run);
    return {
      status: "active",
      stage: stageForWorkflowNode(nodeId, node),
      currentNodeId: nodeId,
      acceptedHead: attempt.outcome.observedHead,
      heads: {
        candidateHead: attempt.outcome.observedHead,
        reviewedHead: null,
        targetBaseHead: null,
        integrationHead: null,
      },
    };
  }
  return {
    status: "active",
    stage: run.stage,
    currentNodeId: run.currentNodeId,
  };
}

async function recordAttemptOutcomeTransition(
  repository: RunRepository,
  run: RunSnapshot,
  attempt: Attempt,
  next: RunSnapshot,
): Promise<void> {
  const payload = {
    outcome: attempt.outcome,
    fromNodeId: run.currentNodeId,
    toNodeId: next.currentNodeId,
    fromRevision: run.revision,
    toRevision: next.revision,
    inputHead: run.currentHead,
    outputHead: next.currentHead,
  };
  console.log(
    JSON.stringify({
      message: "attempt_outcome_reconciled",
      runId: run.id,
      attemptId: attempt.id,
      ...payload,
    }),
  );
  await repository.recordEvent?.(
    run.id,
    attempt.id,
    "attempt_outcome_reconciled",
    payload,
  );
}

async function recordIssuedCapabilities(
  repository: RunRepository,
  attempt: Attempt,
): Promise<void> {
  const payload = {
    nodeId: attempt.nodeId ?? null,
    executor: attempt.executor ?? null,
    role: attempt.role,
    capabilities: attempt.capabilities ?? [],
  };
  console.log(
    JSON.stringify({
      message: "attempt_capabilities_issued",
      runId: attempt.runId,
      attemptId: attempt.id,
      ...payload,
    }),
  );
  await repository.recordEvent?.(
    attempt.runId,
    attempt.id,
    "attempt_capabilities_issued",
    payload,
  );
}

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

// A queue delivery can be interrupted after the attempt and lease are durable
// but before its Workflow handoff is confirmed. The deterministic Workflow
// instance makes resubmitting that created attempt idempotent, so a duplicate
// wakeup completes the handoff instead of waiting for the execution lease to
// expire.
async function resumeCreatedDispatch(
  repository: RunRepository,
  dispatcher: AttemptDispatcher,
  reporter: AttemptReporter | undefined,
  run: RunSnapshot,
  attemptId: string,
): Promise<boolean> {
  const attempt = await repository.getAttempt(attemptId);
  if (
    attempt?.state !== "created" ||
    attempt.runId !== run.id ||
    attempt.runRevision !== run.revision
  )
    return false;
  const startedAt = Date.now();
  const started = {
    phase: "created_attempt_dispatch_resume_started",
    revision: run.revision,
  };
  console.log(
    JSON.stringify({
      message: "created_attempt_dispatch_resume_started",
      runId: run.id,
      attemptId,
      ...started,
    }),
  );
  await repository.recordEvent?.(
    run.id,
    attempt.id,
    "attempt_dispatch_resume",
    started,
  );
  try {
    await dispatcher.submit(attempt, run);
    await repository.markDispatched(attempt.id);
    await reportStarted(reporter, run, attempt);
    const completed = {
      phase: "created_attempt_dispatch_resume_completed",
      revision: run.revision,
      durationMs: Date.now() - startedAt,
    };
    console.log(
      JSON.stringify({
        message: "created_attempt_dispatch_resume_completed",
        runId: run.id,
        attemptId,
        ...completed,
      }),
    );
    await repository.recordEvent?.(
      run.id,
      attempt.id,
      "attempt_dispatch_resume",
      completed,
    );
    return true;
  } catch (error) {
    await repository.releaseLease(run.id, run.revision, attempt.id);
    const failed = {
      phase: "created_attempt_dispatch_resume_failed",
      revision: run.revision,
      durationMs: Date.now() - startedAt,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      error: error instanceof Error ? error.message : String(error),
    };
    console.error(
      JSON.stringify({
        message: "created_attempt_dispatch_resume_failed",
        runId: run.id,
        attemptId,
        ...failed,
      }),
    );
    await repository.recordEvent?.(
      run.id,
      attempt.id,
      "attempt_dispatch_resume",
      failed,
    );
    throw error;
  }
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
  if (
    node.role &&
    [
      "qualify",
      "reproduce",
      "plan",
      "implement",
      "validate",
      "review",
      "integrate",
      "publish",
      "ci",
      "merge",
    ].includes(node.role)
  )
    return node.role as RunStage;
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
  node: WorkflowNode,
  profile?: AppliedProfile,
): Pick<RunTransition, "acceptedHead" | "heads"> {
  const identity = (
    transition: RunTransition,
  ): Pick<RunTransition, "acceptedHead" | "heads"> => ({
    ...(transition.acceptedHead
      ? { acceptedHead: transition.acceptedHead }
      : {}),
    ...(transition.heads ? { heads: transition.heads } : {}),
  });
  if (node.agent?.task === "implementation")
    return identity(implementationTransition(attempt));
  if (node.executor === "review") return identity(reviewTransition(attempt));
  if (node.executor === "validate" && node.role === "integrate")
    return identity(integrateTransition(attempt));
  if (node.executor === "github.checks") {
    const ci = attempt.result?.ci as Record<string, unknown> | undefined;
    if (ci?.status === "reintegrate")
      return {
        acceptedHead: attempt.acceptedHead,
        heads: { integrationHead: null, targetBaseHead: null },
      };
    return identity(ciTransition(attempt, profile));
  }
  if (node.executor === "github.merge") {
    const merge = attempt.result?.merge as Record<string, unknown> | undefined;
    if (merge?.status === "reintegrate")
      return {
        acceptedHead: attempt.acceptedHead,
        heads: { integrationHead: null, targetBaseHead: null },
      };
    return identity(mergeTransition(attempt));
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
      hasCandidate: Boolean(run.candidateHead),
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
  const evidence = evidenceForAttempt(attempt, node, run.profile);
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
      hadCandidate: Boolean(run.candidateHead),
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
    hadCandidate: Boolean(run.candidateHead),
    runRevision: next.revision,
  });
}

async function settleImmediateWorkflowWait(
  repository: RunRepository,
  run: RunSnapshot,
): Promise<RunSnapshot> {
  if (run.status !== "active" || !run.currentNodeId || !run.profile?.workflow)
    return run;
  const node = run.profile.workflow.nodes[run.currentNodeId];
  const waitingReason =
    node?.executor === "human"
      ? node.human?.reason
      : node?.executor === "external.wait" ||
          node?.executor === "external.check"
        ? "external_check"
        : node?.executor === "github.merge" &&
            run.profile.merge?.mode === "maintainer"
          ? "maintainer_merge"
          : undefined;
  if (!waitingReason) return run;
  const evidence = {
    auditVersion: 1,
    kind: "wait",
    runId: run.id,
    runRevision: run.revision,
    workflowHash: run.workflowHash,
    nodeId: run.currentNodeId,
    executor: node?.executor,
    boundHead: run.currentHead,
    actor: "roundhouse",
    evidence: { waitingReason },
  };
  console.log(
    JSON.stringify({ message: "workflow_boundary_waiting", ...evidence }),
  );
  await repository.recordEvent?.(
    run.id,
    undefined,
    "workflow_boundary_audit",
    evidence,
  );
  return (
    (await repository.transition(run.id, run.revision, {
      status: "waiting",
      stage: run.stage,
      currentNodeId: run.currentNodeId,
      waitingReason,
    })) ?? run
  );
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

type CompetitionStep =
  | { readonly kind: "dispatched" | "waiting" }
  | {
      readonly kind: "failed";
      readonly attempt: Attempt;
      readonly reason?: string;
    }
  | { readonly kind: "promoted"; readonly attempt: Attempt };

async function dispatchCompetitionAttempt(
  repository: RunRepository,
  dispatcher: AttemptDispatcher,
  run: RunSnapshot,
  node: WorkflowNode,
  role: string,
  competition: AttemptCompetition,
  now: number,
  leaseMilliseconds: number,
  reporter?: AttemptReporter,
  allowConcurrent = false,
): Promise<void> {
  const attemptId = competitionAttemptId(run.id, run.revision, role);
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
    if (
      await resumeCreatedDispatch(
        repository,
        dispatcher,
        reporter,
        run,
        attemptId,
      )
    )
      return;
    await revisitStarted(repository, reporter, run, attemptId);
    // Competition attempts fan out concurrently: when a sibling attempt
    // already holds the run lease, dispatch without it. The attempt's own
    // deadline still bounds inactivity, and the competition-aware expired
    // attempt query recovers it independently of the run lease.
    if (!allowConcurrent) return;
  }
  const capabilities = effectiveAttemptCapabilities(node, role).filter(
    (capability) =>
      // The judge only reads evidence; it never receives write authority even
      // when the competed stage is write-capable.
      competition.purpose === "judge" ? capability !== "artifact.write" : true,
  );
  const attempt: Attempt = {
    id: attemptId,
    runId: run.id,
    runRevision: run.revision,
    kind: "agent",
    ...(run.currentNodeId ? { nodeId: run.currentNodeId } : {}),
    ...(node.executor === "agent.read" || node.executor === "agent.write"
      ? { executor: node.executor }
      : { executor: "review" as const }),
    stage: run.stage,
    role,
    competition,
    capabilities,
    state: "created",
    deadlineAt: now + leaseMilliseconds,
    baseCommit: run.baseCommit,
    expectedHead: run.currentHead,
  };
  const startedAt = Date.now();
  const created = await repository.createAttempt(attempt);
  if (created === "created")
    await recordIssuedCapabilities(repository, attempt);
  try {
    await dispatcher.submit(attempt, run);
  } catch (error) {
    if (claimed)
      await repository.releaseLease(run.id, run.revision, attempt.id);
    throw error;
  }
  await repository.markDispatched(attempt.id);
  const payload = {
    workflowHash: run.workflowHash,
    nodeId: run.currentNodeId ?? null,
    role,
    purpose: competition.purpose,
    ...(competition.purpose === "candidate"
      ? { candidateId: competition.candidateId }
      : {}),
    inputHead: run.currentHead,
    durationMs: Date.now() - startedAt,
  };
  console.log(
    JSON.stringify({
      message: `competition_${competition.purpose}_dispatched`,
      runId: run.id,
      revision: run.revision,
      attemptId: attempt.id,
      ...payload,
    }),
  );
  await repository.recordEvent?.(
    run.id,
    attempt.id,
    `competition_${competition.purpose}_dispatched`,
    payload,
  );
  await reportStarted(reporter, run, attempt);
}

// Finishes a durably recorded selection: publishes the winner's state (when a
// promoter is wired) and marks the canonical attempt completed. Running this
// after the selection attempt exists makes an interrupted promotion resume
// idempotently on the next wakeup instead of repeating external effects
// blindly or losing them entirely.
async function finalizePromotion(
  repository: RunRepository,
  promoter: CompetitionPromoter | undefined,
  run: RunSnapshot,
  revisionAttempts: readonly Attempt[],
  baseRole: string,
  selected: Attempt,
  startedAt: number,
): Promise<CompetitionStep> {
  if (selected.state === "completed")
    return { kind: "promoted", attempt: selected };
  const judgement =
    selected.competition?.purpose === "selected"
      ? selected.competition.judgement
      : undefined;
  const winner = judgement
    ? revisionAttempts.find(
        (attempt) =>
          attempt.role ===
          competitionCandidateRole(baseRole, judgement.selected),
      )
    : undefined;
  if (promoter && winner && judgement)
    await promoter.promote(run, winner, judgement);
  await repository.completeAttempt(
    selected.id,
    run.revision,
    selected.acceptedHead ?? selected.expectedHead,
    selected.result ?? {},
  );
  const completed = (await repository.getAttempt(selected.id)) ?? selected;
  const payload = {
    workflowHash: run.workflowHash,
    nodeId: run.currentNodeId ?? null,
    role: baseRole,
    selected: judgement?.selected ?? null,
    winnerAttemptId: winner?.id ?? null,
    canonicalAttemptId: selected.id,
    acceptedHead: completed.acceptedHead ?? null,
    durationMs: Date.now() - startedAt,
  };
  console.log(
    JSON.stringify({
      message: "competition_winner_promoted",
      runId: run.id,
      revision: run.revision,
      ...payload,
    }),
  );
  await repository.recordEvent?.(
    run.id,
    selected.id,
    "competition_winner_promoted",
    payload,
  );
  return { kind: "promoted", attempt: completed };
}

// Drives one competition group (candidates, then judge, then promotion) for
// an agent node or a single reviewer. Every step is idempotent: a wakeup
// revisits the group and only advances when the required durable state is
// present.
async function coordinateCompetition(
  repository: RunRepository,
  dispatcher: AttemptDispatcher,
  run: RunSnapshot,
  node: WorkflowNode,
  baseRole: string,
  canonicalAttemptId: string,
  competition: WorkflowCompetition,
  now: number,
  leaseMilliseconds: number,
  reporter?: AttemptReporter,
  promoter?: CompetitionPromoter,
): Promise<CompetitionStep> {
  const startedAt = Date.now();
  const revisionAttempts = await repository.attemptsForRevision(
    run.id,
    run.revision,
  );
  const canonical = revisionAttempts.find(
    (attempt) =>
      attempt.role === baseRole && attempt.competition?.purpose === "selected",
  );
  if (canonical)
    return finalizePromotion(
      repository,
      promoter,
      run,
      revisionAttempts,
      baseRole,
      canonical,
      startedAt,
    );
  console.log(
    JSON.stringify({
      message: "competition_fanout_started",
      runId: run.id,
      revision: run.revision,
      workflowHash: run.workflowHash,
      nodeId: run.currentNodeId ?? null,
      role: baseRole,
      candidates: competition.candidates.map((candidate) => ({
        candidateId: candidate.id,
        model: candidate.model.id,
        reasoning: candidate.model.reasoning,
      })),
      judgeModel: competition.judge.model.id,
      inputHead: run.currentHead,
    }),
  );
  const candidateAttempts = new Map<string, Attempt>();
  // Dispatch every missing candidate in one pass so the independent
  // attempts fan out concurrently instead of running one wakeup apart.
  let inFlight = revisionAttempts.some(
    (attempt) =>
      attempt.competition &&
      ["created", "dispatched", "executed"].includes(attempt.state),
  );
  let pending = false;
  let dispatchedAny = false;
  for (const candidate of competition.candidates) {
    const role = competitionCandidateRole(baseRole, candidate.id);
    const attempt = revisionAttempts.find(
      (candidate_attempt) => candidate_attempt.role === role,
    );
    if (attempt?.state === "failed")
      return {
        kind: "failed",
        attempt,
        reason: "competition_candidate_failed",
      };
    if (!attempt) {
      await dispatchCompetitionAttempt(
        repository,
        dispatcher,
        run,
        node,
        role,
        { purpose: "candidate", candidateId: candidate.id },
        now,
        leaseMilliseconds,
        reporter,
        inFlight,
      );
      inFlight = true;
      pending = true;
      dispatchedAny = true;
      continue;
    }
    if (attempt.state !== "completed") {
      pending = true;
      continue;
    }
    if (attempt.expectedHead !== run.currentHead)
      return {
        kind: "failed",
        attempt,
        reason: "competition_candidate_head_mismatch",
      };
    candidateAttempts.set(candidate.id, attempt);
    console.log(
      JSON.stringify({
        message: "competition_candidate_completed",
        runId: run.id,
        revision: run.revision,
        nodeId: run.currentNodeId ?? null,
        role: baseRole,
        candidateId: candidate.id,
        attemptId: attempt.id,
        model: attempt.routing?.model ?? null,
        acceptedHead: attempt.acceptedHead ?? null,
      }),
    );
  }
  if (pending) return { kind: dispatchedAny ? "dispatched" : "waiting" };
  const judgeRole = competitionJudgeRole(baseRole);
  const judge = revisionAttempts.find((attempt) => attempt.role === judgeRole);
  if (judge?.state === "failed")
    return {
      kind: "failed",
      attempt: judge,
      reason: "competition_judge_failed",
    };
  if (!judge) {
    await dispatchCompetitionAttempt(
      repository,
      dispatcher,
      run,
      node,
      judgeRole,
      { purpose: "judge" },
      now,
      leaseMilliseconds,
      reporter,
    );
    return { kind: "dispatched" };
  }
  if (judge.state !== "completed") return { kind: "waiting" };
  const judgement = validateCompetitionJudgement(
    judge.result?.judgement,
    competition.candidates.map((candidate) => candidate.id),
  );
  if (!judgement) {
    const payload = {
      workflowHash: run.workflowHash,
      nodeId: run.currentNodeId ?? null,
      role: baseRole,
      judgeAttemptId: judge.id,
      result: judge.result ?? null,
    };
    console.error(
      JSON.stringify({
        message: "competition_judgement_invalid",
        runId: run.id,
        revision: run.revision,
        ...payload,
      }),
    );
    await repository.recordEvent?.(
      run.id,
      judge.id,
      "competition_judgement_invalid",
      payload,
    );
    return {
      kind: "failed",
      attempt: judge,
      reason: "competition_judgement_invalid",
    };
  }
  const winner = candidateAttempts.get(judgement.selected)!;
  console.log(
    JSON.stringify({
      message: "competition_judgement_validated",
      runId: run.id,
      revision: run.revision,
      nodeId: run.currentNodeId ?? null,
      role: baseRole,
      judgeAttemptId: judge.id,
      selected: judgement.selected,
      scores: judgement.scores,
      durationMs: Date.now() - startedAt,
    }),
  );
  // Persist the selection before any external publication so a failure
  // between the two is recovered from durable state rather than repeated.
  const promoted: Attempt = {
    id: canonicalAttemptId,
    runId: run.id,
    runRevision: run.revision,
    kind: "agent",
    ...(run.currentNodeId ? { nodeId: run.currentNodeId } : {}),
    ...(node.executor === "agent.read" || node.executor === "agent.write"
      ? { executor: node.executor }
      : { executor: "review" as const }),
    stage: run.stage,
    role: baseRole,
    capabilities: winner.capabilities,
    state: "dispatched",
    deadlineAt: now,
    baseCommit: winner.baseCommit,
    expectedHead: winner.expectedHead,
    acceptedHead: winner.acceptedHead ?? winner.expectedHead,
    result: winner.result,
    ...(winner.routing ? { routing: winner.routing } : {}),
    competition: {
      purpose: "selected",
      candidateId: judgement.selected,
      judgement,
    },
  };
  await repository.createAttempt(promoted);
  return finalizePromotion(
    repository,
    promoter,
    run,
    [...revisionAttempts, promoted],
    baseRole,
    promoted,
    startedAt,
  );
}

export async function coordinate(
  repository: RunRepository,
  dispatcher: AttemptDispatcher,
  wakeup: Wakeup,
  now: number,
  leaseMilliseconds = attemptInactivityMilliseconds,
  reporter?: AttemptReporter,
  promoter?: CompetitionPromoter,
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
  if (
    currentWorkflowNode.executor === "human" ||
    currentWorkflowNode.executor === "external.wait" ||
    currentWorkflowNode.executor === "external.check"
  ) {
    const signal = run.resumeSignal;
    const humanMatches =
      currentWorkflowNode.executor === "human" &&
      signal?.kind === "human" &&
      signal.reason === currentWorkflowNode.human?.reason;
    const externalMatches =
      currentWorkflowNode.executor !== "human" &&
      signal?.kind === "external" &&
      signal.adapter === currentWorkflowNode.external?.adapter &&
      signal.event === currentWorkflowNode.external?.event;
    const audit = (
      kind: string,
      actor: string,
      evidence: Readonly<Record<string, unknown>>,
    ) => ({
      auditVersion: 1,
      kind,
      runId: run.id,
      runRevision: run.revision,
      workflowHash: run.workflowHash,
      nodeId: run.currentNodeId,
      executor: currentWorkflowNode.executor,
      boundHead: run.currentHead,
      actor,
      evidence,
    });
    if (!humanMatches && !externalMatches) {
      const waitingReason =
        currentWorkflowNode.human?.reason ?? "external_check";
      console.log(
        JSON.stringify({
          message: "workflow_boundary_waiting",
          ...audit("wait", "roundhouse", {
            waitingReason,
            ...(currentWorkflowNode.external
              ? {
                  adapter: currentWorkflowNode.external.adapter,
                  event: currentWorkflowNode.external.event,
                }
              : {
                  audience: currentWorkflowNode.human?.audience,
                  promptSource:
                    currentWorkflowNode.human?.prompt?.sourcePath ?? null,
                }),
          }),
        }),
      );
      await repository.recordEvent?.(
        run.id,
        undefined,
        "workflow_boundary_audit",
        audit("wait", "roundhouse", { waitingReason }),
      );
      const next = await repository.transition(run.id, run.revision, {
        status: "waiting",
        stage: run.stage,
        currentNodeId: run.currentNodeId,
        waitingReason,
      });
      return next ? "dispatched" : "stale";
    }
    const attemptId = immutableAttemptId(run.id, run.revision);
    const result = humanMatches
      ? {
          human: {
            status: "answered",
            actor: signal.actor,
            body: signal.body,
            ...(signal.url ? { url: signal.url } : {}),
          },
        }
      : {
          [currentWorkflowNode.external!.resultKey]:
            signal.kind === "external" ? signal.payload : {},
        };
    const attempt: Attempt = {
      id: attemptId,
      runId: run.id,
      runRevision: run.revision,
      kind: "external",
      nodeId: run.currentNodeId,
      executor: currentWorkflowNode.executor,
      stage: run.stage,
      role: currentWorkflowNode.role ?? currentWorkflowNode.executor,
      capabilities: effectiveAttemptCapabilities(
        currentWorkflowNode,
        currentWorkflowNode.role ?? currentWorkflowNode.executor,
      ),
      state: "completed",
      deadlineAt: now,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
      acceptedHead: run.currentHead,
      result,
    };
    await repository.createAttempt(attempt);
    const actor = signal.actor;
    const envelope = audit(
      humanMatches ? "human.resume" : "external.resume",
      actor,
      humanMatches
        ? { reason: signal.kind === "human" ? signal.reason : null }
        : {
            adapter: signal.kind === "external" ? signal.adapter : null,
            event: signal.kind === "external" ? signal.event : null,
          },
    );
    console.log(
      JSON.stringify({ message: "workflow_boundary_resumed", ...envelope }),
    );
    await repository.recordEvent?.(
      run.id,
      attempt.id,
      "workflow_boundary_audit",
      envelope,
    );
    const next = await repository.transition(
      run.id,
      run.revision,
      graphCompletedTransition(run, attempt),
    );
    if (!next) return "stale";
    await recordWorkflowTransition(repository, run, attempt, next);
    const settled = await settleImmediateWorkflowWait(repository, next);
    if (reporter) await reporter.report(settled, attempt);
    return "dispatched";
  }
  if (currentWorkflowNode.executor === "review") {
    const review = currentWorkflowNode.review!;
    let current = await repository.attemptsForRevision(run.id, run.revision);
    const operationalOutcome = current.find((attempt) => attempt.outcome);
    if (operationalOutcome) {
      const next = await repository.transition(
        run.id,
        run.revision,
        attemptOutcomeTransition(run, operationalOutcome),
      );
      if (!next) return "stale";
      await recordAttemptOutcomeTransition(
        repository,
        run,
        operationalOutcome,
        next,
      );
      return "dispatched";
    }
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
      if (
        definition.competition &&
        (!attempt || attempt.state !== "completed")
      ) {
        const step = await coordinateCompetition(
          repository,
          dispatcher,
          run,
          currentWorkflowNode,
          role,
          reviewerAttemptId(run.id, run.revision, role),
          definition.competition,
          now,
          leaseMilliseconds,
          reporter,
          promoter,
        );
        if (step.kind === "promoted") {
          current = [
            ...current.filter((candidate) => candidate.role !== role),
            step.attempt,
          ];
          continue;
        }
        if (step.kind === "failed") {
          const next = await repository.transition(run.id, run.revision, {
            status: "failed",
            stage: "review",
          });
          if (!next) return "stale";
          if (reporter) await reporter.report(next, step.attempt);
          return "dispatched";
        }
        return step.kind === "dispatched" ? "dispatched" : "duplicate";
      }
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
    if (!aggregate) throw new Error("workflow_review_join_invariant");
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
    const settled = await settleImmediateWorkflowWait(repository, next);
    if (reporter) await reporter.report(settled, aggregate);
    return "dispatched";
  }
  if (currentWorkflowNode.agent?.competition) {
    const step = await coordinateCompetition(
      repository,
      dispatcher,
      run,
      currentWorkflowNode,
      currentWorkflowNode.role ?? run.stage,
      immutableAttemptId(run.id, run.revision),
      currentWorkflowNode.agent.competition,
      now,
      leaseMilliseconds,
      reporter,
      promoter,
    );
    if (step.kind === "promoted") {
      const transition = graphCompletedTransition(run, step.attempt);
      const next = await repository.transition(
        run.id,
        run.revision,
        transition,
      );
      if (!next) return "stale";
      await recordWorkflowTransition(repository, run, step.attempt, next);
      const settled = await settleImmediateWorkflowWait(repository, next);
      if (reporter) await reporter.report(settled, step.attempt);
      return "dispatched";
    }
    if (step.kind === "failed") {
      const next = await repository.transition(run.id, run.revision, {
        status: "failed",
        stage: run.stage,
      });
      if (!next) return "stale";
      if (reporter) await reporter.report(next, step.attempt);
      return "dispatched";
    }
    return step.kind === "dispatched" ? "dispatched" : "duplicate";
  }
  const attemptId = immutableAttemptId(run.id, run.revision);
  const previous = await repository.getAttempt(attemptId);
  if (previous?.outcome) {
    const next = await repository.transition(
      run.id,
      run.revision,
      attemptOutcomeTransition(run, previous),
    );
    if (!next) return "stale";
    await recordAttemptOutcomeTransition(repository, run, previous, next);
    return "dispatched";
  }
  if (previous?.state === "completed") {
    const transition = graphCompletedTransition(run, previous);
    const next = await repository.transition(run.id, run.revision, transition);
    if (!next) return "stale";
    await recordWorkflowTransition(repository, run, previous, next);
    const settled = await settleImmediateWorkflowWait(repository, next);
    if (reporter) await reporter.report(settled, previous);
    return "dispatched";
  }
  if (
    !new Set(["agent.read", "agent.write", "validate"]).has(
      currentWorkflowNode.executor,
    )
  )
    throw new Error(
      `workflow_executor_not_runnable:${currentWorkflowNode.executor}`,
    );
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
  const attempt: Attempt = {
    id: attemptId,
    runId: run.id,
    runRevision: run.revision,
    kind: "agent",
    nodeId: run.currentNodeId,
    executor: currentWorkflowNode.executor,
    stage: run.stage,
    role,
    capabilities: effectiveAttemptCapabilities(currentWorkflowNode, role),
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
  const acquired = await repository.acquireAttempt(
    run.id,
    run.revision,
    {
      attemptId,
      runRevision: run.revision,
      expiresAt: now + leaseMilliseconds,
    },
    attempt,
    now,
  );
  if (acquired === "busy") {
    if (
      await resumeCreatedDispatch(
        repository,
        dispatcher,
        reporter,
        run,
        attemptId,
      )
    )
      return "dispatched";
    await revisitStarted(repository, reporter, run, attemptId);
    return "duplicate";
  }
  if (acquired === "created")
    await recordIssuedCapabilities(repository, attempt);
  const durable = await repository.getAttempt(attemptId);
  if (acquired === "exists" && durable?.state === "completed")
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
    capabilities: effectiveAttemptCapabilities(
      run.profile!.workflow!.nodes[run.currentNodeId!]!,
      role,
    ),
    state: "created",
    deadlineAt: now + leaseMilliseconds,
    baseCommit: run.baseCommit,
    expectedHead: run.currentHead,
  };
  const acquired = await repository.acquireAttempt(
    run.id,
    run.revision,
    {
      attemptId,
      runRevision: run.revision,
      expiresAt: now + leaseMilliseconds,
    },
    attempt,
    now,
  );
  if (acquired === "busy") {
    if (
      await resumeCreatedDispatch(
        repository,
        dispatcher,
        reporter,
        run,
        attemptId,
      )
    )
      return "dispatched";
    await revisitStarted(repository, reporter, run, attemptId);
    return "duplicate";
  }
  if (acquired === "created")
    await recordIssuedCapabilities(repository, attempt);
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
