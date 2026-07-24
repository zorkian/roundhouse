// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  Sandbox,
  type DirectoryBackup,
  type ExecOptions,
  type Process,
} from "@cloudflare/sandbox";
import {
  isModelRoute,
  modelStopReasonHeader,
  type Attempt,
  type ModelRoute,
  type ModelUsage,
  type RunRepository,
} from "@roundhouse/core";
import { observeResponse } from "@roundhouse/response-observer";
import { verifyCallback } from "./callback.js";
import type { SandboxComponentHost } from "./attempt-sandbox-components.js";
import { NestedContainerRuntime } from "./nested-container-runtime.js";
import { PreviewTransport } from "./preview-transport.js";
import { WorkspaceLifecycle } from "./workspace-lifecycle.js";
import { attemptInactivityMilliseconds } from "./coordinator.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";

interface AttemptAssignment extends Attempt {
  readonly artifact: {
    readonly remote: string;
    readonly hostname: string;
    readonly [key: string]: unknown;
  };
  readonly issue?: unknown;
  readonly source?: {
    readonly hostname: string;
    readonly [key: string]: unknown;
  };
  readonly publish?: {
    readonly hostname: string;
    readonly [key: string]: unknown;
  };
  readonly upstream?: {
    readonly hostname: string;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

type AttemptContainerEnv = Cloudflare.Env & {
  readonly DB: D1Like;
  readonly MODEL_BROKER: Fetcher;
  readonly CALLBACK_SIGNING_SECRET: string;
};

interface PreparedAttempt {
  readonly attempt: AttemptAssignment;
  readonly attemptSecret: string;
  readonly callbackUrl: string;
  readonly backup?: DirectoryBackup;
}

const modelHost = "model.roundhouse.internal";
const packageRegistryHost = "registry.npmjs.org";
const containerRegistryHosts = [
  "ghcr.io",
  "pkg-containers.githubusercontent.com",
] as const;
// getSandbox(..., { enableDefaultSession: false }) applies this token to exec
// calls on the client stub. Calls made inside a Sandbox subclass do not pass
// through that enhancer, so use the same SDK command contract here. The SDK's
// background-process API remains on its normal process channel; only concurrent
// readiness and diagnostic commands need to be sessionless.
const sessionlessExecutionToken = "__DISABLE_SESSION__";

async function recordModelEvent(
  repository: D1RunRepository,
  attemptId: string,
  kind: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<void> {
  try {
    await repository.recordAttemptEvent(attemptId, kind, payload);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "model_diagnostic_record_failed",
        attemptId,
        kind,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export async function pauseForModelBudget(
  repository: RunRepository,
  attempt: Attempt,
): Promise<boolean> {
  const run = await repository.get(attempt.runId);
  if (
    !run ||
    run.status !== "active" ||
    run.revision !== attempt.runRevision ||
    run.stage !== attempt.stage
  )
    return false;
  const waiting = await repository.transition(run.id, run.revision, {
    status: "waiting",
    stage: run.stage,
    waitingReason: "budget",
  });
  if (!waiting) return false;
  const failed = await repository.failAttempt(attempt.id, attempt.runRevision, {
    failure: { reason: "budget", source: "model_provider" },
  });
  if (failed !== "failed" && failed !== "duplicate")
    console.error(
      JSON.stringify({
        message: "budget_attempt_failure_record_failed",
        attemptId: attempt.id,
        outcome: failed,
      }),
    );
  return true;
}

export function attemptAllowedHosts(
  attempt: Pick<
    AttemptAssignment,
    "artifact" | "publish" | "source" | "stage" | "upstream"
  >,
  callbackUrl?: string | null,
): string[] {
  // Implementation runs use the repository's own development environment.
  // Its image build and lifecycle commands may install dependencies from
  // arbitrary project-selected package repositories. The sandbox VM remains
  // the isolation boundary, while credentials stay behind outbound handlers.
  if (attempt.stage === "implement") return ["*"];
  return [
    modelHost,
    packageRegistryHost,
    ...containerRegistryHosts,
    attempt.artifact.hostname,
    attempt.publish?.hostname ?? "",
    attempt.source?.hostname ?? "",
    attempt.upstream?.hostname ?? "",
    callbackUrl ? new URL(callbackUrl).hostname : "",
  ].filter(Boolean);
}

async function modelEgress(request: Request, env: Cloudflare.Env) {
  const runtime = env as AttemptContainerEnv;
  const attemptId = request.headers.get("x-roundhouse-attempt-id") ?? "";
  const capability =
    request.headers.get("x-roundhouse-attempt-capability") ?? "";
  const validCapability =
    attemptId &&
    capability &&
    (await verifyCallback(
      runtime.CALLBACK_SIGNING_SECRET,
      attemptId,
      capability,
    ));
  if (!validCapability) {
    console.error(
      JSON.stringify({
        message: "model_egress_unauthorized",
        attemptIdPresent: Boolean(attemptId),
        capabilityPresent: Boolean(capability),
      }),
    );
    return new Response("unauthorized", { status: 401 });
  }
  const repository = new D1RunRepository(runtime.DB);
  const attempt = await repository.getAttempt(attemptId);
  if (
    !attempt ||
    ![
      "qualify",
      "reproduce",
      "plan",
      "implement",
      "review",
      "integrate",
    ].includes(attempt.stage) ||
    // Mechanical integration is a no-model operation; only conflict
    // resolution and the integration-delta review may call a model.
    (attempt.stage === "integrate" &&
      !["conflict-resolution", "review-integration"].includes(attempt.role)) ||
    !["created", "dispatched"].includes(attempt.state) ||
    attempt.deadlineAt <= Date.now()
  ) {
    console.error(
      JSON.stringify({
        message: "model_egress_stale",
        attemptFound: Boolean(attempt),
        stage: attempt?.stage,
        state: attempt?.state,
        deadlineActive: Boolean(attempt && attempt.deadlineAt > Date.now()),
      }),
    );
    return new Response("stale_attempt", { status: 409 });
  }
  const recorded = await repository.recordModelCall(
    attemptId,
    Date.now() + attemptInactivityMilliseconds,
  );
  if (!recorded) return new Response("stale_attempt", { status: 409 });
  const route = attempt.routing;
  // A deployed runtime cannot safely continue an older container that speaks
  // the removed Responses-only adapter. Reject it so the existing inactivity
  // recovery destroys that container and redispatches with a fresh native route.
  if (!isModelRoute(route))
    return new Response("model_route_missing", { status: 409 });
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("x-api-key");
  headers.delete("x-roundhouse-attempt-capability");
  headers.set("x-roundhouse-role", attempt.role);
  headers.set(
    "x-roundhouse-task-type",
    attempt.stage === "plan"
      ? "planning"
      : attempt.stage === "implement" || attempt.role === "conflict-resolution"
        ? "implementation"
        : attempt.stage === "review" || attempt.role === "review-integration"
          ? "review"
          : "validation",
  );
  headers.set("x-roundhouse-complexity", "unknown");
  headers.set("x-roundhouse-routing-provider", route.provider);
  headers.set("x-roundhouse-routing-model", route.model);
  headers.set("x-roundhouse-routing-protocol", route.protocol);
  headers.set("x-roundhouse-routing-thinking-level", route.thinkingLevel);
  headers.set("x-roundhouse-routing-rule", route.rule);
  const requestedUrl = new URL(request.url);
  let response: Response;
  try {
    response = await runtime.MODEL_BROKER.fetch(
      new Request(
        `https://broker.roundhouse.internal${requestedUrl.pathname}${requestedUrl.search}`,
        {
          method: request.method,
          headers,
          body: request.body,
          redirect: "manual",
        },
      ),
    );
  } catch (error) {
    await recordModelEvent(repository, attemptId, "model_request_failed", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    console.error(
      JSON.stringify({
        message: "model_request_failed",
        attemptId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
  await recordModelEvent(repository, attemptId, "model_response_opened", {
    status: response.status,
    hasBody: Boolean(response.body),
  });
  const responseLogFields = {
    api: "model_broker",
    operation: `${request.method} ${requestedUrl.pathname}`,
    attemptId,
  };
  if (!response.ok) {
    await recordModelEvent(repository, attemptId, "model_response_rejected", {
      status: response.status,
      hasBody: Boolean(response.body),
    });
  }
  if (response.headers.get(modelStopReasonHeader) === "budget") {
    const paused = await pauseForModelBudget(repository, attempt);
    if (paused)
      await recordModelEvent(
        repository,
        attemptId,
        "attempt_waiting_for_budget",
        {
          status: response.status,
        },
      );
  }
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete(modelStopReasonHeader);
  response = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
  let responseText = "";
  return observeResponse(response, responseLogFields, {
    onText(text) {
      if (response.ok) responseText += text;
    },
    async onComplete() {
      const usage = response.ok
        ? extractModelUsage(responseText, attemptId, route.model, {
            provider: route.provider,
            protocol: route.protocol,
            routingRule: route.rule,
          })
        : undefined;
      if (usage) {
        try {
          await repository.recordModelUsage(usage);
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "model_usage_record_failed",
              attemptId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
      if (response.ok)
        await recordModelEvent(
          repository,
          attemptId,
          "model_response_completed",
          {
            status: response.status,
            usageFound: Boolean(usage),
            callId: usage?.callId ?? null,
          },
        );
    },
  });
}

const prices: Record<string, readonly [number, number, number, number?]> = {
  "anthropic/claude-opus-4.8": [15, 1.5, 75, 18.75],
  "anthropic/claude-fable-5": [3, 0.3, 15, 3.75],
  "moonshotai/kimi-k3": [0.6, 0.15, 2.5],
  "openai/gpt-5": [1.25, 0.125, 10],
  "openai/gpt-5.2": [1.75, 0.175, 14],
  "openai/gpt-5.6-sol": [1.75, 0.175, 14],
};
export function extractModelUsage(
  text: string,
  attemptId: string,
  routedModel: string,
  routing: {
    provider?: string;
    protocol?: ModelRoute["protocol"];
    routingRule?: string;
  } = {},
): ModelUsage | undefined {
  const candidates = text.trim().startsWith("{")
    ? [text]
    : text
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter((line) => line !== "[DONE]");
  let response: Record<string, unknown> | undefined;
  let callId: string | undefined;
  let model = routedModel;
  let inputTokens: number | undefined;
  let cachedInputTokens: number | undefined;
  let cacheCreationInputTokens: number | undefined;
  let reasoningTokens: number | undefined;
  let outputTokens: number | undefined;
  let totalTokens: number | undefined;
  let directCost: number | undefined;
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  for (const candidate of candidates) {
    try {
      const event = JSON.parse(candidate) as Record<string, unknown>;
      const value =
        event.type === "response.completed" ? event.response : event;
      if (!value || typeof value !== "object") continue;
      const current = value as Record<string, unknown>;
      if (event.type === "message_start" && event.message) {
        response = event.message as Record<string, unknown>;
      } else if (current.usage) {
        response = current;
      }
      const identity =
        event.type === "message_start" && event.message
          ? (event.message as Record<string, unknown>)
          : current;
      if (typeof identity.id === "string") callId = identity.id;
      if (typeof identity.model === "string") model = identity.model;
      const usage = (current.usage ?? identity.usage) as
        Record<string, unknown> | undefined;
      if (!usage) continue;
      const inputDetails = (usage.input_tokens_details ??
        usage.prompt_tokens_details ??
        {}) as Record<string, unknown>;
      const outputDetails = (usage.output_tokens_details ??
        usage.completion_tokens_details ??
        {}) as Record<string, unknown>;
      inputTokens =
        number(usage.input_tokens ?? usage.prompt_tokens) ?? inputTokens;
      cachedInputTokens =
        number(
          inputDetails.cached_tokens ??
            usage.cache_read_input_tokens ??
            usage.prompt_cache_hit_tokens,
        ) ?? cachedInputTokens;
      cacheCreationInputTokens =
        number(
          inputDetails.cache_creation_tokens ??
            inputDetails.cache_write_tokens ??
            usage.cache_creation_input_tokens,
        ) ?? cacheCreationInputTokens;
      outputTokens =
        number(usage.output_tokens ?? usage.completion_tokens) ?? outputTokens;
      reasoningTokens =
        number(outputDetails.reasoning_tokens) ?? reasoningTokens;
      totalTokens = number(usage.total_tokens) ?? totalTokens;
      directCost = number(usage.cost_usd ?? usage.cost) ?? directCost;
    } catch {
      /* ignore non-JSON stream fields */
    }
  }
  if (!response) return undefined;
  directCost = directCost ?? number(response.cost_usd ?? response.cost);
  totalTokens =
    totalTokens ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);
  const rate = prices[model] ?? prices[routedModel];
  const costUsd =
    directCost ??
    (rate && inputTokens !== undefined && outputTokens !== undefined
      ? ((routing.provider === "anthropic"
          ? inputTokens * rate[0]
          : (inputTokens - (cachedInputTokens ?? 0)) * rate[0]) +
          (cachedInputTokens ?? 0) * rate[1] +
          (cacheCreationInputTokens ?? 0) * (rate[3] ?? rate[0]) +
          outputTokens * rate[2]) /
        1_000_000
      : undefined);
  callId =
    callId ?? (typeof response.id === "string" ? response.id : undefined);
  if (!callId) return undefined;
  return {
    callId,
    attemptId,
    model,
    configuredModel: routedModel,
    ...(routing.provider ? { provider: routing.provider } : {}),
    ...(routing.routingRule ? { routingRule: routing.routingRule } : {}),
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(cacheCreationInputTokens === undefined
      ? {}
      : { cacheCreationInputTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}

export class RoundhouseAttemptSandbox extends Sandbox<Cloudflare.Env> {
  // Sandbox.defaultPort is its reserved control API; the runner is separate.
  private readonly agentRunnerPort = 8090;
  private readonly durableState: DurableObjectState<{}>;
  private readonly runtimeEnv: AttemptContainerEnv;
  override enableInternet = false;
  override interceptHttps = true;

  constructor(ctx: DurableObjectState<{}>, env: Cloudflare.Env) {
    super(ctx, env);
    this.durableState = ctx;
    this.runtimeEnv = env as AttemptContainerEnv;
  }

  private execSessionless(command: string, options?: ExecOptions) {
    return this.execWithSessionToken(
      command,
      sessionlessExecutionToken,
      options,
    );
  }

  private getProcessSessionless(processId: string) {
    return this.getProcess(processId, sessionlessExecutionToken);
  }

  private componentHost(): SandboxComponentHost {
    return {
      trace: (attemptId, phase, startedAt, detail) =>
        this.traceSetup(attemptId, phase, startedAt, detail),
      exec: (command, options) => this.execSessionless(command, options),
      getProcess: (processId) => this.getProcessSessionless(processId),
      startProcess: (command, options) => this.startProcess(command, options),
      getProcessLogs: (processId) => this.getProcessLogs(processId),
      exists: (path) => this.exists(path, sessionlessExecutionToken),
      killAllProcesses: () => this.killAllProcesses(),
      createBackup: (options) => this.createBackup(options),
      restoreBackup: (backup) => this.restoreBackup(backup),
      containerFetch: (url, init, port) => this.containerFetch(url, init, port),
      awaitWithHeartbeat: (attemptId, phase, operation) =>
        this.awaitWithHeartbeat(attemptId, phase, operation),
    };
  }

  private async traceSetup(
    attemptId: string | undefined,
    phase: string,
    startedAt?: number,
    detail: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    const payload = {
      phase,
      ...(startedAt === undefined
        ? {}
        : { durationMs: Date.now() - startedAt }),
      ...detail,
    };
    console.log(
      JSON.stringify({
        message: "sandbox_trace",
        ...(attemptId ? { attemptId } : {}),
        ...payload,
      }),
    );
    if (!attemptId) return;
    try {
      await new D1RunRepository(this.runtimeEnv.DB).recordAttemptEvent(
        attemptId,
        "sandbox_trace",
        payload,
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "sandbox_trace_record_failed",
          attemptId,
          phase,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  private async awaitWithHeartbeat<T>(
    attemptId: string,
    phase: string,
    operation: Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    const completed = operation.then((value) => ({
      completed: true as const,
      value,
    }));
    for (;;) {
      const result = await Promise.race([
        completed,
        new Promise<{ completed: false }>((resolve) =>
          setTimeout(() => resolve({ completed: false }), 15_000),
        ),
      ]);
      if (result.completed) return result.value;
      await this.traceSetup(attemptId, `${phase}_heartbeat`, startedAt, {
        elapsedMs: Date.now() - startedAt,
      });
    }
  }

  async restoreWorkspace(
    attemptId: string,
    backup: DirectoryBackup,
  ): Promise<void> {
    const host = this.componentHost();
    await new WorkspaceLifecycle(host, (runtimeAttemptId) =>
      new NestedContainerRuntime(host).ensure(runtimeAttemptId),
    ).restore(attemptId, backup);
  }

  async prepareAttempt(
    attempt: AttemptAssignment,
    attemptSecret: string,
    callbackUrl: string,
    backup?: DirectoryBackup,
  ): Promise<void> {
    const startedAt = Date.now();
    await this.traceSetup(
      attempt.id,
      "attempt_workflow_preparation_started",
      undefined,
      {
        stage: attempt.stage,
        backupId: backup?.id ?? null,
      },
    );
    await this.durableState.storage.put(`prepared:${attempt.id}`, {
      attempt,
      attemptSecret,
      callbackUrl,
      backup,
    } satisfies PreparedAttempt);
    await this.traceSetup(
      attempt.id,
      "attempt_workflow_preparation_completed",
      startedAt,
      {
        stage: attempt.stage,
        backupId: backup?.id ?? null,
      },
    );
  }

  async executePreparedAttempt(attemptId: string): Promise<number> {
    const prepared = await this.durableState.storage.get<PreparedAttempt>(
      `prepared:${attemptId}`,
    );
    if (!prepared) throw new Error("prepared_attempt_missing");
    const startedAt = Date.now();
    await this.traceSetup(
      attemptId,
      "attempt_workflow_execution_started",
      undefined,
      {
        stage: prepared.attempt.stage,
        backupId: prepared.backup?.id ?? null,
      },
    );
    try {
      if (prepared.backup)
        await this.restoreWorkspace(attemptId, prepared.backup);
      const status = await this.runAttempt(
        "/assign",
        prepared.attempt,
        prepared.attemptSecret,
        prepared.callbackUrl,
      );
      if (status !== 202) throw new Error(`sandbox_dispatch_http_${status}`);
      await this.durableState.storage.delete(`prepared:${attemptId}`);
      await this.traceSetup(
        attemptId,
        "attempt_workflow_execution_completed",
        startedAt,
        { status },
      );
      return status;
    } catch (error) {
      await this.traceSetup(
        attemptId,
        "attempt_workflow_execution_failed",
        startedAt,
        {
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      throw error;
    }
  }

  async backupWorkspace(
    attemptId: string,
    runId: string,
  ): Promise<DirectoryBackup> {
    return new WorkspaceLifecycle(this.componentHost(), (runtimeAttemptId) =>
      this.ensureDocker(runtimeAttemptId),
    ).backup(attemptId, runId);
  }

  async fetchPreview(
    attemptId: string,
    url: string,
    port: number,
    init: RequestInit = {},
  ): Promise<{
    status: number;
    headers: [string, string][];
    body: ArrayBuffer;
  }> {
    return new PreviewTransport(this.componentHost()).fetch(
      attemptId,
      url,
      port,
      init,
    );
  }

  async runAttempt(
    path: "/bootstrap" | "/assign",
    attempt: AttemptAssignment,
    attemptSecret: string,
    callbackUrl?: string,
  ): Promise<number> {
    if (attempt.deadlineAt <= Date.now()) return 409;

    // Agent work continues asynchronously after /assign returns. Completion,
    // cancellation, and expired-lease recovery explicitly destroy the sandbox.
    const setupStartedAt = Date.now();
    await this.traceSetup(attempt.id, "run_attempt_started", undefined, {
      path,
      stage: attempt.stage,
    });
    try {
      let stepStartedAt = Date.now();
      await this.traceSetup(attempt.id, "keepalive_started");
      await this.setKeepAlive(true);
      await this.traceSetup(attempt.id, "keepalive_completed", stepStartedAt);

      const allowedHosts = attemptAllowedHosts(attempt, callbackUrl);
      stepStartedAt = Date.now();
      await this.traceSetup(attempt.id, "network_policy_started", undefined, {
        allowedHostCount: allowedHosts.length,
      });
      await this.setAllowedHosts(allowedHosts);
      await this.traceSetup(
        attempt.id,
        "network_policy_completed",
        stepStartedAt,
        { allowedHostCount: allowedHosts.length },
      );

      let runner: Process | null = null;
      if (attempt.stage === "implement") {
        stepStartedAt = Date.now();
        await this.traceSetup(attempt.id, "docker_setup_started");
        runner = await this.ensureDocker(attempt.id);
        await this.traceSetup(
          attempt.id,
          "docker_setup_completed",
          stepStartedAt,
          { runtimeProcessId: runner.id },
        );
      }

      stepStartedAt = Date.now();
      await this.traceSetup(attempt.id, "runner_lookup_started");
      runner ??= await this.getProcessSessionless("roundhouse-runner");
      await this.traceSetup(
        attempt.id,
        "runner_lookup_completed",
        stepStartedAt,
        { found: Boolean(runner) },
      );
      if (!runner) {
        stepStartedAt = Date.now();
        await this.traceSetup(attempt.id, "runner_start_started");
        runner = await this.startProcess(
          "/home/rootless/boot-agent-runner.sh",
          {
            processId: "roundhouse-runner",
          },
        );
        const runnerStatus = await runner.getStatus();
        await this.traceSetup(
          attempt.id,
          "runner_start_completed",
          stepStartedAt,
          {
            processId: runner.id,
            pid: runner.pid,
            status: runnerStatus,
          },
        );
      }
      stepStartedAt = Date.now();
      await this.traceSetup(attempt.id, "runner_health_wait_started");
      try {
        await runner.waitForPort(this.agentRunnerPort, {
          path: "/health",
          timeout: 30_000,
        });
      } catch (error) {
        let processStatus: string | undefined;
        let stdout = "";
        let stderr = "";
        try {
          processStatus = await runner.getStatus();
          const logs = await this.getProcessLogs(runner.id);
          stdout = logs.stdout;
          stderr = logs.stderr;
          const persisted = await this.execSessionless(
            "tail -c 4000 /workspace/roundhouse/agent-runner.log",
            { origin: "internal", timeout: 5_000 },
          );
          if (persisted.success) stderr += `\n${persisted.stdout}`;
          else stderr += `\n${persisted.stderr}`;
        } catch (diagnosticError) {
          stderr = `runner_diagnostic_failed: ${
            diagnosticError instanceof Error
              ? diagnosticError.message
              : String(diagnosticError)
          }`;
        }
        await this.traceSetup(
          attempt.id,
          "runner_health_wait_failed",
          stepStartedAt,
          {
            processId: runner.id,
            processStatus: processStatus ?? null,
            stdout: stdout.slice(-4_000),
            stderr: stderr.slice(-4_000),
            errorType:
              error instanceof Error ? error.constructor.name : typeof error,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        throw error;
      }
      await this.traceSetup(
        attempt.id,
        "runner_health_wait_completed",
        stepStartedAt,
      );

      stepStartedAt = Date.now();
      await this.traceSetup(
        attempt.id,
        "runner_assignment_started",
        undefined,
        {
          path,
        },
      );
      const response = await observeResponse(
        await this.containerFetch(
          `http://runner${path}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-roundhouse-attempt-secret": attemptSecret,
              ...(callbackUrl
                ? { "x-roundhouse-callback-url": callbackUrl }
                : {}),
            },
            body: JSON.stringify(attempt),
          },
          this.agentRunnerPort,
        ),
        {
          api: "agent_runner",
          operation: path,
          attemptId: attempt.id,
        },
      );
      await this.traceSetup(
        attempt.id,
        "runner_assignment_completed",
        stepStartedAt,
        { path, status: response.status },
      );
      await this.traceSetup(
        attempt.id,
        "run_attempt_completed",
        setupStartedAt,
        { status: response.status },
      );
      return response.status;
    } catch (error) {
      await this.traceSetup(attempt.id, "run_attempt_failed", setupStartedAt, {
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private ensureDocker(attemptId?: string): Promise<Process> {
    return new NestedContainerRuntime(this.componentHost()).ensure(attemptId);
  }

  async validateCheckpoint(attempt: AttemptAssignment): Promise<number> {
    const startedAt = Date.now();
    await this.traceSetup(attempt.id, "checkpoint_validation_started");
    try {
      let stepStartedAt = Date.now();
      const allowedHosts = attemptAllowedHosts(attempt);
      await this.traceSetup(
        attempt.id,
        "checkpoint_validation_network_policy_started",
        undefined,
        { allowedHostCount: allowedHosts.length },
      );
      await this.setAllowedHosts(allowedHosts);
      await this.traceSetup(
        attempt.id,
        "checkpoint_validation_network_policy_completed",
        stepStartedAt,
        { allowedHostCount: allowedHosts.length },
      );
      stepStartedAt = Date.now();
      await this.traceSetup(
        attempt.id,
        "checkpoint_runtime_owner_lookup_started",
        undefined,
        { needsDocker: attempt.stage === "implement" },
      );
      let runner =
        attempt.stage === "implement"
          ? await this.ensureDocker(attempt.id)
          : await this.getProcessSessionless("roundhouse-runner");
      if (!runner) {
        await this.traceSetup(attempt.id, "checkpoint_runner_start_started");
        const runnerStartedAt = Date.now();
        runner = await this.startProcess(
          "/home/rootless/boot-agent-runner.sh",
          { processId: "roundhouse-runner" },
        );
        await this.traceSetup(
          attempt.id,
          "checkpoint_runner_start_completed",
          runnerStartedAt,
          {
            processId: runner.id,
            pid: runner.pid,
            status: await runner.getStatus(),
          },
        );
      }
      await this.traceSetup(
        attempt.id,
        "checkpoint_runtime_owner_lookup_completed",
        stepStartedAt,
        {
          needsDocker: attempt.stage === "implement",
          processId: runner.id,
          pid: runner.pid,
          status: await runner.getStatus(),
        },
      );
      stepStartedAt = Date.now();
      await this.traceSetup(
        attempt.id,
        "checkpoint_validator_health_wait_started",
      );
      try {
        await runner.waitForPort(this.agentRunnerPort, {
          path: "/health",
          timeout: 30_000,
        });
      } catch (error) {
        const logs = await this.getProcessLogs(runner.id).catch(() => ({
          stdout: "",
          stderr: "checkpoint_validator_logs_unavailable",
          processId: runner.id,
        }));
        const persisted = await this.execSessionless(
          "tail -c 4000 /workspace/roundhouse/agent-runner.log",
          { origin: "internal", timeout: 5_000 },
        ).catch(() => undefined);
        await this.traceSetup(
          attempt.id,
          "checkpoint_validator_health_wait_failed",
          stepStartedAt,
          {
            processId: runner.id,
            processStatus: await runner.getStatus().catch(() => null),
            stdout: logs.stdout.slice(-4_000),
            stderr: `${logs.stderr}\n${
              persisted
                ? persisted.success
                  ? persisted.stdout
                  : persisted.stderr
                : ""
            }`.slice(-4_000),
            errorType:
              error instanceof Error ? error.constructor.name : typeof error,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        throw error;
      }
      await this.traceSetup(
        attempt.id,
        "checkpoint_validator_health_wait_completed",
        stepStartedAt,
      );
      stepStartedAt = Date.now();
      await this.traceSetup(
        attempt.id,
        "checkpoint_validation_request_started",
      );
      const response = await observeResponse(
        await this.containerFetch(
          "http://runner/validate",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(attempt),
          },
          this.agentRunnerPort,
        ),
        {
          api: "agent_runner",
          operation: "/validate",
          attemptId: attempt.id,
        },
      );
      const responseBody = await response.clone().text();
      await this.traceSetup(
        attempt.id,
        "checkpoint_validation_request_completed",
        stepStartedAt,
        {
          status: response.status,
          responseBody: responseBody.slice(0, 4_000),
        },
      );
      await this.traceSetup(
        attempt.id,
        "checkpoint_validation_completed",
        startedAt,
        {
          status: response.status,
          responseBody: responseBody.slice(0, 4_000),
        },
      );
      return response.status;
    } catch (error) {
      await this.traceSetup(
        attempt.id,
        "checkpoint_validation_failed",
        startedAt,
        {
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      throw error;
    }
  }
}

RoundhouseAttemptSandbox.outboundByHost = { [modelHost]: modelEgress };
