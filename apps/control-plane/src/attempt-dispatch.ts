// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { observeResponse } from "@roundhouse/response-observer";
import {
  attemptHasCapability,
  isModelRoute,
  profileModelForAttempt,
  requiredWorkflowAgentInputs,
  reviewerForRole,
  type Attempt,
  type ModelRoute,
  type RunRepository,
  type RunSnapshot,
  type WorkflowAgent,
  type WorkflowCompetition,
  type WorkflowModel,
  type WorkflowNode,
} from "@roundhouse/core";
import { aggregatedReview } from "./aggregated-review.js";
import { signCallback } from "./callback.js";
import {
  aggregateReviewAttempts,
  type AttemptDispatcher,
} from "./coordinator.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";
import {
  artifactsNamespace,
  attemptSandbox,
  attemptWorkspaceBackupKey,
  attemptWorkspaceRef,
  conflictedIntegrationOutcome,
  artifactRepositoryName,
  destroyAttemptSandbox,
  sandboxName,
  workspaceBackup,
  type SandboxNamespace,
} from "./attempt-runtime.js";

export type AttemptPreparationEnv = Cloudflare.Env & {
  readonly DB: D1Like;
  readonly ATTEMPT_SANDBOXES: SandboxNamespace;
  readonly CALLBACK_SIGNING_SECRET: string;
  readonly CONTROL_PLANE_ORIGIN: string;
  readonly MODEL_BROKER: Fetcher;
};

export interface AttemptWorkflowParams {
  readonly attemptId: string;
  readonly sandboxName: string;
  readonly mode?: "execute" | "settle";
}

type AttemptWorkflowBinding = Pick<
  Workflow<AttemptWorkflowParams>,
  "create" | "get"
>;

type AttemptEventRepository = Pick<D1RunRepository, "recordAttemptEvent">;

export class DurableAttemptDispatcher implements AttemptDispatcher {
  constructor(
    private readonly workflow: AttemptWorkflowBinding,
    private readonly repository: AttemptEventRepository,
  ) {}

  async submit(attempt: Attempt, run: RunSnapshot): Promise<void> {
    const startedAt = Date.now();
    const workflowInstanceId = attempt.id;
    let created = true;
    let status = "queued";
    console.log(
      JSON.stringify({
        message: "attempt_workflow_dispatch_started",
        runId: run.id,
        revision: run.revision,
        attemptId: attempt.id,
        workflowInstanceId,
      }),
    );
    try {
      try {
        const instance = await this.workflow.create({
          id: workflowInstanceId,
          params: {
            attemptId: attempt.id,
            sandboxName: sandboxName(attempt),
          },
        });
        status = (await instance.status()).status;
      } catch (createError) {
        const instance = await this.workflow.get(workflowInstanceId);
        const existing = await instance.status();
        if (existing.status === "unknown") throw createError;
        created = false;
        status = existing.status;
      }
      const payload = {
        phase: "attempt_workflow_created",
        workflowInstanceId,
        created,
        status,
        durationMs: Date.now() - startedAt,
      };
      console.log(
        JSON.stringify({
          message: "attempt_workflow_dispatch_completed",
          runId: run.id,
          revision: run.revision,
          attemptId: attempt.id,
          ...payload,
        }),
      );
      await this.repository.recordAttemptEvent(
        attempt.id,
        "attempt_workflow",
        payload,
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "attempt_workflow_dispatch_failed",
          runId: run.id,
          revision: run.revision,
          attemptId: attempt.id,
          workflowInstanceId,
          durationMs: Date.now() - startedAt,
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    }
  }
}

// Prior-stage outcomes passed to an attempt as context. CI failure
// diagnostics travel here as durable, explicitly untrusted evidence; no
// GitHub credential or API capability is ever part of this object.
export function attemptContext(parts: {
  readonly qualification?: unknown;
  readonly reproduction?: unknown;
  readonly plan?: unknown;
  readonly implementation?: unknown;
  readonly holisticSelection?: unknown;
  readonly review?: unknown;
  readonly ci?: unknown;
}): Readonly<Record<string, unknown>> | undefined {
  const {
    qualification,
    reproduction,
    plan,
    implementation,
    holisticSelection,
    review,
    ci,
  } = parts;
  if (
    !qualification &&
    !reproduction &&
    !plan &&
    !implementation &&
    !review &&
    !ci
  )
    return undefined;
  return {
    ...(qualification ? { qualification } : {}),
    ...(reproduction ? { reproduction } : {}),
    ...(plan ? { plan } : {}),
    ...(implementation ? { implementation } : {}),
    ...(holisticSelection ? { holisticSelection } : {}),
    ...(review ? { review } : {}),
    ...(ci ? { ci } : {}),
  };
}

export function artifactNeedsSync(
  artifact: { readonly empty: boolean; readonly head?: string },
  attempt: Pick<Attempt, "capabilities">,
  run: Pick<RunSnapshot, "baseCommit" | "currentHead" | "candidateHead">,
): boolean {
  return (
    artifact.empty ||
    (attemptHasCapability(attempt, "artifact.write") &&
      artifact.head !== run.currentHead)
  );
}

export function attemptArtifactAccess(
  attempt: Pick<Attempt, "capabilities"> &
    Partial<Pick<Attempt, "executor" | "role">>,
): "read" | "write" {
  return attemptHasCapability(attempt, "artifact.write") ? "write" : "read";
}

interface ResolvedWorkflowInputs {
  readonly values: Readonly<Record<string, unknown>>;
  readonly evidence: Readonly<
    Record<
      string,
      {
        readonly selector: string;
        readonly present: boolean;
        readonly sourceAttemptId?: string;
        readonly sourceAttemptIds?: readonly string[];
        readonly sourceHead?: string;
      }
    >
  >;
}

function nestedValue(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (current, segment) =>
      current && typeof current === "object"
        ? (current as Record<string, unknown>)[segment]
        : undefined,
    value,
  );
}

