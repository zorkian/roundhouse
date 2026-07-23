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
const containerCa = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const dockerBuilder = "roundhouse-host-v1";
const dockerBuilderImage =
  "moby/buildkit@sha256:2f5adac4ecd194d9f8c10b7b5d7bceb5186853db1b26e5abd3a657af0b7e26ec";
const dockerBuilderConfig = "/etc/roundhouse-buildkitd.toml";
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
    const startedAt = Date.now();
    await this.traceSetup(attemptId, "workspace_restore_started", undefined, {
      backupId: backup.id,
    });
    try {
      const traceRuntimeFiles = async (phase: string): Promise<void> => {
        const stepStartedAt = Date.now();
        await this.traceSetup(attemptId, `${phase}_started`);
        const paths = [
          "/bin/bash",
          "/lib/ld-musl-x86_64.so.1",
          "/usr/bin/curl",
          "/usr/bin/fusermount3",
          "/usr/bin/squashfuse",
          "/usr/bin/fuse-overlayfs",
        ];
        const results = await Promise.all(
          paths.map(async (path) => ({
            path,
            exists: (await this.exists(path, sessionlessExecutionToken)).exists,
          })),
        );
        await this.traceSetup(attemptId, `${phase}_completed`, stepStartedAt, {
          files: results,
        });
      };
      await traceRuntimeFiles("workspace_restore_files_before_cleanup");
      let stepStartedAt = Date.now();
      await this.traceSetup(attemptId, "workspace_process_cleanup_started");
      await this.killAllProcesses();
      await this.traceSetup(
        attemptId,
        "workspace_process_cleanup_completed",
        stepStartedAt,
      );
      await traceRuntimeFiles("workspace_restore_files_after_cleanup");
      stepStartedAt = Date.now();
      await this.traceSetup(
        attemptId,
        "workspace_restore_capability_check_started",
      );
      const capabilities = await this.execSessionless(
        'for tool in curl fusermount3 squashfuse fuse-overlayfs; do command -v "$tool" || exit 1; done',
        {
          cwd: "/",
          origin: "internal",
          timeout: 5_000,
        },
      );
      await this.traceSetup(
        attemptId,
        "workspace_restore_capability_check_completed",
        stepStartedAt,
        {
          success: capabilities.success,
          exitCode: capabilities.exitCode,
          tools: capabilities.stdout.trim().split(/\s+/).filter(Boolean),
          detail: capabilities.stderr.slice(-1_000),
        },
      );
      if (!capabilities.success)
        throw new Error("workspace_restore_capability_check_failed");
      stepStartedAt = Date.now();
      await this.traceSetup(
        attemptId,
        "workspace_backup_restore_started",
        undefined,
        {
          backupId: backup.id,
        },
      );
      await this.awaitWithHeartbeat(
        attemptId,
        "workspace_backup_restore",
        this.restoreBackup(backup),
      );
      await this.traceSetup(
        attemptId,
        "workspace_backup_restore_completed",
        stepStartedAt,
        { backupId: backup.id },
      );
      const materializeStartedAt = Date.now();
      const stagingDir = "/workspace/.roundhouse-restored-workspace";
      stepStartedAt = Date.now();
      await this.traceSetup(
        attemptId,
        "workspace_restore_staging_prepare_started",
        undefined,
        { stagingDir },
      );
      const prepared = await this.execSessionless(
        `rm -rf ${stagingDir} && mkdir -p ${stagingDir}`,
        {
          cwd: "/",
          origin: "internal",
          timeout: 30_000,
        },
      );
      await this.traceSetup(
        attemptId,
        "workspace_restore_staging_prepare_completed",
        stepStartedAt,
        {
          stagingDir,
          success: prepared.success,
          exitCode: prepared.exitCode,
          detail: prepared.stderr.slice(-1_000),
        },
      );
      if (!prepared.success)
        throw new Error("workspace_restore_staging_prepare_failed");
      stepStartedAt = Date.now();
      await this.traceSetup(
        attemptId,
        "workspace_restore_materialize_copy_started",
        undefined,
        { stagingDir },
      );
      const copied = await this.awaitWithHeartbeat(
        attemptId,
        "workspace_restore_materialize_copy",
        this.execSessionless(`cp -a /workspace/roundhouse/. ${stagingDir}/`, {
          cwd: "/",
          origin: "internal",
          timeout: 30 * 60_000,
        }),
      );
      await this.traceSetup(
        attemptId,
        "workspace_restore_materialize_copy_completed",
        stepStartedAt,
        {
          stagingDir,
          success: copied.success,
          exitCode: copied.exitCode,
          detail: copied.stderr.slice(-1_000),
        },
      );
      if (!copied.success)
        throw new Error("workspace_restore_materialize_copy_failed");
      stepStartedAt = Date.now();
      await this.traceSetup(
        attemptId,
        "workspace_restore_mount_release_started",
      );
      const unmounted = await this.execSessionless(
        "/usr/bin/fusermount3 -u /workspace/roundhouse",
        {
          cwd: "/",
          origin: "internal",
          timeout: 30_000,
        },
      );
      await this.traceSetup(
        attemptId,
        "workspace_restore_mount_release_completed",
        stepStartedAt,
        {
          success: unmounted.success,
          exitCode: unmounted.exitCode,
          detail: unmounted.stderr.slice(-1_000),
        },
      );
      if (!unmounted.success)
        throw new Error("workspace_restore_mount_release_failed");
      stepStartedAt = Date.now();
      await this.traceSetup(
        attemptId,
        "workspace_restore_native_activation_started",
        undefined,
        { stagingDir },
      );
      const activated = await this.execSessionless(
        `rm -rf /workspace/roundhouse && mv ${stagingDir} /workspace/roundhouse`,
        {
          cwd: "/",
          origin: "internal",
          timeout: 30_000,
        },
      );
      await this.traceSetup(
        attemptId,
        "workspace_restore_native_activation_completed",
        stepStartedAt,
        {
          stagingDir,
          success: activated.success,
          exitCode: activated.exitCode,
          detail: activated.stderr.slice(-1_000),
        },
      );
      if (!activated.success)
        throw new Error("workspace_restore_native_activation_failed");
      await this.traceSetup(
        attemptId,
        "workspace_restore_materialization_completed",
        materializeStartedAt,
        { stagingDir },
      );
      stepStartedAt = Date.now();
      await this.traceSetup(attemptId, "workspace_docker_restore_started");
      await this.ensureDocker(attemptId);
      await this.traceSetup(
        attemptId,
        "workspace_docker_restore_completed",
        stepStartedAt,
      );
      await this.traceSetup(
        attemptId,
        "workspace_restore_completed",
        startedAt,
        { backupId: backup.id },
      );
    } catch (error) {
      await this.traceSetup(attemptId, "workspace_restore_failed", startedAt, {
        backupId: backup.id,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    const startedAt = Date.now();
    await this.traceSetup(attemptId, "workspace_backup_started", undefined, {
      runId,
    });
    try {
      let stepStartedAt = Date.now();
      await this.traceSetup(attemptId, "workspace_container_list_started");
      const running = await this.execSessionless("docker ps -q", {
        origin: "internal",
        timeout: 5_000,
      });
      const containerIds = running.success
        ? running.stdout
            .split(/\s+/)
            .filter((id) => /^[a-f0-9]{12,64}$/.test(id))
        : [];
      await this.traceSetup(
        attemptId,
        "workspace_container_list_completed",
        stepStartedAt,
        {
          success: running.success,
          exitCode: running.exitCode,
          containerCount: containerIds.length,
          detail: running.stderr.slice(-1_000),
        },
      );
      for (const containerId of containerIds) {
        stepStartedAt = Date.now();
        await this.traceSetup(
          attemptId,
          "workspace_container_stop_started",
          undefined,
          {
            containerId,
          },
        );
        const stopped = await this.execSessionless(
          `docker stop ${containerId}`,
          {
            origin: "internal",
            timeout: 30_000,
          },
        );
        await this.traceSetup(
          attemptId,
          "workspace_container_stop_completed",
          stepStartedAt,
          {
            containerId,
            success: stopped.success,
            exitCode: stopped.exitCode,
            detail: stopped.stderr.slice(-1_000),
          },
        );
        if (!stopped.success)
          throw new Error("workspace_container_stop_failed");
      }
      stepStartedAt = Date.now();
      await this.traceSetup(attemptId, "workspace_process_cleanup_started");
      await this.killAllProcesses();
      await this.traceSetup(
        attemptId,
        "workspace_process_cleanup_completed",
        stepStartedAt,
      );
      stepStartedAt = Date.now();
      await this.traceSetup(attemptId, "workspace_backup_creation_started");
      const backup = await this.awaitWithHeartbeat(
        attemptId,
        "workspace_backup_creation",
        this.createBackup({
          dir: "/workspace/roundhouse",
          name: `roundhouse-${runId}`,
          gitignore: false,
          ttl: 30 * 24 * 60 * 60,
        }),
      );
      await this.traceSetup(
        attemptId,
        "workspace_backup_creation_completed",
        stepStartedAt,
        { backupId: backup.id },
      );
      await this.traceSetup(
        attemptId,
        "workspace_backup_completed",
        startedAt,
        { runId, backupId: backup.id },
      );
      return backup;
    } catch (error) {
      await this.traceSetup(attemptId, "workspace_backup_failed", startedAt, {
        runId,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    const startedAt = Date.now();
    const parsedUrl = new URL(url);
    await this.traceSetup(attemptId, "preview_fetch_started", undefined, {
      method: init.method ?? "GET",
      path: parsedUrl.pathname,
      port,
    });
    try {
      const response = await this.containerFetch(url, init, port);
      const headers: [string, string][] = [];
      response.headers.forEach((value, name) => headers.push([name, value]));
      const body = await response.arrayBuffer();
      await this.traceSetup(attemptId, "preview_fetch_completed", startedAt, {
        method: init.method ?? "GET",
        path: parsedUrl.pathname,
        port,
        status: response.status,
        bodyBytes: body.byteLength,
      });
      return { status: response.status, headers, body };
    } catch (error) {
      await this.traceSetup(attemptId, "preview_fetch_failed", startedAt, {
        method: init.method ?? "GET",
        path: parsedUrl.pathname,
        port,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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

  private async ensureDocker(attemptId?: string): Promise<Process> {
    const startedAt = Date.now();
    let stepStartedAt = Date.now();
    await this.traceSetup(attemptId, "docker_process_lookup_started");
    let docker = await this.getProcessSessionless("roundhouse-docker");
    const initialStatus = docker ? await docker.getStatus() : undefined;
    await this.traceSetup(
      attemptId,
      "docker_process_lookup_completed",
      stepStartedAt,
      { found: Boolean(docker), status: initialStatus ?? null },
    );
    if (docker && !["starting", "running"].includes(initialStatus ?? "")) {
      stepStartedAt = Date.now();
      await this.traceSetup(
        attemptId,
        "docker_stale_process_kill_started",
        undefined,
        {
          status: initialStatus,
        },
      );
      await docker.kill().catch(() => undefined);
      await this.traceSetup(
        attemptId,
        "docker_stale_process_kill_completed",
        stepStartedAt,
      );
      docker = null;
    }
    if (!docker) {
      stepStartedAt = Date.now();
      await this.traceSetup(attemptId, "docker_process_start_started");
      docker = await this.startProcess(
        "/home/rootless/boot-docker-for-dind.sh",
        { processId: "roundhouse-docker" },
      );
      const startedStatus = await docker.getStatus();
      await this.traceSetup(
        attemptId,
        "docker_process_start_completed",
        stepStartedAt,
        {
          processId: docker.id,
          pid: docker.pid,
          status: startedStatus,
        },
      );
    }
    stepStartedAt = Date.now();
    await this.traceSetup(attemptId, "runtime_capacity_probe_started");
    const capacity = await this.execSessionless(
      "df -k /workspace && getconf _NPROCESSORS_ONLN",
      { origin: "internal", timeout: 5_000 },
    );
    await this.traceSetup(
      attemptId,
      "runtime_capacity_probe_completed",
      stepStartedAt,
      {
        success: capacity.success,
        exitCode: capacity.exitCode,
        stdout: capacity.stdout.slice(-2_000),
        stderr: capacity.stderr.slice(-1_000),
      },
    );
    if (!capacity.success) throw new Error("runtime_capacity_probe_failed");
    let probes = 0;
    let lastWaitingTraceAt = 0;
    while (Date.now() - startedAt < 30_000) {
      const probeStartedAt = Date.now();
      probes += 1;
      await this.traceSetup(
        attemptId,
        "docker_daemon_probe_started",
        undefined,
        { probe: probes },
      );
      let status;
      try {
        status = await this.execSessionless("docker version", {
          origin: "internal",
          timeout: 5_000,
        });
      } catch (error) {
        await this.traceSetup(
          attemptId,
          "docker_daemon_probe_failed",
          probeStartedAt,
          {
            probe: probes,
            errorType:
              error instanceof Error ? error.constructor.name : typeof error,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      await this.traceSetup(
        attemptId,
        "docker_daemon_probe_completed",
        probeStartedAt,
        {
          probe: probes,
          success: status.success,
          exitCode: status.exitCode,
          detail: status.stderr.slice(-1_000),
        },
      );
      if (status.success) {
        const driverStartedAt = Date.now();
        await this.traceSetup(attemptId, "docker_storage_driver_probe_started");
        const driver = await this.execSessionless(
          "docker info --format '{{.Driver}}'",
          {
            cwd: "/",
            origin: "internal",
            timeout: 5_000,
          },
        );
        await this.traceSetup(
          attemptId,
          "docker_storage_driver_probe_completed",
          driverStartedAt,
          {
            success: driver.success,
            exitCode: driver.exitCode,
            driver: driver.stdout.trim(),
            detail: driver.stderr.slice(-1_000),
          },
        );
        if (!driver.success)
          throw new Error("docker_storage_driver_probe_failed");
        await this.traceSetup(attemptId, "docker_daemon_ready", startedAt, {
          probes,
          probeDurationMs: Date.now() - probeStartedAt,
        });
        await this.ensureDockerBuilder(attemptId);
        return docker;
      }
      if (
        lastWaitingTraceAt === 0 ||
        Date.now() - lastWaitingTraceAt >= 5_000
      ) {
        lastWaitingTraceAt = Date.now();
        const process = await this.getProcessSessionless("roundhouse-docker");
        const processStatus = process ? await process.getStatus() : null;
        await this.traceSetup(attemptId, "docker_daemon_waiting", startedAt, {
          probes,
          probeDurationMs: Date.now() - probeStartedAt,
          exitCode: status.exitCode,
          processStatus,
          detail: status.stderr.slice(-1_000),
        });
        if (processStatus && !["starting", "running"].includes(processStatus)) {
          const logs = await this.getProcessLogs("roundhouse-docker");
          await this.traceSetup(
            attemptId,
            "docker_process_exited_before_ready",
            startedAt,
            {
              processStatus,
              stdout: logs.stdout.slice(-4_000),
              stderr: logs.stderr.slice(-4_000),
            },
          );
          throw new Error("docker_process_exited_before_ready");
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const process = await this.getProcessSessionless("roundhouse-docker");
    const processStatus = process ? await process.getStatus() : null;
    const logs = process
      ? await this.getProcessLogs("roundhouse-docker")
      : undefined;
    await this.traceSetup(attemptId, "docker_daemon_timeout", startedAt, {
      probes,
      processStatus,
      ...(logs
        ? {
            stdout: logs.stdout.slice(-4_000),
            stderr: logs.stderr.slice(-4_000),
          }
        : {}),
    });
    throw new Error("docker_start_timeout");
  }

  private async ensureDockerBuilder(attemptId?: string): Promise<void> {
    const startedAt = Date.now();
    await this.traceSetup(
      attemptId,
      "docker_builder_inspect_started",
      undefined,
      { builder: dockerBuilder },
    );
    let stepStartedAt = Date.now();
    const existing = await this.execSessionless(
      `docker buildx inspect ${dockerBuilder}`,
      {
        origin: "internal",
      },
    );
    await this.traceSetup(
      attemptId,
      "docker_builder_inspect_completed",
      stepStartedAt,
      {
        builder: dockerBuilder,
        success: existing.success,
        exitCode: existing.exitCode,
        detail: existing.stderr.slice(-1_000),
      },
    );
    if (!existing.success) {
      stepStartedAt = Date.now();
      const builderContainer = `buildx_buildkit_${dockerBuilder}0`;
      await this.traceSetup(
        attemptId,
        "docker_builder_stale_container_inspect_started",
        undefined,
        { builder: dockerBuilder, container: builderContainer },
      );
      const staleContainer = await this.execSessionless(
        `docker container inspect ${builderContainer}`,
        { origin: "internal" },
      );
      await this.traceSetup(
        attemptId,
        "docker_builder_stale_container_inspect_completed",
        stepStartedAt,
        {
          builder: dockerBuilder,
          container: builderContainer,
          found: staleContainer.success,
          exitCode: staleContainer.exitCode,
          detail: staleContainer.stderr.slice(-1_000),
        },
      );
      if (staleContainer.success) {
        stepStartedAt = Date.now();
        await this.traceSetup(
          attemptId,
          "docker_builder_stale_container_remove_started",
          undefined,
          { builder: dockerBuilder, container: builderContainer },
        );
        const removed = await this.execSessionless(
          `docker rm --force ${builderContainer}`,
          { origin: "internal" },
        );
        await this.traceSetup(
          attemptId,
          "docker_builder_stale_container_remove_completed",
          stepStartedAt,
          {
            builder: dockerBuilder,
            container: builderContainer,
            success: removed.success,
            exitCode: removed.exitCode,
            detail: removed.stderr.slice(-1_000),
          },
        );
        if (!removed.success)
          throw new Error("docker_builder_stale_container_remove_failed");
      }
      stepStartedAt = Date.now();
      await this.traceSetup(
        attemptId,
        "docker_builder_create_started",
        undefined,
        {
          builder: dockerBuilder,
          image: dockerBuilderImage,
          config: dockerBuilderConfig,
          registryCa: containerCa,
        },
      );
      const created = await this.execSessionless(
        `docker buildx create --name ${dockerBuilder} --driver docker-container --driver-opt network=host --driver-opt image=${dockerBuilderImage} --buildkitd-config ${dockerBuilderConfig} --buildkitd-flags '--oci-worker-net=host' --use --bootstrap`,
        { origin: "internal", timeout: 180_000 },
      );
      await this.traceSetup(
        attemptId,
        "docker_builder_create_completed",
        stepStartedAt,
        {
          builder: dockerBuilder,
          success: created.success,
          exitCode: created.exitCode,
          detail: created.stderr.slice(-4_000),
        },
      );
      if (!created.success) {
        await this.traceSetup(
          attemptId,
          "docker_builder_create_failed",
          startedAt,
          { detail: created.stderr.slice(-4_000) },
        );
        throw new Error(
          `docker_builder_create_failed: ${created.stderr.slice(-4_000)}`,
        );
      }
    } else {
      stepStartedAt = Date.now();
      await this.traceSetup(
        attemptId,
        "docker_builder_select_started",
        undefined,
        { builder: dockerBuilder },
      );
      const selected = await this.execSessionless(
        `docker buildx use ${dockerBuilder}`,
        {
          origin: "internal",
        },
      );
      await this.traceSetup(
        attemptId,
        "docker_builder_select_completed",
        stepStartedAt,
        {
          builder: dockerBuilder,
          success: selected.success,
          exitCode: selected.exitCode,
          detail: selected.stderr.slice(-1_000),
        },
      );
      if (!selected.success) {
        throw new Error(
          `docker_builder_select_failed: ${selected.stderr.slice(-4_000)}`,
        );
      }
      stepStartedAt = Date.now();
      await this.traceSetup(
        attemptId,
        "docker_builder_bootstrap_started",
        undefined,
        { builder: dockerBuilder, image: dockerBuilderImage },
      );
      const bootstrapped = await this.execSessionless(
        `docker buildx inspect --bootstrap ${dockerBuilder}`,
        { origin: "internal", timeout: 180_000 },
      );
      await this.traceSetup(
        attemptId,
        "docker_builder_bootstrap_completed",
        stepStartedAt,
        {
          builder: dockerBuilder,
          success: bootstrapped.success,
          exitCode: bootstrapped.exitCode,
          detail: bootstrapped.stderr.slice(-4_000),
        },
      );
      if (!bootstrapped.success) {
        throw new Error(
          `docker_builder_bootstrap_failed: ${bootstrapped.stderr.slice(-4_000)}`,
        );
      }
    }
    stepStartedAt = Date.now();
    await this.traceSetup(
      attemptId,
      "docker_builder_registry_ca_verify_started",
      undefined,
      { builder: dockerBuilder, registry: "ghcr.io" },
    );
    const caVerified = await this.execSessionless(
      `outer_ca=$(sha256sum ${containerCa} | cut -d ' ' -f 1) && inner_ca=$(docker exec buildx_buildkit_${dockerBuilder}0 sha256sum /etc/buildkit/certs/ghcr.io/cloudflare-containers-ca.crt | cut -d ' ' -f 1) && builder_config=$(docker exec buildx_buildkit_${dockerBuilder}0 cat /etc/buildkit/buildkitd.toml) && printf 'outer_ca=%s\\ninner_ca=%s\\nbuilder_config=%s\\n' "$outer_ca" "$inner_ca" "$builder_config" && test "$outer_ca" = "$inner_ca"`,
      { origin: "internal", timeout: 5_000 },
    );
    await this.traceSetup(
      attemptId,
      "docker_builder_registry_ca_verify_completed",
      stepStartedAt,
      {
        builder: dockerBuilder,
        registry: "ghcr.io",
        success: caVerified.success,
        exitCode: caVerified.exitCode,
        detail: caVerified.stdout.slice(-4_000),
        error: caVerified.stderr.slice(-1_000),
      },
    );
    if (!caVerified.success) {
      throw new Error(
        `docker_builder_registry_ca_missing: ${caVerified.stderr.slice(-1_000)}`,
      );
    }
    await this.traceSetup(attemptId, "docker_builder_ready", startedAt, {
      builder: dockerBuilder,
      image: dockerBuilderImage,
    });
    console.log(
      JSON.stringify({
        message: "docker_builder_ready",
        ...(attemptId ? { attemptId } : {}),
        builder: dockerBuilder,
        image: dockerBuilderImage,
        durationMs: Date.now() - startedAt,
      }),
    );
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
