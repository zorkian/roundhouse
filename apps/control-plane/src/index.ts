// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  compileWorkflow,
  attemptHasCapability,
  immutableAttemptId,
  runSchemaVersion,
  type Attempt,
  type RunSnapshot,
  type Wakeup,
} from "@roundhouse/core";
import { attemptInactivityMilliseconds, coordinate } from "./coordinator.js";
import { competitionPromoter } from "./attempt-settlement.js";
import { verifyCallback } from "./callback.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";
import { renderDashboard } from "./dashboard.js";
import { renderRunDetails } from "./run-details.js";
import { renderWorkflowView } from "./workflow-view.js";
import { workflowGraphAsset } from "./workflow-client.js";
import cytoscapeSource from "cytoscape/dist/cytoscape.min.js";
import {
  beginGitHubSignIn,
  handleGitHubCallback,
  renderNotFoundPage,
  renderSignInPage,
  signOut,
  validateUiSession,
  type UiSession,
} from "./ui-auth.js";
import {
  acceptGitHubCheckSuite,
  acceptGitHubPullRequest,
  GitHubCiAutomation,
} from "./github-ci.js";
import {
  acceptGitHubComment,
  acceptGitHubIssueClosed,
  githubClientForRun,
  GitHubStageReporter,
} from "./github.js";
import { launch } from "@cloudflare/playwright";
import { RoundhouseAttemptSandbox } from "./attempt-container.js";
import { DurableAttemptDispatcher } from "./attempt-dispatch.js";
import {
  artifactsNamespace,
  attemptSandbox,
  conflictedIntegrationOutcome,
  destroyAttemptSandbox,
  destroyAttemptSandboxWithTrace,
  githubBranch,
  sandboxName,
  workspaceBackup,
  workspaceName,
  workspaceRef,
  type AttemptNamespace,
  type SandboxDestructionTrace,
  type SandboxNamespace,
} from "./attempt-runtime.js";
export { ContainerProxy } from "@cloudflare/sandbox";
export { RoundhouseAttemptSandbox } from "./attempt-container.js";
export { AttemptExecutionWorkflow } from "./attempt-workflow.js";
export {
  artifactNeedsSync,
  attemptArtifactAccess,
  attemptContext,
  resolveWorkflowAgentInputs,
} from "./attempt-dispatch.js";