function aggregateImplementationAttempts(
  attempts: readonly Attempt[],
): Attempt | undefined {
  const latest = attempts.at(-1);
  if (!latest) return undefined;
  const screenshots = new Map<string, unknown>();
  for (const attempt of attempts) {
    const implementation = attempt.result?.implementation as
      Record<string, unknown> | undefined;
    if (!Array.isArray(implementation?.screenshots)) continue;
    for (const screenshot of implementation.screenshots) {
      if (!screenshot || typeof screenshot !== "object") continue;
      const url = (screenshot as Record<string, unknown>).url;
      if (typeof url === "string" && url) screenshots.set(url, screenshot);
    }
  }
  if (!screenshots.size) return latest;
  const latestImplementation = latest.result?.implementation as
    Record<string, unknown> | undefined;
  return {
    ...latest,
    result: {
      ...latest.result,
      implementation: {
        ...latestImplementation,
        screenshots: [...screenshots.values()],
      },
    },
  };
}

export async function resolveWorkflowAgentInputs(
  repository: Pick<
    RunRepository,
    | "latestCompletedNodeAttempt"
    | "completedNodeAttempts"
    | "attemptsForRevision"
  >,
  run: RunSnapshot,
  attempt: Attempt,
  agent: WorkflowAgent,
): Promise<ResolvedWorkflowInputs> {
  const values: Record<string, unknown> = {};
  const evidence: Record<
    string,
    {
      selector: string;
      present: boolean;
      sourceAttemptId?: string;
      sourceAttemptIds?: readonly string[];
      sourceHead?: string;
    }
  > = {};
  for (const [name, selector] of Object.entries(agent.inputs)) {
    if (selector === "trigger.issue") {
      const present = run.issue !== undefined;
      if (present) values[name] = run.issue;
      evidence[name] = { selector, present };
      continue;
    }
    const match = /^nodes\.([a-z][a-z0-9-]{0,63})\.(.+)$/.exec(selector);
    if (!match) throw new Error("workflow_agent_input_selector_invalid");
    const source = await repository.latestCompletedNodeAttempt(
      run.id,
      match[1]!,
      run.revision,
    );
    const sourceNode = run.profile?.workflow?.nodes[match[1]!];
    let sourceAttempts: readonly Attempt[] = source ? [source] : [];
    if (source && sourceNode?.executor === "review")
      sourceAttempts = (
        await repository.attemptsForRevision(run.id, source.runRevision)
      ).filter(
        (candidate) =>
          candidate.nodeId === match[1] && candidate.state === "completed",
      );
    else if (source && sourceNode?.agent?.task === "implementation") {
      const aggregationStartedAt = Date.now();
      console.log(
        JSON.stringify({
          message: "workflow_implementation_evidence_load_started",
          runId: run.id,
          revision: run.revision,
          attemptId: attempt.id,
          sourceNodeId: match[1],
        }),
      );
      sourceAttempts = await repository.completedNodeAttempts(
        run.id,
        match[1]!,
        run.revision,
      );
      console.log(
        JSON.stringify({
          message: "workflow_implementation_evidence_load_completed",
          runId: run.id,
          revision: run.revision,
          attemptId: attempt.id,
          sourceNodeId: match[1],
          sourceAttemptIds: sourceAttempts.map(({ id }) => id),
          durationMs: Date.now() - aggregationStartedAt,
        }),
      );
    }
    const resolvedSource =
      source && sourceNode?.executor === "review"
        ? aggregateReviewAttempts(
            sourceAttempts,
            run.profile,
            sourceNode.review,
          )
        : sourceNode?.agent?.task === "implementation"
          ? aggregateImplementationAttempts(sourceAttempts)
          : source;
    const resolved = resolvedSource
      ? nestedValue(resolvedSource.result, match[2]!.split("."))
      : undefined;
    const present = resolved !== undefined;
    if (present) values[name] = resolved;
    evidence[name] = {
      selector,
      present,
      ...(source
        ? {
            sourceAttemptId: source.id,
            ...(sourceAttempts.length > 1
              ? { sourceAttemptIds: sourceAttempts.map(({ id }) => id) }
              : {}),
            sourceHead: source.acceptedHead ?? source.expectedHead,
          }
        : {}),
    };
  }
  const missing = requiredWorkflowAgentInputs(agent.task).filter(
    (name) => values[name] === undefined,
  );
  if (missing.length) {
    console.error(
      JSON.stringify({
        message: "workflow_agent_inputs_missing",
        runId: run.id,
        revision: run.revision,
        attemptId: attempt.id,
        nodeId: attempt.nodeId ?? null,
        task: agent.task,
        missing,
        evidence,
      }),
    );
    throw new Error(`workflow_agent_inputs_missing:${missing.join(",")}`);
  }
  return { values, evidence };
}

