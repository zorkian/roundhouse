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
  GitHubClient,
  GitHubStageReporter,
} from "./github.js";
import { observeResponse } from "@roundhouse/response-observer";
import { aggregatedReview } from "./aggregated-review.js";
export { ContainerProxy } from "@cloudflare/containers";
export { RoundhouseAttemptContainer } from "./attempt-container.js";

export const controlPlaneService = "roundhouse-v2-control-plane";
const protectedPaths = [".github/workflows"] as const;

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

export function successorWakeup(
  run: RunSnapshot | undefined,
  processed: Wakeup,
): Wakeup | undefined {
  return run?.status === "active" &&
    new Set(["reproduce", "plan", "implement", "review", "ci", "merge"]).has(
      run.stage,
    ) &&
    run.revision === processed.expectedRevision + 1
    ? { runId: run.id, expectedRevision: run.revision }
    : undefined;
}

interface AttemptStub {
  destroy(): Promise<void>;
  fetch(request: Request): Promise<Response>;
}
interface AttemptNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): AttemptStub;
}

export async function destroyAttemptContainer(
  containers: AttemptNamespace,
  attemptId: string,
): Promise<void> {
  await containers.get(containers.idFromName(attemptId)).destroy();
}

export function scheduleAttemptContainerDestruction(
  containers: AttemptNamespace,
  attemptId: string,
  context: Pick<ExecutionContext, "waitUntil">,
): void {
  context.waitUntil(destroyAttemptContainer(containers, attemptId));
}

export async function recoverExpiredAttempts(
  containers: AttemptNamespace,
  wakeups: readonly Wakeup[],
  enqueue: (wakeup: Wakeup) => Promise<void>,
  diagnose?: (attemptId: string, wakeup: Wakeup) => Promise<void>,
): Promise<void> {
  for (const wakeup of wakeups) {
    const attemptId = immutableAttemptId(wakeup.runId, wakeup.expectedRevision);
    if (diagnose) await diagnose(attemptId, wakeup);
    await destroyAttemptContainer(containers, attemptId);
    await enqueue(wakeup);
  }
}

const progressPhases = new Set([
  "workspace_started",
  "workspace_ready",
  "agent_started",
  "command_started",
  "command_output",
  "command_completed",
  "command_failed",
  "agent_completed",
  "checkpoint_started",
  "checkpoint_completed",
  "callback_started",
  "callback_completed",
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
    "changedPathCount",
    "status",
  ]);
  if (Object.keys(progress).some((key) => !allowed.has(key))) return false;
  if (typeof progress.phase !== "string" || !progressPhases.has(progress.phase))
    return false;
  for (const key of ["operation", "errorType"] as const) {
    const field = progress[key];
    if (
      field !== undefined &&
      (typeof field !== "string" || field.length > 100)
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
  CALLBACK_SIGNING_SECRET: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_INSTALLATION_ID: string;
  ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY: string;
  ROUNDHOUSE_GITHUB_WEBHOOK_SECRET: string;
};

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

class ContainerDispatcher implements AttemptDispatcher {
  constructor(
    private readonly containers: AttemptNamespace,
    private readonly artifacts: CloudflareArtifactsNamespace,
    private readonly callbackSigningSecret: string,
    private readonly controlPlaneOrigin: string,
    private readonly runs: D1RunRepository,
    private readonly modelBroker: Fetcher,
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
        : attempt.stage === "implement"
          ? "implementation"
          : attempt.stage === "review"
            ? "review"
            : "validation";
    const route = await this.resolveModelRoute(attempt, taskType);
    const repository = await this.artifacts.importBase(
      workspaceName(attempt.runId),
      `https://github.com/${run.repository}.git`,
    );
    // Recovery invalidates every token from an interrupted container before a
    // replacement receives a fresh, short-lived credential.
    await repository.revokeActiveTokens();
    const access = attempt.stage === "implement" ? "write" : "read";
    const token = await repository.createToken(access, 30 * 60);
    const id = this.containers.idFromName(attempt.id);
    const attemptSecret = await signCallback(
      this.callbackSigningSecret,
      attempt.id,
    );
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
      attempt.stage === "implement"
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
    const qualification = qualificationAttempt?.result?.qualification;
    const reproduction = reproductionAttempt?.result?.reproduction;
    const plan = planAttempt?.result?.plan;
    const implementation = implementationAttempt?.result?.implementation;
    const review = reviewAttempt ? aggregatedReview(reviewAttempts) : undefined;
    const ci = ciAttempt?.result?.ci;
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
      protectedPaths,
      issue: run.issue,
      issueNumber: run.issueNumber,
      context:
        qualification || reproduction || plan || implementation || review || ci
          ? {
              ...(qualification ? { qualification } : {}),
              ...(reproduction ? { reproduction } : {}),
              ...(plan ? { plan } : {}),
              ...(implementation ? { implementation } : {}),
              ...(holisticSelection ? { holisticSelection } : {}),
              ...(review ? { review } : {}),
              ...(ci ? { ci } : {}),
            }
          : undefined,
      routing: route,
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
      ...(attempt.stage === "implement" &&
      (ci as Record<string, unknown> | undefined)?.reason === "base_conflict"
        ? {
            upstream: {
              remote: `https://github.com/${run.repository}.git`,
              hostname: "github.com",
              branch: "main",
            },
          }
        : {}),
    };
    try {
      const response = await observeResponse(
        await this.containers.get(id).fetch(
          new Request("https://attempt.invalid/assign", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-roundhouse-attempt-secret": attemptSecret,
              "x-roundhouse-callback-url": new URL(
                "/attempts/callback",
                this.controlPlaneOrigin,
              ).toString(),
            },
            body: JSON.stringify(assignment),
          }),
        ),
        {
          api: "attempt_container",
          operation: "assign",
          attemptId: attempt.id,
        },
      );
      if (response.status !== 202) throw new Error("container_dispatch_failed");
    } catch (error) {
      await repository.revokeToken(token.id);
      throw error;
    }
  }
}