export const controlPlaneService = "roundhouse-v2-control-plane";

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function html(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
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

type RecoveryWakeup = Wakeup & { readonly attemptId?: string };
type ExpiredAttemptRecoveryAction = "settle" | "reconcile";

interface ExpiredAttemptRecoveryHandlers {
  readonly decide: (
    attemptId: string,
    wakeup: RecoveryWakeup,
  ) => Promise<ExpiredAttemptRecoveryAction>;
  readonly resumeSettlement: (
    attemptId: string,
    wakeup: Wakeup,
    sandboxName: string,
  ) => Promise<void>;
  readonly reconcile: (attemptId: string, wakeup: Wakeup) => Promise<void>;
  readonly diagnose?: (
    attemptId: string,
    wakeup: RecoveryWakeup,
  ) => Promise<void>;
  readonly resolveName?: (attemptId: string) => Promise<string>;
  readonly trace?: (
    attemptId: string,
    phase: string,
    detail: Record<string, unknown>,
  ) => Promise<void>;
}

export async function recoverExpiredAttempts(
  containers: AttemptNamespace,
  wakeups: readonly RecoveryWakeup[],
  handlers: ExpiredAttemptRecoveryHandlers,
): Promise<void> {
  for (const wakeup of wakeups) {
    const attemptId =
      wakeup.attemptId ??
      immutableAttemptId(wakeup.runId, wakeup.expectedRevision);
    const recoveryStartedAt = Date.now();
    const emit = async (
      phase: string,
      detail: Record<string, unknown> = {},
    ): Promise<void> => {
      await handlers.trace?.(attemptId, phase, {
        runId: wakeup.runId,
        expectedRevision: wakeup.expectedRevision,
        elapsedMs: Date.now() - recoveryStartedAt,
        ...detail,
      });
    };
    try {
      await emit("recovery_started");
      if (handlers.diagnose) await handlers.diagnose(attemptId, wakeup);
      const action = await handlers.decide(attemptId, wakeup);
      await emit("recovery_action_selected", { action });
      await emit("sandbox_name_resolution_started");
      const name = handlers.resolveName
        ? await handlers.resolveName(attemptId)
        : attemptId;
      await emit("sandbox_name_resolution_completed", { sandboxName: name });
      if (action === "reconcile") {
        await emit("sandbox_destroy_started", { sandboxName: name });
        try {
          await destroyAttemptSandbox(containers, name);
          await emit("sandbox_destroy_completed", { sandboxName: name });
        } catch (error) {
          await emit("sandbox_destroy_failed", {
            sandboxName: name,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }
      if (action === "settle") {
        await emit("settlement_resume_started", { sandboxName: name });
        await handlers.resumeSettlement(attemptId, wakeup, name);
        await emit("settlement_resume_completed", { sandboxName: name });
      } else {
        await emit("execution_reconciliation_started");
        await handlers.reconcile(attemptId, wakeup);
        await emit("execution_reconciliation_completed");
      }
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
  "completion_started",
  "completion_completed",
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
  GITHUB_CLIENT_ID: string;
  ROUNDHOUSE_GITHUB_CLIENT_SECRET: string;
  ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY: string;
  ROUNDHOUSE_GITHUB_WEBHOOK_SECRET: string;
};

export { destroyAttemptSandbox, githubBranch };

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
    // Static same-origin client asset for the workflow graph; it carries no
    // run data, so it does not require a browser session.
    if (url.pathname === "/assets/workflow-graph.js" && isPublicUiRequest()) {
      if (request.method !== "GET")
        return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      const assetStartedAt = Date.now();
      const body = workflowGraphAsset(
        typeof cytoscapeSource === "string" ? cytoscapeSource : "",
      );
      console.log(
        JSON.stringify({
          message: "workflow_graph_asset_served",
          bytes: body.length,
          durationMs: Date.now() - assetStartedAt,
        }),
      );
      return new Response(body, {
        headers: {
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "content-type": "text/javascript; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    }
    // Browser authentication lives only on the public UI hostname; every
    // other hostname and capability boundary is unchanged.
    if (url.pathname === "/auth/github" && isPublicUiRequest()) {
      if (request.method !== "GET")
        return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      return beginGitHubSignIn(env);
    }
    if (url.pathname === "/auth/github/callback" && isPublicUiRequest()) {
      if (request.method !== "GET")
        return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      return handleGitHubCallback(url, request, env, html);
    }
    if (url.pathname === "/auth/sign-out" && isPublicUiRequest()) {
      if (request.method !== "GET")
        return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      return signOut(request, env);
    }
    const isUiRoute =
      url.pathname === "/" ||
      url.pathname === "/runs" ||
      /^\/repositories\/[^/]+\/[^/]+\/(workflow|issues\/\d+)$/.test(
        url.pathname,
      );
    let uiSession: UiSession | undefined;
    if (isUiRoute && isPublicUiRequest()) {
      const boundaryStartedAt = Date.now();
      uiSession = await validateUiSession(request, env);
      if (!uiSession) {
        console.log(
          JSON.stringify({
            message: "ui_route_authorization",
            outcome: "signed_out",
            path: url.pathname,
            durationMs: Date.now() - boundaryStartedAt,
          }),
        );
        return html(renderSignInPage());
      }
      console.log(
        JSON.stringify({
          message: "ui_route_authorization",
          outcome: "authorized",
          path: url.pathname,
          githubUserId: uiSession.githubUserId,
          durationMs: Date.now() - boundaryStartedAt,
        }),
      );
    }
    if (
      (url.pathname === "/" || url.pathname === "/runs") &&
      isPublicUiRequest()
    ) {
      if (request.method !== "GET")
        return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
      const queryStartedAt = Date.now();
      const runs = await new D1RunRepository(env.DB).listRunsForRepositories(
        uiSession!.repositoryIds,
      );
      console.log(
        JSON.stringify({
          message: "ui_authorized_query",
          operation: "dashboard_runs",
          outcome: "completed",
          runs: runs.length,
          durationMs: Date.now() - queryStartedAt,
        }),
      );
      return html(
        renderDashboard(runs, { githubLogin: uiSession!.githubLogin }),
      );
    }
    const workflowMatch = url.pathname.match(
      /^\/repositories\/([^/]+)\/([^/]+)\/workflow$/,
    );
    if (workflowMatch && isPublicUiRequest()) {
      let repositoryName: string;
      try {
        repositoryName = `${decodeURIComponent(workflowMatch[1]!)}\/${decodeURIComponent(workflowMatch[2]!)}`;
      } catch {
        return json({ error: "not_found" }, 404);
      }
      const repository = new D1RunRepository(env.DB);
      const run = await repository.latestWorkflowRunForRepository(
        repositoryName,
        uiSession!.repositoryIds,
      );
      if (!run?.profile?.workflow) return html(renderNotFoundPage(), 404);
      if (request.method === "GET") {
        console.log(
          JSON.stringify({
            message: "workflow_graph_rendered",
            repository: repositoryName,
            runId: run.id,
            runRevision: run.revision,
            sourceCommit: run.profile.workflow.sourceCommit,
            workflowHash: run.profile.workflow.hash,
            nodes: Object.keys(run.profile.workflow.nodes).length,
          }),
        );
        return html(renderWorkflowView(run));
      }
      if (request.method !== "POST")
        return json({ error: "method_not_allowed" }, 405, {
          allow: "GET, POST",
        });
      let input: { source?: unknown; sourceCommit?: unknown };
      try {
        input = (await request.json()) as typeof input;
      } catch {
        return json({ error: "invalid_request" }, 400);
      }
      if (
        typeof input.source !== "string" ||
        input.sourceCommit !== run.profile.workflow.sourceCommit
      )
        return json({ error: "invalid_request" }, 400);
      const promptContents = new Map<string, string>();
      for (const node of Object.values(run.profile.workflow.nodes)) {
        for (const prompt of [
          node.agent?.prompt,
          node.human?.prompt,
          ...(node.review?.reviewers.map((reviewer) => reviewer.prompt) ?? []),
        ])
          if (prompt) promptContents.set(prompt.sourcePath, prompt.content);
      }
      try {
        const compiled = await compileWorkflow(
          input.source,
          run.profile.workflow.sourceCommit,
          async (path) => {
            const content = promptContents.get(path);
            if (content === undefined)
              throw new Error("workflow_editor_prompt_unknown");
            return content;
          },
        );
        console.log(
          JSON.stringify({
            message: "workflow_editor_validation_completed",
            repository: repositoryName,
            sourceCommit: compiled.sourceCommit,
            workflowHash: compiled.hash,
            nodes: Object.keys(compiled.nodes).length,
          }),
        );
        return json({
          valid: true,
          hash: compiled.hash,
          nodes: Object.keys(compiled.nodes).length,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "workflow_invalid";
        console.warn(
          JSON.stringify({
            message: "workflow_editor_validation_failed",
            repository: repositoryName,
            sourceCommit: run.profile.workflow.sourceCommit,
            error: message,
          }),
        );
        return json({ error: message }, 400);
      }
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
        uiSession!.repositoryIds,
      );
      if (!details) return html(renderNotFoundPage(), 404);
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
        !attemptHasCapability(attempt, "artifact.write") ||
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
        !attemptHasCapability(attempt, "preview.capture") ||
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
      else if (event === "pull_request")
        outcome = await acceptGitHubPullRequest(
          request,
          env,
          repository,
          enqueue,
        );
      else if (event === "issues") {
        const closure = await acceptGitHubIssueClosed(request, env, repository);
        outcome = closure.outcome;
        if (closure.wakeup) await enqueue(closure.wakeup);
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
    return handleRequest(request);
  },
  async queue(batch, env) {
    const repository = new D1RunRepository(env.DB);
    const dispatcher = new DurableAttemptDispatcher(
      env.ATTEMPT_EXECUTIONS,
      repository,
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
          competitionPromoter(env),
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
      await repository.expiredAttemptLeases(expiredAt),
      {
        async decide(attemptId) {
          const attempt = await repository.getAttempt(attemptId);
          const completion = await repository.getAttemptCompletion(attemptId);
          if (attempt?.state === "executed" && completion) return "settle";
          return "reconcile";
        },
        async resumeSettlement(attemptId, wakeup, attemptSandboxName) {
          const renewed = await repository.renewExecutedAttemptLease(
            attemptId,
            Date.now() + attemptInactivityMilliseconds,
          );
          if (!renewed)
            throw new Error("settlement_recovery_lease_not_renewed");
          const workflowInstanceId = `${attemptId}-settlement-${expiredAt}`;
          const instances = await env.ATTEMPT_EXECUTIONS.createBatch([
            {
              id: workflowInstanceId,
              params: {
                attemptId,
                sandboxName: attemptSandboxName,
                mode: "settle",
              },
            },
          ]);
          const payload = {
            phase: "settlement_resumed",
            workflowInstanceId,
            expectedRevision: wakeup.expectedRevision,
            created: instances.length === 1,
          };
          console.log(
            JSON.stringify({
              message: "attempt_settlement_resumed",
              attemptId,
              runId: wakeup.runId,
              ...payload,
            }),
          );
          await repository.recordAttemptEvent(
            attemptId,
            "attempt_recovery_trace",
            payload,
          );
        },
        async reconcile(attemptId, wakeup) {
          const attempt = await repository.getAttempt(attemptId);
          const run = attempt && (await repository.get(attempt.runId));
          if (
            !attempt ||
            !run ||
            run.revision !== wakeup.expectedRevision ||
            attempt.runRevision !== wakeup.expectedRevision
          )
            return;
          const outcome = {
            kind: "execution_interrupted",
            source: "attempt_recovery",
          } as const;
          const settled = await repository.settleAttemptOutcome(
            attempt.id,
            attempt.runRevision,
            "failed",
            outcome,
          );
          if (settled === "failed" || settled === "duplicate")
            await env.RUN_WAKEUPS.send(wakeup);
          const payload = {
            phase: "execution_interrupted_recorded",
            runRevision: run.revision,
            attemptRevision: attempt.runRevision,
            outcome,
            attemptSettlement: settled,
          };
          console.log(
            JSON.stringify({
              message: "attempt_execution_interruption_recorded",
              attemptId,
              runId: run.id,
              ...payload,
            }),
          );
          await repository.recordAttemptEvent(
            attemptId,
            "attempt_recovery_trace",
            payload,
          );
        },
        async diagnose(attemptId, wakeup) {
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
        async resolveName(attemptId) {
          const attempt = await repository.getAttempt(attemptId);
          return attempt ? sandboxName(attempt) : attemptId;
        },
        async trace(attemptId, phase, detail) {
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
      },
    );
  },
};

export default worker;