// Finds the competition definition governing a candidate or judge attempt,
// whether it is configured on an agent node or on an individual reviewer.
function competitionForAttempt(
  node: WorkflowNode | undefined,
  attempt: Attempt,
): WorkflowCompetition | undefined {
  if (node?.agent?.competition) return node.agent.competition;
  return node?.review?.reviewers.find(
    (reviewer) =>
      attempt.role === reviewer.id ||
      attempt.role.startsWith(`${reviewer.id}-`),
  )?.competition;
}

function requestedModelForAttempt(
  node: WorkflowNode | undefined,
  attempt: Attempt,
  run: RunSnapshot,
): WorkflowModel | undefined {
  const competition = competitionForAttempt(node, attempt);
  if (attempt.competition?.purpose === "candidate") {
    const candidateId = attempt.competition.candidateId;
    return competition?.candidates.find(
      (candidate) => candidate.id === candidateId,
    )?.model;
  }
  if (attempt.competition?.purpose === "judge") return competition?.judge.model;
  return (
    node?.agent?.model ??
    node?.review?.reviewers.find((reviewer) => reviewer.id === attempt.role)
      ?.model ??
    (run.profile
      ? profileModelForAttempt(run.profile, attempt.stage, attempt.role)
      : undefined)
  );
}

// Selects the candidate evidence a judge attempt receives: exactly the
// completed candidates belonging to this judge's own competition, scoped by
// node and reviewer role so a review node with several competing reviewers
// never mixes candidates across groups.
export function judgementCandidateAttempts(
  attempts: readonly Attempt[],
  judge: Attempt,
  competition: WorkflowCompetition | undefined,
): readonly Attempt[] {
  if (judge.competition?.purpose !== "judge") return [];
  const baseRole = judge.role.endsWith("-judge")
    ? judge.role.slice(0, -"-judge".length)
    : judge.role;
  return attempts.filter(
    (candidate) =>
      candidate.competition?.purpose === "candidate" &&
      candidate.state === "completed" &&
      candidate.role.startsWith(`${baseRole}-candidate-`) &&
      (competition?.candidates.some(
        (configured) =>
          candidate.competition?.purpose === "candidate" &&
          configured.id === candidate.competition.candidateId,
      ) ??
        true),
  );
}

