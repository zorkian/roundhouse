// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  immutableAttemptId,
  isModelRoute,
  reviewerForRole,
  runSchemaVersion,
  type Attempt,
  type ModelRoute,
  type RunSnapshot,
  type Wakeup,
} from "@roundhouse/core";
import {
  CloudflareArtifactsNamespace,
  validateCheckpointIdentity,
  validateReadOnlyCheckpoint,
} from "./artifacts.js";
import {
  attemptInactivityMilliseconds,
  coordinate,
  type AttemptDispatcher,
} from "./coordinator.js";
import {
  acceptCallback,
  signCallback,
  verifyCallback,
  type AttemptCallback,
  type CheckpointValidator,
} from "./callback.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";
import { renderDashboard } from "./dashboard.js";
import { renderRunDetails } from "./run-details.js";
import { acceptGitHubCheckSuite, GitHubCiAutomation } from "./github-ci.js";
import {
  acceptGitHubComment,
  acceptGitHubIssueClosed,
  githubClientForRun,
  GitHubStageReporter,
  type GitHubEnv,
} from "./github.js";
import { observeResponse } from "@roundhouse/response-observer";
import { aggregatedReview } from "./aggregated-review.js";
import { getSandbox, type DirectoryBackup } from "@cloudflare/sandbox";
import { launch } from "@cloudflare/playwright";
import { RoundhouseAttemptSandbox } from "./attempt-container.js";
export { ContainerProxy } from "@cloudflare/sandbox";
export { RoundhouseAttemptSandbox } from "./attempt-container.js";
export { AttemptExecutionWorkflow } from "./attempt-workflow.js";

