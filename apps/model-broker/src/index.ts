// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  modelStopReasonHeader,
  modelThinkingLevels,
  modelProtocols,
  type ModelProtocol,
  type ModelRoute,
} from "@roundhouse/core";
import { observeResponse } from "@roundhouse/response-observer";

const routeHeaders = {
  provider: "x-roundhouse-routing-provider",
  model: "x-roundhouse-routing-model",
  protocol: "x-roundhouse-routing-protocol",
  thinkingLevel: "x-roundhouse-routing-thinking-level",
  rule: "x-roundhouse-routing-rule",
} as const;
const researchRoles = new Set(["qualify", "reproduce", "plan"]);

export type BrokerEnv = Omit<Cloudflare.Env, "ROUTING_ROUTES"> & {
  readonly ROUTING_ROUTES?: string;
};

interface RawAiBinding {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options: {
      readonly gateway: {
        readonly id: string;
        readonly collectLog: false;
        readonly skipCache: true;
      };
      readonly extraHeaders: { readonly "cf-aig-zdr": "true" };
      readonly returnRawResponse: true;
    },
  ): Promise<Response>;
}

interface RoutingEnvelope {
  readonly role: string;
  readonly taskType: string;
  readonly complexity: string;
  readonly requestedModel?: string;
  readonly requestedReasoning?: ModelRoute["thinkingLevel"];
  readonly profileHash?: string;
}

const defaultRoutes: Readonly<
  Record<string, Pick<ModelRoute, "provider" | "model" | "protocol">>
> = {
  plan: {
    provider: "openai",
    model: "openai/gpt-5.6-sol",
    protocol: "openai-responses",
  },
  implement: {
    provider: "moonshotai",
    model: "moonshotai/kimi-k3",
    protocol: "openai-completions",
  },
  "review-holistic": {
    provider: "openai",
    model: "openai/gpt-5.6-sol",
    protocol: "openai-responses",
  },
  "review-security": {
    provider: "openai",
    model: "openai/gpt-5.6-sol",
    protocol: "openai-responses",
  },
  "review-data": {
    provider: "openai",
    model: "openai/gpt-5.6-sol",
    protocol: "openai-responses",
  },
};

function configuredRoutes(env: BrokerEnv) {
  if (!env.ROUTING_ROUTES) return defaultRoutes;
  try {
    return {
      ...defaultRoutes,
      ...(JSON.parse(env.ROUTING_ROUTES) as typeof defaultRoutes),
    };
  } catch {
    throw new Error("invalid_routing_configuration");
  }
}

function defaultProtocol(provider: string): ModelProtocol {
  if (provider === "anthropic") return "anthropic-messages";
  if (provider === "moonshotai") return "openai-completions";
  if (provider === "google") return "google-generative-ai";
  return "openai-responses";
}

function routingRule(role: string): string {
  if (role === "review-holistic") return "review-holistic-v1";
  if (role === "review-security") return "review-security-v1";
  if (role === "review-data") return "review-data-v1";
  if (role === "reproduce") return "reproduction-default-v1";
  if (role === "plan") return "planning-default-v1";
  if (role === "implement") return "implementation-default-v1";
  if (role === "review") return "review-default-v1";
  return "qualification-default-v1";
}

function validEnvelope(value: unknown): value is RoutingEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Record<string, unknown>;
  return (
    [envelope.role, envelope.taskType, envelope.complexity].every(
      (item) => typeof item === "string" && item.length > 0,
    ) &&
    (envelope.requestedModel === undefined ||
      (typeof envelope.requestedModel === "string" &&
        /^[a-z0-9._-]+\/[A-Za-z0-9._/-]+$/.test(envelope.requestedModel))) &&
    (envelope.requestedReasoning === undefined ||
      modelThinkingLevels.includes(
        envelope.requestedReasoning as ModelRoute["thinkingLevel"],
      )) &&
    (envelope.profileHash === undefined ||
      (typeof envelope.profileHash === "string" &&
        /^[a-f0-9]{64}$/.test(envelope.profileHash)))
  );
}

