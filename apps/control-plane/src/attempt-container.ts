// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Container } from "@cloudflare/containers";
import type { Attempt, ModelUsage } from "@roundhouse/core";
import { verifyCallback } from "./callback.js";
import { attemptInactivityMilliseconds } from "./coordinator.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";

interface AttemptAssignment extends Attempt {
  readonly artifact: {
    readonly remote: string;
    readonly hostname: string;
  };
  readonly issue?: unknown;
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

export function attemptAllowedHosts(
  attempt: Pick<AttemptAssignment, "artifact" | "publish" | "upstream">,
  callbackUrl?: string | null,
): string[] {
  return [
    modelHost,
    packageRegistryHost,
    attempt.artifact.hostname,
    attempt.publish?.hostname ?? "",
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
  const headers = new Headers(request.headers);
  headers.delete("authorization");
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
  const requestedUrl = new URL(request.url);
  const response = await runtime.MODEL_BROKER.fetch(
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
  const routing = {
    model: response.headers.get("x-roundhouse-routing-model"),
    reasoningEffort: response.headers.get("x-roundhouse-routing-effort"),
    rule: response.headers.get("x-roundhouse-routing-rule"),
  };
  if (routing.model && routing.reasoningEffort && routing.rule)
    await repository.recordModelRouting(attemptId, routing);
  if (!response.body || !response.ok) return response;
  const decoder = new TextDecoder();
  let responseText = "";
  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        responseText += decoder.decode(chunk, { stream: true });
        controller.enqueue(chunk);
      },
      async flush() {
        responseText += decoder.decode();
        const usage = extractModelUsage(
          responseText,
          attemptId,
          routing.model ?? "unknown",
        );
        if (usage) await repository.recordModelUsage(usage);
      },
    }),
  );
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

const prices: Record<string, readonly [number, number, number]> = {
  "openai/gpt-5": [1.25, 0.125, 10],
  "openai/gpt-5.2": [1.75, 0.175, 14],
};
export function extractModelUsage(
  text: string,
  attemptId: string,
  routedModel: string,
): ModelUsage | undefined {
  const candidates = text.trim().startsWith("{")
    ? [text]
    : text
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter((line) => line !== "[DONE]");
  let response: Record<string, unknown> | undefined;
  for (const candidate of candidates) {
    try {
      const event = JSON.parse(candidate) as Record<string, unknown>;
      const value =
        event.type === "response.completed" ? event.response : event;
      if (
        value &&
        typeof value === "object" &&
        (value as Record<string, unknown>).usage
      )
        response = value as Record<string, unknown>;
    } catch {
      /* ignore non-JSON stream fields */
    }
  }
  if (!response) return undefined;
  const usage = response.usage as Record<string, unknown>;
  const inputDetails = (usage.input_tokens_details ?? {}) as Record<
    string,
    unknown
  >;
  const outputDetails = (usage.output_tokens_details ?? {}) as Record<
    string,
    unknown
  >;
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const inputTokens = number(usage.input_tokens),
    cachedInputTokens = number(inputDetails.cached_tokens),
    outputTokens = number(usage.output_tokens),
    reasoningTokens = number(outputDetails.reasoning_tokens),
    totalTokens = number(usage.total_tokens);
  const model =
    typeof response.model === "string" ? response.model : routedModel;
  const directCost = number(
    usage.cost_usd ?? usage.cost ?? response.cost_usd ?? response.cost,
  );
  const rate = prices[model] ?? prices[routedModel];
  const costUsd =
    directCost ??
    (rate && inputTokens !== undefined && outputTokens !== undefined
      ? ((inputTokens - (cachedInputTokens ?? 0)) * rate[0] +
          (cachedInputTokens ?? 0) * rate[1] +
          outputTokens * rate[2]) /
        1_000_000
      : undefined);
  const callId = typeof response.id === "string" ? response.id : undefined;
  if (!callId) return undefined;
  return {
    callId,
    attemptId,
    model,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
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
    const response = await this.containerFetch(`http://runner${path}`, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(attempt),
    });
    if (path === "/validate") return response;
    return response.ok
      ? Response.json(
          { accepted: true, attemptId: attempt.id },
          { status: 202 },
        )
      : new Response("runner_rejected", { status: 503 });
  }
}

RoundhouseAttemptContainer.outboundByHost = { [modelHost]: modelEgress };
