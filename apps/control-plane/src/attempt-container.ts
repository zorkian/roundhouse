// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Container } from "@cloudflare/containers";
import {
  isModelRoute,
  type Attempt,
  type ModelRoute,
  type ModelUsage,
} from "@roundhouse/core";
import { observeResponse } from "@roundhouse/response-observer";
import { verifyCallback } from "./callback.js";
import { attemptInactivityMilliseconds } from "./coordinator.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";

interface AttemptAssignment extends Attempt {
  readonly artifact: {
    readonly remote: string;
    readonly hostname: string;
  };
  readonly issue?: unknown;
  readonly source?: { readonly hostname: string };
  readonly publish?: { readonly hostname: string };
  readonly upstream?: { readonly hostname: string };
}

type AttemptContainerEnv = Cloudflare.Env & {
  readonly DB: D1Like;
  readonly MODEL_BROKER: Fetcher;
  readonly CALLBACK_SIGNING_SECRET: string;
};

const modelHost = "model.roundhouse.internal";
const packageRegistryHost = "registry.npmjs.org";
const containerCa = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
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

export function attemptAllowedHosts(
  attempt: Pick<
    AttemptAssignment,
    "artifact" | "publish" | "source" | "upstream"
  >,
  callbackUrl?: string | null,
): string[] {
  return [
    modelHost,
    packageRegistryHost,
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
    !["qualify", "reproduce", "plan", "implement", "review"].includes(
      attempt.stage,
    ) ||
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
      : attempt.stage === "implement"
        ? "implementation"
        : attempt.stage === "review"
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

export class RoundhouseAttemptContainer extends Container<Cloudflare.Env> {
  override defaultPort = 8080;
  override sleepAfter = "5m";
  override enableInternet = false;
  override interceptHttps = true;

  override async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST")
      return new Response("method_not_allowed", { status: 405 });
    const attempt = await request.json<AttemptAssignment>();
    if (attempt.deadlineAt <= Date.now())
      return new Response("attempt_deadline_expired", { status: 409 });

    await this.setAllowedHosts(
      attemptAllowedHosts(
        attempt,
        request.headers.get("x-roundhouse-callback-url"),
      ),
    );
    await this.startAndWaitForPorts({
      ports: this.defaultPort,
      cancellationOptions: { portReadyTimeoutMS: 30_000 },
      startOptions: {
        envVars: {
          ROUNDHOUSE_ATTEMPT_ID: attempt.id,
          ROUNDHOUSE_ATTEMPT_CAPABILITY:
            request.headers.get("x-roundhouse-attempt-secret") ?? "",
          ROUNDHOUSE_TASK_TYPE:
            attempt.stage === "plan"
              ? "planning"
              : attempt.stage === "implement"
                ? "implementation"
                : attempt.stage === "review"
                  ? "review"
                  : "validation",
          ROUNDHOUSE_COMPLEXITY: "unknown",
          ROUNDHOUSE_DUMMY_TOKEN: "service-binding-auth-only",
          GIT_SSL_CAINFO: containerCa,
          NODE_EXTRA_CA_CERTS: containerCa,
        },
        enableInternet: false,
      },
    });
    const path = new URL(request.url).pathname;
    const response = await observeResponse(
      await this.containerFetch(`http://runner${path}`, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(attempt),
      }),
      {
        api: "agent_runner",
        operation: path,
        attemptId: attempt.id,
      },
    );
    if (path === "/bootstrap" || path === "/validate") return response;
    return response.ok
      ? Response.json(
          { accepted: true, attemptId: attempt.id },
          { status: 202 },
        )
      : new Response("runner_rejected", { status: 503 });
  }
}

RoundhouseAttemptContainer.outboundByHost = { [modelHost]: modelEgress };