export function resolveRoute(
  envelope: RoutingEnvelope,
  env: BrokerEnv,
): ModelRoute {
  const configured = configuredRoutes(env)[envelope.role];
  const model =
    envelope.requestedModel ?? configured?.model ?? env.ROUTING_MODEL;
  const provider =
    (envelope.requestedModel ? undefined : configured?.provider) ??
    model.split("/", 1)[0] ??
    "";
  const protocol = envelope.requestedModel
    ? defaultProtocol(provider)
    : (configured?.protocol ?? defaultProtocol(provider));
  const thinkingLevel =
    envelope.requestedReasoning ?? env.ROUTING_REASONING_EFFORT;
  if (
    !provider ||
    !model ||
    !modelProtocols.includes(protocol) ||
    !modelThinkingLevels.includes(thinkingLevel as ModelRoute["thinkingLevel"])
  )
    throw new Error("invalid_routing_configuration");
  return {
    provider,
    model,
    protocol,
    thinkingLevel: thinkingLevel as ModelRoute["thinkingLevel"],
    rule: envelope.requestedModel
      ? `profile-${envelope.role}-v2`
      : routingRule(envelope.role),
  };
}

function routeFromHeaders(request: Request): ModelRoute {
  const values = Object.fromEntries(
    Object.entries(routeHeaders).map(([key, header]) => [
      key,
      request.headers.get(header),
    ]),
  ) as Record<keyof typeof routeHeaders, string | null>;
  if (Object.values(values).some((value) => !value))
    throw new Error("missing_route");
  if (!modelProtocols.includes(values.protocol as ModelProtocol))
    throw new Error("invalid_route_protocol");
  if (
    !modelThinkingLevels.includes(
      values.thinkingLevel as ModelRoute["thinkingLevel"],
    )
  )
    throw new Error("invalid_route_thinking_level");
  return {
    provider: values.provider!,
    model: values.model!,
    protocol: values.protocol as ModelProtocol,
    thinkingLevel: values.thinkingLevel as ModelRoute["thinkingLevel"],
    rule: values.rule!,
  };
}

function responseHeaders(response: Response, route: ModelRoute): Headers {
  const headers = new Headers(response.headers);
  for (const [key, header] of Object.entries(routeHeaders))
    headers.set(header, String(route[key as keyof ModelRoute]));
  return headers;
}

async function cloudflareStopReason(
  response: Response,
): Promise<"budget" | undefined> {
  if (response.status !== 429) return undefined;
  try {
    const body = (await response.clone().json()) as {
      errors?: readonly { code?: unknown }[];
      error?: unknown;
      internalCode?: unknown;
    };
    const gatewayErrorCodes = Array.isArray(body.error)
      ? body.error.map((error: { code?: unknown }) => error.code)
      : body.error && typeof body.error === "object"
        ? [(body.error as { code?: unknown }).code]
        : [];
    const codes = [
      body.internalCode,
      ...(body.errors ?? []).map((error) => error.code),
      ...gatewayErrorCodes,
    ];
    return codes.some((code) => ["3036", "2041"].includes(String(code)))
      ? "budget"
      : undefined;
  } catch {
    return undefined;
  }
}

function endpointProtocol(pathname: string): ModelProtocol | undefined {
  if (pathname === "/v1/responses") return "openai-responses";
  if (pathname === "/v1/chat/completions") return "openai-completions";
  if (pathname === "/v1/messages") return "anthropic-messages";
  if (pathname.startsWith("/v1beta/models/")) return "google-generative-ai";
  return undefined;
}

function tools(body: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(body.tools)
    ? body.tools.filter(
        (tool): tool is Record<string, unknown> =>
          Boolean(tool) && typeof tool === "object",
      )
    : [];
}

function applyHostedResearch(
  body: Record<string, unknown>,
  route: ModelRoute,
  role: string,
): void {
  const existing = tools(body).filter(
    (tool) =>
      !String(tool.type).startsWith("web_search") &&
      tool.type !== "web_search_20250305",
  );
  if (existing.length > 0) body.tools = existing;
  else delete body.tools;
  if (!researchRoles.has(role)) return;
  if (route.protocol === "openai-responses") {
    body.tools = [...existing, { type: "web_search_preview" }];
  } else if (route.protocol === "anthropic-messages") {
    body.tools = [
      ...existing,
      { type: "web_search_20250305", name: "web_search" },
    ];
  }
}