class ContainerCheckpointValidator implements CheckpointValidator {
  constructor(
    private readonly containers: AttemptNamespace,
    private readonly artifacts: CloudflareArtifactsNamespace,
    private readonly repository: D1RunRepository,
    private readonly github: GitHubClient,
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
      protectedPaths,
    });
    if (attempt.stage !== "implement") {
      try {
        validateReadOnlyCheckpoint(input.checkpoint);
      } finally {
        await artifact.revokeToken(input.artifactTokenId);
      }
      return;
    }
    const token = await artifact.createToken("read", 5 * 60);
    try {
      const response = await observeResponse(
        await this.containers
          .get(this.containers.idFromName(`${attempt.id}-validation`))
          .fetch(
            new Request("https://attempt.invalid/validate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                ...attempt,
                baseCommit: run.baseCommit,
                protectedPaths,
                checkpoint: input.checkpoint,
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
                publish: {
                  remote: `https://github.com/${run.repository}.git`,
                  hostname: "github.com",
                  token: await this.github.installationToken(),
                  ref: `refs/heads/${githubBranch(run.issueNumber)}`,
                },
              }),
            }),
          ),
        {
          api: "attempt_container",
          operation: "validate",
          attemptId: attempt.id,
        },
      );
      if (!response.ok) throw new Error("checkpoint_git_validation_failed");
    } finally {
      await Promise.all([
        artifact.revokeToken(token.id),
        artifact.revokeToken(input.artifactTokenId),
      ]);
    }
  }
}

const worker: ExportedHandler<RuntimeEnv, Wakeup> = {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    const isPublicUiRequest = () =>
      url.hostname === new URL(env.PUBLIC_ORIGIN).hostname;
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
        if (closure.attemptId)
          scheduleAttemptContainerDestruction(
            env.ATTEMPT_CONTAINERS,
            closure.attemptId,
            context,
          );
      } else
        outcome = await acceptGitHubComment(request, env, repository, enqueue);
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
        new ContainerCheckpointValidator(
          env.ATTEMPT_CONTAINERS,
          artifacts,
          repository,
          new GitHubClient(env),
        ),
        input,
      );
      if (outcome === "completed" || outcome === "duplicate") {
        const attempt = await repository.getAttempt(input.attemptId);
        if (attempt)
          await env.RUN_WAKEUPS.send({
            runId: attempt.runId,
            expectedRevision: attempt.runRevision,
          });
        scheduleAttemptContainerDestruction(
          env.ATTEMPT_CONTAINERS,
          input.attemptId,
          context,
        );
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
    const dispatcher = new ContainerDispatcher(
      env.ATTEMPT_CONTAINERS,
      artifactsNamespace(env),
      env.CALLBACK_SIGNING_SECRET,
      env.CONTROL_PLANE_ORIGIN,
      repository,
      env.MODEL_BROKER,
    );
    const github = new GitHubClient(env);
    const automation = new GitHubCiAutomation(repository, github);
    const reporter = new GitHubStageReporter(github, env.PUBLIC_ORIGIN);
    for (const message of batch.messages) {
      try {
        const run = await repository.get(message.body.runId);
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
      env.ATTEMPT_CONTAINERS,
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
    );
  },
};

export default worker;