export const controlPlaneService = "roundhouse-v2-control-plane";

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function html(value: string): Response {
  return new Response(value, {
    headers: {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

export function handleRequest(request: Request): Response {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    if (request.method !== "GET")
      return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
    return json({
      schemaVersion: runSchemaVersion,
      ok: true,
      service: controlPlaneService,
    });
  }
  return json({ error: "not_found" }, 404);
}

export function sandboxPreviewPath(
  requestedUrl: URL,
  previewOrigin: string,
): string | undefined {
  if (
    requestedUrl.origin !== previewOrigin &&
    !["localhost", "127.0.0.1", "[::1]"].includes(requestedUrl.hostname)
  ) {
    return undefined;
  }
  return `${requestedUrl.pathname}${requestedUrl.search}`;
}

export function successorWakeup(
  run: RunSnapshot | undefined,
  processed: Wakeup,
): Wakeup | undefined {
  return run?.status === "active" &&
    new Set([
      "reproduce",
      "plan",
      "implement",
      "review",
      "integrate",
      "ci",
      "merge",
    ]).has(run.stage) &&
    run.revision === processed.expectedRevision + 1
    ? { runId: run.id, expectedRevision: run.revision }
    : undefined;
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

interface AttemptStub {
  destroy(): Promise<void>;
}
interface AttemptNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): AttemptStub;
}

type SandboxNamespace = DurableObjectNamespace<RoundhouseAttemptSandbox>;

function attemptSandbox(
  sandboxes: SandboxNamespace,
  name: string,
): RoundhouseAttemptSandbox {
  return getSandbox(sandboxes, name, { enableDefaultSession: false });
}

function sandboxName(attempt: Pick<Attempt, "id" | "runId" | "stage">): string {
  return attempt.stage === "implement" ? attempt.runId : attempt.id;
}

export async function destroyAttemptSandbox(
  containers: AttemptNamespace,
  name: string,
): Promise<void> {
  await containers.get(containers.idFromName(name)).destroy();
}

type SandboxDestructionTrace = (
  attemptId: string,
  phase: string,
  detail: Readonly<Record<string, unknown>>,
) => Promise<void>;

async function destroyAttemptSandboxWithTrace(
  containers: AttemptNamespace,
  name: string,
  attemptId: string,
  trace?: SandboxDestructionTrace,
): Promise<void> {
  const startedAt = Date.now();
  const emit = async (
    phase: string,
    detail: Readonly<Record<string, unknown>> = {},
  ): Promise<void> => {
    const payload = {
      phase,
      sandboxName: name,
      durationMs: Date.now() - startedAt,
      ...detail,
    };
    const log = { message: "sandbox_destruction_trace", attemptId, ...payload };
    if (phase.endsWith("_failed")) console.error(JSON.stringify(log));
    else console.log(JSON.stringify(log));
    if (!trace) return;
    try {
      await trace(attemptId, phase, payload);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "sandbox_destruction_trace_record_failed",
          attemptId,
          phase,
          sandboxName: name,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };
  await emit("sandbox_destroy_started");
  try {
    await destroyAttemptSandbox(containers, name);
    await emit("sandbox_destroy_completed");
  } catch (error) {
    await emit("sandbox_destroy_failed", {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function scheduleAttemptSandboxDestruction(
  containers: AttemptNamespace,
  name: string,
  context: Pick<ExecutionContext, "waitUntil">,
  attemptId = name,
  trace?: SandboxDestructionTrace,
): void {
  context.waitUntil(
    destroyAttemptSandboxWithTrace(containers, name, attemptId, trace),
  );
}

export async function recoverExpiredAttempts(
  containers: AttemptNamespace,
  wakeups: readonly Wakeup[],
  enqueue: (wakeup: Wakeup) => Promise<void>,
  diagnose?: (attemptId: string, wakeup: Wakeup) => Promise<void>,
  resolveName?: (attemptId: string) => Promise<string>,
  trace?: (
    attemptId: string,
    phase: string,
    detail: Record<string, unknown>,
  ) => Promise<void>,
): Promise<void> {
  for (const wakeup of wakeups) {
    const attemptId = immutableAttemptId(wakeup.runId, wakeup.expectedRevision);
    const recoveryStartedAt = Date.now();
    const emit = async (
      phase: string,
      detail: Record<string, unknown> = {},
    ): Promise<void> => {
      await trace?.(attemptId, phase, {
        runId: wakeup.runId,
        expectedRevision: wakeup.expectedRevision,
        elapsedMs: Date.now() - recoveryStartedAt,
        ...detail,
      });
    };
    try {
      await emit("recovery_started");
      if (diagnose) await diagnose(attemptId, wakeup);
      await emit("sandbox_name_resolution_started");
      const name = resolveName ? await resolveName(attemptId) : attemptId;
      await emit("sandbox_name_resolution_completed", { sandboxName: name });
      await emit("sandbox_destroy_started", { sandboxName: name });
      await destroyAttemptSandbox(containers, name);
      await emit("sandbox_destroy_completed", { sandboxName: name });
      await emit("wakeup_enqueue_started");
      await enqueue(wakeup);
      await emit("wakeup_enqueue_completed");
      await emit("recovery_completed");
    } catch (error) {
      await emit("recovery_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

const observedDevcontainerPhases = [
  "devcontainer_config_detection",
  "devcontainer_runtime_prepare",
  "devcontainer_state_read",
  "devcontainer_config_read",
  "devcontainer_runtime_config_refresh",
  "devcontainer_stale_container_remove",
  "devcontainer_image_digest_resolve",
  "devcontainer_runtime_config_write",
  "devcontainer_up_diagnostics",
  "devcontainer_result_parse",
  "devcontainer_runtime_mount_verify",
  "devcontainer_ca_verify",
  "devcontainer_lifecycle",
  "devcontainer_lifecycle_diagnostics",
  "devcontainer_state_write",
  "devcontainer_inner_assignment_write",
  "devcontainer_inner_result_read",
  "devcontainer_inner_runtime_cleanup",
] as const;

const progressPhases = new Set([
  "workspace_started",
  "workspace_ready",
  "devcontainer_image_pull_started",
  "devcontainer_image_pull_completed",
  "devcontainer_image_pull_failed",
  "devcontainer_up_started",
  "devcontainer_up_completed",
  "devcontainer_up_failed",
  "devcontainer_agent_started",
  "devcontainer_agent_completed",
  "devcontainer_agent_failed",
  "agent_started",
  "agent_tool_started",
  "agent_tool_completed",
  "agent_tool_failed",
  "agent_session_completed",
  "command_started",
  "command_output",
  "command_completed",
  "command_failed",
  "agent_completed",
  "checkpoint_started",
  "checkpoint_completed",
  "callback_started",
  "callback_completed",
  ...observedDevcontainerPhases.flatMap((phase) => [
    `${phase}_started`,
    `${phase}_completed`,
    `${phase}_failed`,
  ]),
]);

export function validAttemptProgress(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const progress = value as Record<string, unknown>;
  const allowed = new Set([
    "phase",
    "operation",
    "durationMs",
    "stdoutBytes",
    "stderrBytes",
    "exitCode",
    "errorType",
    "detail",
    "changedPathCount",
    "status",
    "toolCallId",
    "input",
    "output",
    "stage",
  ]);
  if (Object.keys(progress).some((key) => !allowed.has(key))) return false;
  if (typeof progress.phase !== "string" || !progressPhases.has(progress.phase))
    return false;
  const agentPhase =
    progress.phase.startsWith("agent_tool_") ||
    progress.phase === "agent_session_completed";
  if (
    !agentPhase &&
    ["toolCallId", "input", "output", "stage"].some(
      (key) => progress[key] !== undefined,
    )
  )
    return false;
  for (const key of [
    "operation",
    "errorType",
    "toolCallId",
    "stage",
  ] as const) {
    const field = progress[key];
    if (
      field !== undefined &&
      (typeof field !== "string" || field.length > 100)
    )
      return false;
  }
  for (const key of ["detail", "input", "output"] as const) {
    const field = progress[key];
    if (
      field !== undefined &&
      (typeof field !== "string" || field.length > 4_000)
    )
      return false;
  }
  for (const key of [
    "durationMs",
    "stdoutBytes",
    "stderrBytes",
    "changedPathCount",
    "status",
  ] as const) {
    const field = progress[key];
    if (
      field !== undefined &&
      (typeof field !== "number" || !Number.isInteger(field) || field < 0)
    )
      return false;
  }
  const exitCode = progress.exitCode;
  return (
    exitCode === undefined ||
    (typeof exitCode === "number" && Number.isInteger(exitCode))
  );
}
type RuntimeEnv = Cloudflare.Env & {
  DB: D1Like;
  BROWSER: Fetcher;
  BACKUP_BUCKET: R2Bucket;
  CALLBACK_SIGNING_SECRET: string;
  GITHUB_APP_ID: string;
  ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY: string;
  ROUNDHOUSE_GITHUB_WEBHOOK_SECRET: string;
};

async function workspaceBackup(
  db: D1Like,
  runId: string,
): Promise<DirectoryBackup | undefined> {
  const row = await db
    .prepare(
      "SELECT backup_json FROM implementation_workspaces WHERE run_id = ?",
    )
    .bind(runId)
    .first<{ backup_json: string }>();
  return row ? (JSON.parse(row.backup_json) as DirectoryBackup) : undefined;
}

async function saveWorkspaceBackup(
  db: D1Like,
  runId: string,
  attemptId: string,
  backup: DirectoryBackup,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO implementation_workspaces (run_id, attempt_id, backup_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         attempt_id = excluded.attempt_id,
         backup_json = excluded.backup_json,
         updated_at = excluded.updated_at`,
    )
    .bind(runId, attemptId, JSON.stringify(backup), Date.now())
    .run();
}

function artifactsNamespace(env: RuntimeEnv) {
  return new CloudflareArtifactsNamespace(env.ARTIFACTS, {
    namespace: env.ARTIFACTS_NAMESPACE,
    remoteOrigin: env.ARTIFACTS_REMOTE_ORIGIN,
  });
}

function workspaceName(runId: string): string {
  return runId;
}
function workspaceRef(runId: string): string {
  return `refs/heads/roundhouse/${runId}`;
}
export function githubBranch(issueNumber: number): string {
  return `roundhouse/issue-${issueNumber}`;
}

// The conflict details a conflict-resolution or integration-delta review
// needs may live several revisions back (for example after a failed delta
// review), so scan revisions until the conflicted integration is found.
async function conflictedIntegrationOutcome(
  runs: D1RunRepository,
  run: RunSnapshot,
): Promise<Record<string, unknown> | undefined> {
  const latest = await runs.latestCompletedAttempt(
    run.id,
    "integrate",
    run.revision,
  );
  const latestOutcome = latest?.result?.integration as
    Record<string, unknown> | undefined;
  if (latestOutcome?.status === "conflict") return latestOutcome;
  for (let revision = run.revision - 1; revision >= 1; revision -= 1) {
    const attempts = await runs.attemptsForRevision(run.id, revision);
    for (const attempt of attempts) {
      const outcome = attempt.result?.integration as
        Record<string, unknown> | undefined;
      if (
        attempt.stage === "integrate" &&
        attempt.state === "completed" &&
        outcome?.status === "conflict"
      )
        return outcome;
    }
  }
  return undefined;
}

export function artifactNeedsSync(
  artifact: { readonly empty: boolean; readonly head?: string },
  attempt: Pick<Attempt, "stage">,
  run: Pick<RunSnapshot, "baseCommit" | "currentHead" | "candidateHead">,
): boolean {
  return (
    artifact.empty ||
    (attempt.stage === "implement" &&
      run.currentHead === run.baseCommit &&
      !run.candidateHead &&
      artifact.head !== run.currentHead)
  );
}

class SandboxDispatcher implements AttemptDispatcher {
  constructor(
    private readonly containers: SandboxNamespace,
    private readonly artifacts: CloudflareArtifactsNamespace,
    private readonly callbackSigningSecret: string,
    private readonly controlPlaneOrigin: string,
    private readonly runs: D1RunRepository,
    private readonly modelBroker: Fetcher,
    private readonly attemptExecutions: Workflow<{
      readonly attemptId: string;
      readonly sandboxName: string;
    }>,
  ) {}

  private async resolveModelRoute(
    attempt: Attempt,
    taskType: string,
  ): Promise<ModelRoute> {
    const response = await observeResponse(
      await this.modelBroker.fetch(
        new Request("https://broker.roundhouse.internal/route", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            role: attempt.role,
            taskType,
            complexity: "unknown",
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
    await this.runs.recordModelRouting(attempt.id, route);
    return route;
  }

  async submit(attempt: Attempt, run: RunSnapshot): Promise<void> {
    const taskType =
      attempt.stage === "plan"
        ? "planning"
        : attempt.stage === "implement" ||
            attempt.role === "conflict-resolution"
          ? "implementation"
          : attempt.stage === "review" || attempt.role === "review-integration"
            ? "review"
            : "validation";
    // Mechanical integration is a no-model operation; only conflict
    // resolution routes to an implementation model.
    const route =
      attempt.role === "integrate"
        ? undefined
        : await this.resolveModelRoute(attempt, taskType);
    const repository = await this.artifacts.ensure(
      workspaceName(attempt.runId),
    );
    // Recovery invalidates every token from an interrupted container before a
    // replacement receives a fresh, short-lived credential.
    await repository.revokeActiveTokens();
    const sandbox = attemptSandbox(this.containers, sandboxName(attempt));
    const attemptSecret = await signCallback(
      this.callbackSigningSecret,
      attempt.id,
    );
    const syncArtifact = artifactNeedsSync(repository, attempt, run);
    if (syncArtifact) {
      const syncStartedAt = Date.now();
      const syncDetail = {
        phase: "artifact_sync_started",
        artifactHead: repository.head ?? null,
        sourceHead: run.currentHead,
        force: !repository.empty,
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
      const bootstrapToken = await repository.createToken("write", 30 * 60);
      try {
        const status = await sandbox.runAttempt(
          "/bootstrap",
          {
            ...attempt,
            artifact: {
              repositoryId: repository.id,
              repository: repository.name,
              remote: repository.remote,
              hostname: repository.hostname,
              tokenId: bootstrapToken.id,
              token: bootstrapToken.plaintext,
              access: bootstrapToken.access,
            },
            source: {
              remote: `https://github.com/${run.repository}.git`,
              hostname: "github.com",
              branch: run.githubDefaultBranch ?? "main",
              head: run.currentHead,
              force: !repository.empty,
            },
          },
          attemptSecret,
        );
        if (status !== 204) throw new Error("sandbox_bootstrap_failed");
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
        await repository.revokeToken(bootstrapToken.id);
        throw error;
      }
      await repository.revokeToken(bootstrapToken.id);
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
    const access =
      ["implement", "integrate"].includes(attempt.stage) &&
      attempt.role !== "review-integration"
        ? "write"
        : "read";
    const token = await repository.createToken(access, 30 * 60);
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
    const review = reviewAttempt ? aggregatedReview(reviewAttempts) : undefined;
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
    const reviewer = reviewerForRole(attempt.role);
    const sameRevisionReviews =
      attempt.stage === "review"
        ? await this.runs.attemptsForRevision(run.id, run.revision)
        : [];
    const holisticSelection = sameRevisionReviews.find(
      (candidate) => candidate.role === "review-holistic",
    )?.result?.review;
    if (attempt.stage === "reproduce" && !qualification)
      throw new Error("reproduction_qualification_missing");
    if (attempt.stage === "plan" && !reproduction)
      throw new Error("planning_reproduction_missing");
    if (attempt.stage === "implement" && !plan)
      throw new Error("implementation_plan_missing");
    if (attempt.stage === "review" && !implementation)
      throw new Error("review_implementation_missing");
    const assignment = {
      ...attempt,
      baseCommit: attempt.baseCommit,
      profile: run.profile,
      issue: run.issue,
      issueNumber: run.issueNumber,
      context: attemptContext({
        qualification,
        reproduction,
        plan,
        implementation,
        holisticSelection,
        review,
        ci,
      }),
      ...(route ? { routing: route } : {}),
      ...(reviewer ? { reviewer } : {}),
      artifact: {
        repositoryId: repository.id,
        repository: repository.name,
        remote: repository.remote,
        hostname: repository.hostname,
        tokenId: token.id,
        token: token.plaintext,
        access: token.access,
        ref: workspaceRef(attempt.runId),
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
          ? await workspaceBackup(this.runs.database, run.id)
          : undefined;
      await sandbox.prepareAttempt(
        assignment,
        attemptSecret,
        new URL("/attempts/callback", this.controlPlaneOrigin).toString(),
        backup,
      );
      const workflowInstanceId = `${attempt.id}-${attempt.deadlineAt}`;
      const instances = await this.attemptExecutions.createBatch([
        {
          id: workflowInstanceId,
          params: {
            attemptId: attempt.id,
            sandboxName: sandboxName(attempt),
          },
        },
      ]);
      await this.runs.recordAttemptEvent(attempt.id, "attempt_workflow", {
        phase: "attempt_workflow_created",
        workflowInstanceId,
        created: instances.length === 1,
      });
    } catch (error) {
      await repository.revokeToken(token.id);
      try {
        await destroyAttemptSandbox(this.containers, sandboxName(attempt));
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

class SandboxCheckpointValidator implements CheckpointValidator {
  constructor(
    private readonly containers: SandboxNamespace,
    private readonly artifacts: CloudflareArtifactsNamespace,
    private readonly repository: D1RunRepository,
    private readonly githubEnv: GitHubEnv,
  ) {}

  async validate(input: AttemptCallback): Promise<void> {
    const attempt = await this.repository.getAttempt(input.attemptId);
    const run = attempt && (await this.repository.get(attempt.runId));
    if (!attempt || !run) throw new Error("attempt_not_found");
    const artifact = await this.artifacts.get(input.checkpoint.repository);
    if (!artifact) throw new Error("artifact_repository_not_found");
    validateCheckpointIdentity(input.checkpoint, {
      repositoryId: artifact.id,
      repository: workspaceName(run.id),
      baseCommit: run.baseCommit,
      inputHead: attempt.expectedHead,
      ref: workspaceRef(run.id),
      profile:
        run.profile ??
        (() => {
          throw new Error("run_profile_missing");
        })(),
    });
    if (
      !["implement", "integrate"].includes(attempt.stage) ||
      attempt.role === "review-integration"
    ) {
      try {
        validateReadOnlyCheckpoint(input.checkpoint);
      } finally {
        await artifact.revokeToken(input.artifactTokenId);
      }
      return;
    }
    const conflicted =
      attempt.role === "conflict-resolution"
        ? await conflictedIntegrationOutcome(this.repository, run)
        : undefined;
    const token = await artifact.createToken("read", 5 * 60);
    try {
      const status = await attemptSandbox(
        this.containers,
        `${attempt.id}-validation`,
      ).validateCheckpoint({
        ...attempt,
        baseCommit: run.baseCommit,
        profile: run.profile,
        checkpoint: input.checkpoint,
        ...(conflicted
          ? {
              integration: {
                ...(typeof conflicted.baseHead === "string"
                  ? { baseHead: conflicted.baseHead }
                  : {}),
                ...(Array.isArray(conflicted.conflicts)
                  ? { conflicts: conflicted.conflicts }
                  : {}),
              },
            }
          : {}),
        artifact: {
          repositoryId: artifact.id,
          repository: artifact.name,
          remote: artifact.remote,
          hostname: artifact.hostname,
          tokenId: token.id,
          token: token.plaintext,
          access: token.access,
          ref: input.checkpoint.ref,
        },
        ...(input.checkpoint.outputHead !== input.checkpoint.inputHead
          ? {
              publish: {
                remote: `https://github.com/${run.repository}.git`,
                hostname: "github.com",
                token: await githubClientForRun(
                  this.githubEnv,
                  run,
                ).installationToken(),
                ref: `refs/heads/${githubBranch(run.issueNumber)}`,
              },
            }
          : {}),
      });
      if (status < 200 || status >= 300)
        throw new Error("checkpoint_git_validation_failed");
    } finally {
      await Promise.all([
        artifact.revokeToken(token.id),
        artifact.revokeToken(input.artifactTokenId),
        destroyAttemptSandbox(this.containers, `${attempt.id}-validation`),
      ]);
    }
    if (attempt.stage === "implement") {
      const backup = await attemptSandbox(
        this.containers,
        sandboxName(attempt),
      ).backupWorkspace(attempt.id, attempt.runId);
      await saveWorkspaceBackup(
        this.repository.database,
        attempt.runId,
        attempt.id,
        backup,
      );
    }
  }
}

const worker: ExportedHandler<RuntimeEnv, Wakeup> = {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    const isPublicUiRequest = () =>
      url.hostname === new URL(env.PUBLIC_ORIGIN).hostname;
    const isPublicScreenshotRequest = () =>
      url.hostname === new URL(env.CONTROL_PLANE_ORIGIN).hostname;
    const screenshotMatch = url.pathname.match(/^\/screenshots\/([^/]+)$/);
    if (screenshotMatch && isPublicScreenshotRequest()) {
      if (request.method !== "GET")
        return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      const screenshot = await env.BACKUP_BUCKET.get(
        `screenshots/${screenshotMatch[1]}.png`,
      );
      if (!screenshot) return json({ error: "not_found" }, 404);
      return new Response(screenshot.body, {
        headers: {
          "cache-control": "no-store",
          "content-type": "image/png",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (
      (url.pathname === "/" || url.pathname === "/runs") &&
      isPublicUiRequest()
    ) {
      if (request.method !== "GET")
        return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      const runs = await new D1RunRepository(env.DB).listRuns();
      return html(renderDashboard(runs));
    }
    const detailsMatch = url.pathname.match(
      /^\/repositories\/([^/]+)\/([^/]+)\/issues\/(\d+)$/,
    );
    if (detailsMatch && isPublicUiRequest()) {
      if (request.method !== "GET")
        return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      let repository: string;
      const owner = detailsMatch[1];
      const name = detailsMatch[2];
      const issueNumber = detailsMatch[3];
      if (!owner || !name || !issueNumber)
        return json({ error: "not_found" }, 404);
      try {
        repository = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
      } catch {
        return json({ error: "not_found" }, 404);
      }
      const details = await new D1RunRepository(env.DB).detailsByIssue(
        repository,
        Number(issueNumber),
      );
      if (!details) return json({ error: "not_found" }, 404);
      return html(renderRunDetails(details));
    }
    if (url.pathname === "/attempts/activity") {
      if (request.method !== "POST")
        return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
      const attemptId = request.headers.get("x-roundhouse-attempt-id") ?? "";
      const capability =
        request.headers.get("x-roundhouse-attempt-capability") ?? "";
      if (
        !attemptId ||
        !capability ||
        !(await verifyCallback(
          env.CALLBACK_SIGNING_SECRET,
          attemptId,
          capability,
        ))
      )
        return json({ error: "unauthorized" }, 401);
      let progress: Readonly<Record<string, unknown>> | undefined;
      if (request.body) {
        try {
          const candidate: unknown = await request.json();
          if (!validAttemptProgress(candidate))
            return json({ error: "invalid_progress" }, 400);
          progress = candidate;
        } catch {
          return json({ error: "invalid_progress" }, 400);
        }
      }
      const recorded = await new D1RunRepository(env.DB).recordActivity(
        attemptId,
        Date.now() + attemptInactivityMilliseconds,
        progress,
      );
      return recorded
        ? new Response(null, { status: 204 })
        : json({ error: "stale_attempt" }, 409);
    }
    if (url.pathname === "/attempts/artifact-token") {
      if (request.method !== "POST")
        return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
      const attemptId = request.headers.get("x-roundhouse-attempt-id") ?? "";
      const capability =
        request.headers.get("x-roundhouse-attempt-capability") ?? "";
      if (
        !attemptId ||
        !capability ||
        !(await verifyCallback(
          env.CALLBACK_SIGNING_SECRET,
          attemptId,
          capability,
        ))
      )
        return json({ error: "unauthorized" }, 401);
      let artifactTokenId: string;
      try {
        const body: unknown = await request.json();
        artifactTokenId =
          body &&
          typeof body === "object" &&
          "artifactTokenId" in body &&
          typeof body.artifactTokenId === "string"
            ? body.artifactTokenId
            : "";
      } catch {
        return json({ error: "invalid_request" }, 400);
      }
      if (!artifactTokenId) return json({ error: "invalid_request" }, 400);
      const repository = new D1RunRepository(env.DB);
      const attempt = await repository.getAttempt(attemptId);
      if (
        !attempt ||
        !["implement", "integrate"].includes(attempt.stage) ||
        attempt.role === "review-integration" ||
        !["created", "dispatched"].includes(attempt.state) ||
        attempt.deadlineAt <= Date.now()
      )
        return json({ error: "stale_attempt" }, 409);
      const run = await repository.get(attempt.runId);
      if (!run) return json({ error: "stale_attempt" }, 409);
      const artifact = await artifactsNamespace(env).get(workspaceName(run.id));
      if (!artifact) return json({ error: "artifact_not_found" }, 404);
      try {
        await artifact.revokeToken(artifactTokenId);
      } catch (error) {
        console.warn(
          JSON.stringify({
            message: "expired_artifact_token_revoke_failed",
            attemptId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      const token = await artifact.createToken("write", 5 * 60);
      await repository.recordActivity(
        attemptId,
        Date.now() + attemptInactivityMilliseconds,
      );
      return json(
        { tokenId: token.id, token: token.plaintext, access: token.access },
        200,
        { "cache-control": "no-store" },
      );
    }
    if (url.pathname === "/attempts/screenshots") {
      const screenshotStartedAt = Date.now();
      if (request.method !== "POST")
        return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
      const attemptId = request.headers.get("x-roundhouse-attempt-id") ?? "";
      const capability =
        request.headers.get("x-roundhouse-attempt-capability") ?? "";
      if (
        !attemptId ||
        !capability ||
        !(await verifyCallback(
          env.CALLBACK_SIGNING_SECRET,
          attemptId,
          capability,
        ))
      )
        return json({ error: "unauthorized" }, 401);
      const repository = new D1RunRepository(env.DB);
      const attempt = await repository.getAttempt(attemptId);
      if (
        !attempt ||
        !["reproduce", "implement"].includes(attempt.stage) ||
        !["created", "dispatched"].includes(attempt.state) ||
        attempt.deadlineAt <= Date.now()
      )
        return json({ error: "stale_attempt" }, 409);
      let input: {
        port: number;
        path: string;
        width: number;
        height: number;
        sourceHead: string;
        sourceTree: string;
      };
      try {
        const body = await request.json<Partial<typeof input>>();
        input = {
          port: Number(body.port),
          path: typeof body.path === "string" ? body.path : "/",
          width: Number(body.width ?? 1440),
          height: Number(body.height ?? 900),
          sourceHead:
            typeof body.sourceHead === "string" ? body.sourceHead : "",
          sourceTree:
            typeof body.sourceTree === "string" ? body.sourceTree : "",
        };
      } catch {
        return json({ error: "invalid_request" }, 400);
      }
      if (
        !Number.isInteger(input.port) ||
        input.port < 1 ||
        input.port > 65_535 ||
        !input.path.startsWith("/") ||
        input.path.startsWith("//") ||
        !Number.isInteger(input.width) ||
        input.width < 320 ||
        input.width > 2560 ||
        !Number.isInteger(input.height) ||
        input.height < 240 ||
        input.height > 1600 ||
        !/^[a-f0-9]{40,64}$/.test(input.sourceHead) ||
        !/^[a-f0-9]{40,64}$/.test(input.sourceTree)
      )
        return json({ error: "invalid_request" }, 400);
      const sandbox = attemptSandbox(
        env.ATTEMPT_SANDBOXES,
        sandboxName(attempt),
      );
      const traceScreenshot = async (
        phase: string,
        startedAt?: number,
        detail: Readonly<Record<string, unknown>> = {},
      ): Promise<void> => {
        const payload = {
          phase,
          ...(startedAt === undefined
            ? {}
            : { durationMs: Date.now() - startedAt }),
          ...detail,
        };
        console.log(
          JSON.stringify({
            message: "screenshot_trace",
            attemptId,
            ...payload,
          }),
        );
        try {
          await repository.recordAttemptEvent(
            attemptId,
            "screenshot_trace",
            payload,
          );
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "screenshot_trace_record_failed",
              attemptId,
              phase,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      };
      await traceScreenshot("screenshot_request_accepted", undefined, {
        port: input.port,
        path: input.path,
        width: input.width,
        height: input.height,
      });
      let browser: Awaited<ReturnType<typeof launch>>;
      let stepStartedAt = Date.now();
      await traceScreenshot("browser_launch_started");
      try {
        browser = await launch(env.BROWSER);
        await traceScreenshot("browser_launch_completed", stepStartedAt);
      } catch (error) {
        await traceScreenshot("browser_launch_failed", stepStartedAt, {
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      try {
        stepStartedAt = Date.now();
        await traceScreenshot("browser_page_creation_started");
        const page = await browser.newPage({
          viewport: { width: input.width, height: input.height },
        });
        await traceScreenshot("browser_page_creation_completed", stepStartedAt);
        type PageRoute = Parameters<Parameters<typeof page.route>[1]>[0];
        const previewOrigin = "https://preview.roundhouse.invalid";
        stepStartedAt = Date.now();
        await traceScreenshot("browser_route_registration_started");
        await page.route("**/*", async (route: PageRoute) => {
          const routeStartedAt = Date.now();
          const browserRequest = route.request();
          const requestedUrl = new URL(browserRequest.url());
          await traceScreenshot("browser_route_request_started", undefined, {
            method: browserRequest.method(),
            origin: requestedUrl.origin,
            path: requestedUrl.pathname,
          });
          const previewPath = sandboxPreviewPath(requestedUrl, previewOrigin);
          if (!previewPath) {
            await route.abort("blockedbyclient");
            await traceScreenshot(
              "browser_route_request_blocked",
              routeStartedAt,
              {
                method: browserRequest.method(),
                origin: requestedUrl.origin,
                path: requestedUrl.pathname,
              },
            );
            return;
          }
          if (requestedUrl.origin !== previewOrigin) {
            await traceScreenshot(
              "browser_route_request_rewritten",
              routeStartedAt,
              {
                method: browserRequest.method(),
                origin: requestedUrl.origin,
                path: requestedUrl.pathname,
                targetPort: input.port,
              },
            );
          }
          const headers = new Headers(browserRequest.headers());
          headers.delete("host");
          headers.delete("content-length");
          headers.delete("accept-encoding");
          const postData = browserRequest.postDataBuffer();
          const previewResponse = await sandbox.fetchPreview(
            attemptId,
            new URL(previewPath, "http://localhost").toString(),
            input.port,
            {
              method: browserRequest.method(),
              headers,
              ...(postData ? { body: postData } : {}),
            },
          );
          const responseHeaders = Object.fromEntries(
            previewResponse.headers.filter(
              ([name]) =>
                !["content-length", "content-encoding"].includes(
                  name.toLowerCase(),
                ),
            ),
          );
          await route.fulfill({
            status: previewResponse.status,
            headers: responseHeaders,
            body: Buffer.from(previewResponse.body),
          });
          await traceScreenshot(
            "browser_route_request_completed",
            routeStartedAt,
            {
              method: browserRequest.method(),
              path: requestedUrl.pathname,
              status: previewResponse.status,
              bodyBytes: previewResponse.body.byteLength,
            },
          );
        });
        await traceScreenshot(
          "browser_route_registration_completed",
          stepStartedAt,
        );
        stepStartedAt = Date.now();
        await traceScreenshot("browser_navigation_started", undefined, {
          path: input.path,
        });
        const navigation = await page.goto(
          new URL(input.path, previewOrigin).toString(),
          { waitUntil: "load" },
        );
        await traceScreenshot("browser_navigation_completed", stepStartedAt, {
          path: input.path,
          status: navigation?.status() ?? null,
          ok: navigation?.ok() ?? false,
        });
        if (!navigation?.ok()) {
          await traceScreenshot(
            "screenshot_request_failed",
            screenshotStartedAt,
            {
              reason: "preview_request_failed",
              status: navigation?.status() ?? 502,
            },
          );
          return json(
            {
              error: "preview_request_failed",
              status: navigation?.status() ?? 502,
            },
            422,
          );
        }
        stepStartedAt = Date.now();
        await traceScreenshot("browser_screenshot_started");
        const png = await page.screenshot({ type: "png", fullPage: true });
        await traceScreenshot("browser_screenshot_completed", stepStartedAt, {
          bodyBytes: png.byteLength,
        });
        const id = crypto.randomUUID();
        const objectKey = `screenshots/${id}.png`;
        stepStartedAt = Date.now();
        await traceScreenshot("screenshot_object_write_started", undefined, {
          screenshotId: id,
          objectKey,
        });
        await env.BACKUP_BUCKET.put(objectKey, png, {
          httpMetadata: { contentType: "image/png" },
        });
        await traceScreenshot(
          "screenshot_object_write_completed",
          stepStartedAt,
          { screenshotId: id, objectKey, bodyBytes: png.byteLength },
        );
        stepStartedAt = Date.now();
        await traceScreenshot("screenshot_record_write_started", undefined, {
          screenshotId: id,
        });
        await env.DB.prepare(
          `INSERT INTO implementation_screenshots
              (id, run_id, attempt_id, source_head, source_tree, object_key, route, port, width, height, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            id,
            attempt.runId,
            attempt.id,
            input.sourceHead,
            input.sourceTree,
            objectKey,
            input.path,
            input.port,
            input.width,
            input.height,
            Date.now(),
          )
          .run();
        await traceScreenshot(
          "screenshot_record_write_completed",
          stepStartedAt,
          { screenshotId: id },
        );
        stepStartedAt = Date.now();
        await traceScreenshot("screenshot_activity_update_started", undefined, {
          screenshotId: id,
        });
        await repository.recordActivity(
          attemptId,
          Date.now() + attemptInactivityMilliseconds,
        );
        await traceScreenshot(
          "screenshot_activity_update_completed",
          stepStartedAt,
          { screenshotId: id },
        );
        await traceScreenshot(
          "screenshot_request_completed",
          screenshotStartedAt,
          {
            screenshotId: id,
            width: input.width,
            height: input.height,
          },
        );
        return json({
          id,
          sourceHead: input.sourceHead,
          sourceTree: input.sourceTree,
          url: new URL(
            `/screenshots/${id}`,
            env.CONTROL_PLANE_ORIGIN,
          ).toString(),
        });
      } catch (error) {
        await traceScreenshot(
          "screenshot_request_failed",
          screenshotStartedAt,
          {
            errorType:
              error instanceof Error ? error.constructor.name : typeof error,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        throw error;
      } finally {
        const closeStartedAt = Date.now();
        await traceScreenshot("browser_close_started");
        try {
          await browser.close();
          await traceScreenshot("browser_close_completed", closeStartedAt);
        } catch (error) {
          await traceScreenshot("browser_close_failed", closeStartedAt, {
            errorType:
              error instanceof Error ? error.constructor.name : typeof error,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    if (url.pathname === "/github/webhook" && request.method === "POST") {
      const repository = new D1RunRepository(env.DB);
      const enqueue = async (wakeup: Wakeup) => {
        await env.RUN_WAKEUPS.send(wakeup);
      };
      const event = request.headers.get("x-github-event");
      let outcome: string;
      if (event === "check_suite")
        outcome = await acceptGitHubCheckSuite(
          request,
          env,
          repository,
          enqueue,
        );
      else if (event === "issues") {
        const closure = await acceptGitHubIssueClosed(request, env, repository);
        outcome = closure.outcome;
        if (closure.attemptId) {
          const attempt = await repository.getAttempt(closure.attemptId);
          scheduleAttemptSandboxDestruction(
            env.ATTEMPT_SANDBOXES,
            attempt ? sandboxName(attempt) : closure.attemptId,
            context,
            closure.attemptId,
            async (attemptId, phase, detail) => {
              await repository.recordAttemptEvent(attemptId, "sandbox_trace", {
                phase,
                ...detail,
              });
            },
          );
        }
      } else
        outcome = await acceptGitHubComment(
          request,
          env,
          repository,
          enqueue,
          undefined,
          env.PUBLIC_ORIGIN,
        );
      return json(
        { outcome },
        outcome === "unauthorized" ? 401 : outcome === "ignored" ? 202 : 202,
      );
    }
    if (url.pathname === "/attempts/callback" && request.method === "POST") {
      const input = await request.json<AttemptCallback>();
      const repository = new D1RunRepository(env.DB);
      const artifacts = artifactsNamespace(env);
      const outcome = await acceptCallback(
        repository,
        await signCallback(env.CALLBACK_SIGNING_SECRET, input.attemptId),
        new SandboxCheckpointValidator(
          env.ATTEMPT_SANDBOXES,
          artifacts,
          repository,
          env,
        ),
        input,
      );
      if (outcome === "completed" || outcome === "duplicate") {
        const attempt = await repository.getAttempt(input.attemptId);
        if (attempt) {
          await env.RUN_WAKEUPS.send({
            runId: attempt.runId,
            expectedRevision: attempt.runRevision,
          });
          scheduleAttemptSandboxDestruction(
            env.ATTEMPT_SANDBOXES,
            sandboxName(attempt),
            context,
            attempt.id,
            async (attemptId, phase, detail) => {
              await repository.recordAttemptEvent(attemptId, "sandbox_trace", {
                phase,
                ...detail,
              });
            },
          );
        }
      }
      return json(
        { outcome },
        outcome === "unauthorized" ? 401 : outcome === "stale" ? 409 : 202,
      );
    }
    return handleRequest(request);
  },
  async queue(batch, env) {
    const repository = new D1RunRepository(env.DB);
    const dispatcher = new SandboxDispatcher(
      env.ATTEMPT_SANDBOXES,
      artifactsNamespace(env),
      env.CALLBACK_SIGNING_SECRET,
      env.CONTROL_PLANE_ORIGIN,
      repository,
      env.MODEL_BROKER,
      env.ATTEMPT_EXECUTIONS,
    );
    for (const message of batch.messages) {
      try {
        const run = await repository.get(message.body.runId);
        if (!run) throw new Error("run_not_found");
        const github = githubClientForRun(env, run);
        const automation = new GitHubCiAutomation(repository, github);
        const reporter = new GitHubStageReporter(github, env.PUBLIC_ORIGIN);
        if (run?.status === "active" && run.stage === "ci")
          await automation.reconcileCi(run);
        if (run?.status === "active" && run.stage === "merge")
          await automation.merge(run);
        await coordinate(
          repository,
          dispatcher,
          message.body,
          Date.now(),
          30 * 60_000,
          reporter,
        );
        const next = successorWakeup(
          await repository.get(message.body.runId),
          message.body,
        );
        if (next) await env.RUN_WAKEUPS.send(next);
        message.ack();
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "coordination_failed",
            runId: message.body.runId,
            expectedRevision: message.body.expectedRevision,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        message.retry();
      }
    }
  },
  async scheduled(_controller, env) {
    const repository = new D1RunRepository(env.DB);
    const expiredAt = Date.now();
    await recoverExpiredAttempts(
      env.ATTEMPT_SANDBOXES,
      await repository.expiredLeases(expiredAt),
      async (wakeup) => {
        await env.RUN_WAKEUPS.send(wakeup);
      },
      async (attemptId, wakeup) => {
        try {
          const snapshot =
            await repository.attemptDiagnosticSnapshot(attemptId);
          const payload = {
            expectedRevision: wakeup.expectedRevision,
            expiredAt,
            ...(snapshot ?? {}),
          };
          console.error(
            JSON.stringify({
              message: "attempt_lease_expired",
              attemptId,
              runId: wakeup.runId,
              ...payload,
            }),
          );
          await repository.recordAttemptEvent(
            attemptId,
            "attempt_lease_expired",
            payload,
          );
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "attempt_expiry_diagnostic_failed",
              attemptId,
              runId: wakeup.runId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      },
      async (attemptId) => {
        const attempt = await repository.getAttempt(attemptId);
        return attempt ? sandboxName(attempt) : attemptId;
      },
      async (attemptId, phase, detail) => {
        const payload = { phase, ...detail };
        console.log(
          JSON.stringify({
            message: "attempt_recovery_trace",
            attemptId,
            ...payload,
          }),
        );
        try {
          await repository.recordAttemptEvent(
            attemptId,
            "attempt_recovery_trace",
            payload,
          );
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "attempt_recovery_trace_persist_failed",
              attemptId,
              phase,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      },
    );
  },
};

export default worker;