function normalizeAnthropicSystem(
  body: Record<string, unknown>,
  protocol: ModelProtocol,
): void {
  if (protocol !== "anthropic-messages" || !Array.isArray(body.system)) return;
  if (
    !body.system.every(
      (block) =>
        typeof block === "string" ||
        (Boolean(block) &&
          typeof block === "object" &&
          "text" in block &&
          typeof block.text === "string"),
    )
  )
    return;
  body.system = body.system
    .map((block) => {
      if (typeof block === "string") return block;
      if (
        block &&
        typeof block === "object" &&
        "text" in block &&
        typeof block.text === "string"
      )
        return block.text;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

async function resolveRouteRequest(
  request: Request,
  env: BrokerEnv,
): Promise<Response> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!validEnvelope(value))
    return Response.json(
      { error: "invalid_routing_envelope" },
      { status: 400 },
    );
  try {
    const route = resolveRoute(value, env);
    console.log(
      JSON.stringify({
        message: "model_route_selected",
        role: value.role,
        taskType: value.taskType,
        requestedModel: value.requestedModel ?? null,
        requestedReasoning: value.requestedReasoning ?? null,
        profileHash: value.profileHash ?? null,
        provider: route.provider,
        model: route.model,
        protocol: route.protocol,
        thinkingLevel: route.thinkingLevel,
        rule: route.rule,
      }),
    );
    return Response.json(route);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "model_route_selection_failed",
        role: value.role,
        requestedModel: value.requestedModel ?? null,
        profileHash: value.profileHash ?? null,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json(
      { error: "invalid_routing_configuration" },
      { status: 500 },
    );
  }
}

export async function brokerRequest(
  request: Request,
  env: BrokerEnv,
  ai: RawAiBinding = env.AI as unknown as RawAiBinding,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/route")
    return resolveRouteRequest(request, env);
  const protocol =
    request.method === "POST" ? endpointProtocol(url.pathname) : undefined;
  if (!protocol) return Response.json({ error: "not_found" }, { status: 404 });

  let route: ModelRoute;
  try {
    route = routeFromHeaders(request);
  } catch {
    return Response.json(
      { error: "invalid_routing_envelope" },
      { status: 400 },
    );
  }
  if (route.protocol !== protocol)
    return Response.json(
      { error: "routing_protocol_mismatch" },
      { status: 409 },
    );
  if (request.headers.get("content-encoding"))
    return Response.json(
      { error: "compressed_request_not_supported" },
      { status: 415 },
    );

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  body.model = route.model;
  normalizeAnthropicSystem(body, route.protocol);
  applyHostedResearch(
    body,
    route,
    request.headers.get("x-roundhouse-role") ?? "",
  );

  let response: Response;
  try {
    response = await ai.run(route.model, body, {
      gateway: {
        id: env.AI_GATEWAY_ID,
        collectLog: false,
        skipCache: true,
      },
      extraHeaders: { "cf-aig-zdr": "true" },
      returnRawResponse: true,
    });
  } catch (error) {
    const attemptId = request.headers.get("x-roundhouse-attempt-id");
    console.error(
      JSON.stringify({
        message: "api_request_failed",
        api: "workers_ai",
        operation: "run_model",
        ...(attemptId ? { attemptId } : {}),
        model: route.model,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json({ error: "model_upstream_failed" }, { status: 502 });
  }
  const attemptId = request.headers.get("x-roundhouse-attempt-id");
  const stopReason = await cloudflareStopReason(response);
  const captured = await observeResponse(response, {
    api: "workers_ai",
    operation: "run_model",
    ...(attemptId ? { attemptId } : {}),
    model: route.model,
  });
  const headers = responseHeaders(captured, route);
  if (stopReason) headers.set(modelStopReasonHeader, stopReason);
  return new Response(captured.body, {
    status: captured.status,
    statusText: captured.statusText,
    headers,
  });
}

const worker: ExportedHandler<BrokerEnv> = {
  fetch(request, env) {
    return brokerRequest(request, env);
  },
};

export default worker;