class SandboxAttemptPreparer {
  constructor(
    private readonly env: AttemptPreparationEnv,
    private readonly runs: D1RunRepository,
  ) {}

  private async resolveModelRoute(
    attempt: Attempt,
    taskType: string,
    run: RunSnapshot,
  ): Promise<ModelRoute> {
    const node =
      attempt.nodeId && run.profile?.workflow
        ? run.profile.workflow.nodes[attempt.nodeId]
        : undefined;
    const requested = requestedModelForAttempt(node, attempt, run);
    const startedAt = Date.now();
    const response = await observeResponse(
      await this.env.MODEL_BROKER.fetch(
        new Request("https://broker.roundhouse.internal/route", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            role: attempt.role,
            taskType,
            complexity: "unknown",
            ...(requested
              ? {
                  requestedModel: requested.id,
                  requestedReasoning: requested.reasoning,
                  profileHash: run.profile?.hash,
                }
              : {}),
          }),
        }),
      ),
      {
        api: "model_broker",
        operation: "resolve_route",
        attemptId: attempt.id,
      },
    );
    if (!response.ok) throw new Error(`model_route_http_${response.status}`);
    const route = (await response.json()) as ModelRoute;
    if (!isModelRoute(route)) throw new Error("invalid_model_route");
    console.log(
      JSON.stringify({
        message: "model_route_resolved",
        attemptId: attempt.id,
        role: attempt.role,
        requestedModel: requested?.id ?? null,
        requestedReasoning: requested?.reasoning ?? null,
        resolvedProvider: route.provider,
        resolvedModel: route.model,
        resolvedReasoning: route.thinkingLevel,
        routingRule: route.rule,
        profileHash: run.profile?.hash ?? null,
        durationMs: Date.now() - startedAt,
      }),
    );
    await this.runs.recordModelRouting(attempt.id, route);
    return route;
  }

  async prepare(attempt: Attempt, run: RunSnapshot): Promise<void> {
    const workflowNode =
      attempt.nodeId && run.profile?.workflow
        ? run.profile.workflow.nodes[attempt.nodeId]
        : undefined;
    if (
      ["agent.read", "agent.write"].includes(attempt.executor ?? "") &&
      !workflowNode?.agent
    )
      throw new Error("workflow_agent_contract_missing");
    const resolvedInputs = workflowNode?.agent
      ? await resolveWorkflowAgentInputs(
          this.runs,
          run,
          attempt,
          workflowNode.agent,
        )
      : undefined;
    const previousOutcomeAttempt =
      run.revision > 1
        ? (await this.runs.attemptsForRevision(run.id, run.revision - 1)).find(
            (candidate) => candidate.outcome,
          )
        : undefined;
    const previousExecutorOutcome = previousOutcomeAttempt?.outcome;
    if (workflowNode?.agent && resolvedInputs) {
      const resolution = {
        phase: "workflow_agent_resolved",
        workflowHash: run.workflowHash,
        nodeId: attempt.nodeId,
        executor: workflowNode.executor,
        task: workflowNode.agent.task,
        schema: workflowNode.agent.result.schema,
        resultKey: workflowNode.agent.result.key,
        promptSource: workflowNode.agent.prompt?.sourcePath ?? null,
        requestedModel:
          requestedModelForAttempt(workflowNode, attempt, run)?.id ?? null,
        requestedReasoning:
          requestedModelForAttempt(workflowNode, attempt, run)?.reasoning ??
          null,
        competition: attempt.competition ?? null,
        capabilities: workflowNode.capabilities,
        effectiveCapabilities: attempt.capabilities ?? [],
        previousOutcomeAttemptId: previousOutcomeAttempt?.id ?? null,
        previousExecutorOutcome: previousExecutorOutcome ?? null,
        inputs: resolvedInputs.evidence,
      };
      console.log(
        JSON.stringify({
          message: "workflow_agent_resolved",
          runId: run.id,
          revision: run.revision,
          attemptId: attempt.id,
          ...resolution,
        }),
      );
      await this.runs.recordAttemptEvent(
        attempt.id,
        "workflow_agent_resolved",
        resolution,
      );
    }
    const taskType =
      attempt.competition?.purpose === "judge"
        ? "judgement"
        : (workflowNode?.agent?.task ??
          (attempt.role === "conflict-resolution"
            ? "implementation"
            : attempt.stage === "review" ||
                attempt.role === "review-integration"
              ? "review"
              : "validation"));
    // Mechanical integration is a no-model operation; only conflict
    // resolution routes to an implementation model.
    const route =
      attempt.role === "integrate"
        ? undefined
        : await this.resolveModelRoute(attempt, taskType, run);
    const artifactRepository = await artifactsNamespace(this.env).ensure(
      artifactRepositoryName(attempt),
    );
    // Recovery invalidates every token from an interrupted container before a
    // replacement receives a fresh, short-lived credential.
    await artifactRepository.revokeActiveTokens();
    const sandbox = attemptSandbox(
      this.env.ATTEMPT_SANDBOXES,
      sandboxName(attempt),
    );
    const attemptSecret = await signCallback(
      this.env.CALLBACK_SIGNING_SECRET,
      attempt.id,
    );
    const syncArtifact = artifactNeedsSync(artifactRepository, attempt, run);
    if (syncArtifact) {
      const syncStartedAt = Date.now();
      const syncDetail = {
        phase: "artifact_sync_started",
        artifactHead: artifactRepository.head ?? null,
        sourceHead: run.currentHead,
        force: !artifactRepository.empty,
      };
      console.log(
        JSON.stringify({
          message: "artifact_sync_started",
          attemptId: attempt.id,
          ...syncDetail,
        }),
      );
      await this.runs.recordAttemptEvent(
        attempt.id,
        "artifact_sync",
        syncDetail,
      );
      const bootstrapToken = await artifactRepository.createToken(
        "write",
        30 * 60,
      );
      try {
        const response = await sandbox.runAttempt(
          "/bootstrap",
          {
            ...attempt,
            artifact: {
              repositoryId: artifactRepository.id,
              repository: artifactRepository.name,
              remote: artifactRepository.remote,
              hostname: artifactRepository.hostname,
              tokenId: bootstrapToken.id,
              token: bootstrapToken.plaintext,
              access: bootstrapToken.access,
            },
            source: {
              remote: `https://github.com/${run.repository}.git`,
              hostname: "github.com",
              branch: run.githubDefaultBranch ?? "main",
              head: run.currentHead,
              force: !artifactRepository.empty,
            },
          },
          attemptSecret,
        );
        if (response.status !== 204)
          throw new Error("sandbox_bootstrap_failed");
      } catch (error) {
        const failure = {
          phase: "artifact_sync_failed",
          durationMs: Date.now() - syncStartedAt,
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
          error: error instanceof Error ? error.message : String(error),
        };
        console.error(
          JSON.stringify({
            message: "artifact_sync_failed",
            attemptId: attempt.id,
            ...failure,
          }),
        );
        await this.runs.recordAttemptEvent(
          attempt.id,
          "artifact_sync",
          failure,
        );
        await artifactRepository.revokeToken(bootstrapToken.id);
        throw error;
      }
      await artifactRepository.revokeToken(bootstrapToken.id);
      const completed = {
        phase: "artifact_sync_completed",
        durationMs: Date.now() - syncStartedAt,
        sourceHead: run.currentHead,
      };
      console.log(
        JSON.stringify({
          message: "artifact_sync_completed",
          attemptId: attempt.id,
          ...completed,
        }),
      );
      await this.runs.recordAttemptEvent(
        attempt.id,
        "artifact_sync",
        completed,
      );
    }
    const access = attemptArtifactAccess(attempt);
    const token = await artifactRepository.createToken(access, 30 * 60);
    const qualificationAttempt = [
      "reproduce",
      "plan",
      "implement",
      "review",
    ].includes(attempt.stage)
      ? await this.runs.latestCompletedAttempt(run.id, "qualify", run.revision)
      : undefined;
    const reproductionAttempt = ["plan", "implement", "review"].includes(
      attempt.stage,
    )
      ? await this.runs.latestCompletedAttempt(
          run.id,
          "reproduce",
          run.revision,
        )
      : undefined;
    const planAttempt =
      attempt.stage === "implement" || attempt.stage === "review"
        ? await this.runs.latestCompletedAttempt(run.id, "plan", run.revision)
        : undefined;
    const implementationAttempt = ["implement", "review"].includes(
      attempt.stage,
    )
      ? await this.runs.latestCompletedAttempt(
          run.id,
          "implement",
          run.revision,
        )
      : undefined;
    const reviewAttempt =
      attempt.stage === "implement" || attempt.role === "conflict-resolution"
        ? await this.runs.latestCompletedAttempt(run.id, "review", run.revision)
        : undefined;
    const reviewAttempts = reviewAttempt
      ? (
          await this.runs.attemptsForRevision(run.id, reviewAttempt.runRevision)
        ).filter(
          (candidate) =>
            candidate.stage === "review" && candidate.state === "completed",
        )
      : [];
    const ciAttempt =
      attempt.stage === "implement"
        ? await this.runs.latestCompletedAttempt(run.id, "ci", run.revision)
        : undefined;
    const conflictedOutcome = [
      "conflict-resolution",
      "review-integration",
    ].includes(attempt.role)
      ? await conflictedIntegrationOutcome(this.runs, run)
      : undefined;
    const qualification = qualificationAttempt?.result?.qualification;
    const reproduction = reproductionAttempt?.result?.reproduction;
    const plan = planAttempt?.result?.plan;
    const implementation = implementationAttempt?.result?.implementation;
    const review = reviewAttempt
      ? aggregatedReview(
          reviewAttempts,
          run.profile,
          reviewAttempt.nodeId
            ? run.profile?.workflow?.nodes[reviewAttempt.nodeId]?.review
            : undefined,
        )
      : undefined;
    const ci = ciAttempt?.result?.ci;
    const integrateEvidence =
      attempt.role === "conflict-resolution"
        ? {
            qualification:
              qualification ??
              (
                await this.runs.latestCompletedAttempt(
                  run.id,
                  "qualify",
                  run.revision,
                )
              )?.result?.qualification,
            plan:
              plan ??
              (
                await this.runs.latestCompletedAttempt(
                  run.id,
                  "plan",
                  run.revision,
                )
              )?.result?.plan,
            implementation:
              implementation ??
              (
                await this.runs.latestCompletedAttempt(
                  run.id,
                  "implement",
                  run.revision,
                )
              )?.result?.implementation,
            review,
          }
        : undefined;
    const configuredReviewer = workflowNode?.review?.reviewers.find(
      (candidate) => candidate.id === attempt.role,
    );
    const reviewer = configuredReviewer ?? reviewerForRole(attempt.role);
    const sameRevisionReviews =
      attempt.stage === "review"
        ? await this.runs.attemptsForRevision(run.id, run.revision)
        : [];
    const selectorRole = configuredReviewer?.selectedBy ?? "review-holistic";
    const holisticSelection = sameRevisionReviews.find(
      (candidate) => candidate.role === selectorRole,
    )?.result?.review;
    if (!workflowNode?.agent && attempt.stage === "reproduce" && !qualification)
      throw new Error("reproduction_qualification_missing");
    if (!workflowNode?.agent && attempt.stage === "plan" && !reproduction)
      throw new Error("planning_reproduction_missing");
    if (!workflowNode?.agent && attempt.stage === "implement" && !plan)
      throw new Error("implementation_plan_missing");
    if (attempt.stage === "review" && !implementation)
      throw new Error("review_implementation_missing");
    // The judge receives exactly the candidates configured for its own
    // competition as untrusted data, alongside the node's resolved inputs.
    const judgementCandidates =
      attempt.competition?.purpose === "judge"
        ? judgementCandidateAttempts(
            await this.runs.attemptsForRevision(run.id, run.revision),
            attempt,
            competitionForAttempt(workflowNode, attempt),
          ).map((candidate) => ({
            candidateId:
              candidate.competition?.purpose === "candidate"
                ? candidate.competition.candidateId
                : "",
            result: candidate.result ?? {},
            model: candidate.routing?.model ?? null,
            expectedHead: candidate.expectedHead,
            acceptedHead: candidate.acceptedHead ?? candidate.expectedHead,
          }))
        : undefined;
    const assignment = {
      ...attempt,
      baseCommit: attempt.baseCommit,
      profile: run.profile,
      issue: run.issue,
      issueNumber: run.issueNumber,
      ...(workflowNode ? { workflowNode } : {}),
      ...(resolvedInputs ? { inputs: resolvedInputs.values } : {}),
      ...(judgementCandidates
        ? { judgement: { candidates: judgementCandidates } }
        : {}),
      context: {
        ...(resolvedInputs?.values ??
          attemptContext({
            qualification,
            reproduction,
            plan,
            implementation,
            holisticSelection,
            review,
            ci,
          })),
        ...(previousExecutorOutcome
          ? { executorOutcome: previousExecutorOutcome }
          : {}),
      },
      ...(route ? { routing: route } : {}),
      ...(reviewer ? { reviewer } : {}),
      artifact: {
        repositoryId: artifactRepository.id,
        repository: artifactRepository.name,
        remote: artifactRepository.remote,
        hostname: artifactRepository.hostname,
        tokenId: token.id,
        token: token.plaintext,
        access: token.access,
        ref: attemptWorkspaceRef(attempt),
      },
      ...(attempt.stage === "integrate"
        ? {
            upstream: {
              remote: `https://github.com/${run.repository}.git`,
              hostname: "github.com",
              branch: run.githubDefaultBranch ?? "main",
            },
            integration: {
              candidateHead: run.reviewedHead ?? run.currentHead,
              ...(typeof conflictedOutcome?.baseHead === "string"
                ? { baseHead: conflictedOutcome.baseHead }
                : run.targetBaseHead
                  ? { baseHead: run.targetBaseHead }
                  : {}),
              ...(Array.isArray(conflictedOutcome?.conflicts)
                ? { conflicts: conflictedOutcome.conflicts }
                : {}),
            },
            ...(integrateEvidence
              ? {
                  context: {
                    ...(integrateEvidence.qualification
                      ? { qualification: integrateEvidence.qualification }
                      : {}),
                    ...(integrateEvidence.plan
                      ? { plan: integrateEvidence.plan }
                      : {}),
                    ...(integrateEvidence.implementation
                      ? { implementation: integrateEvidence.implementation }
                      : {}),
                    ...(integrateEvidence.review
                      ? { review: integrateEvidence.review }
                      : {}),
                  },
                }
              : {}),
          }
        : {}),
    };
    try {
      const backup =
        attempt.stage === "implement"
          ? await workspaceBackup(
              this.runs.database,
              attemptWorkspaceBackupKey(attempt),
            )
          : undefined;
      await sandbox.prepareAttempt(
        assignment,
        attemptSecret,
        this.env.CONTROL_PLANE_ORIGIN,
        backup,
      );
    } catch (error) {
      await artifactRepository.revokeToken(token.id);
      try {
        await destroyAttemptSandbox(
          this.env.ATTEMPT_SANDBOXES,
          sandboxName(attempt),
        );
      } catch (cleanupError) {
        console.error(
          JSON.stringify({
            message: "failed_dispatch_sandbox_cleanup_failed",
            attemptId: attempt.id,
            sandbox: sandboxName(attempt),
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          }),
        );
      }
      throw error;
    }
  }
}

export async function prepareAttemptExecution(
  env: AttemptPreparationEnv,
  attemptId: string,
): Promise<void> {
  const repository = new D1RunRepository(env.DB);
  const attempt = await repository.getAttempt(attemptId);
  const run = attempt && (await repository.get(attempt.runId));
  if (!attempt) throw new Error("attempt_not_found");
  if (
    !run ||
    run.status !== "active" ||
    run.revision !== attempt.runRevision ||
    !["created", "dispatched"].includes(attempt.state)
  )
    throw new Error("attempt_run_stale");
  await new SandboxAttemptPreparer(env, repository).prepare(attempt, run);
}
