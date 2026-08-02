// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  modelStopReasonHeader,
  modelSupportsThinkingLevel,
  modelThinkingLevels,
  modelProtocols,
  modelTransports,
  runtimeCapabilitiesForModel,
  type ModelProtocol,
  type ModelRoute,
  type ModelTransport,
} from "@roundhouse/core";
import { observeResponse } from "@roundhouse/response-observer";

const routeHeaders = {
  provider: "x-roundhouse-routing-provider",
  model: "x-roundhouse-routing-model",
  protocol: "x-roundhouse-routing-protocol",
  transport: "x-roundhouse-routing-transport",
  thinkingLevel: "x-roundhouse-routing-thinking-level",
  rule: "x-roundhouse-routing-rule",
} as const;
export type BrokerEnv = Omit<Cloudflare.Env, "ROUTING_ROUTES"> & {
  readonly ROUTING_ROUTES?: string;
  readonly AI_GATEWAY_TOKEN?: string;
};

interface RawAiBinding {
  gateway?(gatewayId: string): {
    getUrl(provider?: string): Promise<string>;
  };
  run(
    model: string,
    inputs: Record<string, unknown>,
    options: {
      readonly gateway: {
        readonly id: string;
        readonly collectLog: true;
        readonly skipCache: true;
      };
      readonly extraHeaders: {
        readonly "cf-aig-collect-log-payload": "false";
        readonly "cf-aig-zdr": "true";
      };
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
  Record<
    string,
    Pick<
      ModelRoute,
      "provider" | "model" | "protocol" | "transport" | "thinkingLevel"
    >
  >
> = {
  qualify: {
    provider: "openai",
    model: "openai/gpt-5.6-luna",
    protocol: "openai-responses",
    thinkingLevel: "high",
  },
  investigate: {
    provider: "openai",
    model: "openai/gpt-5.6-terra",
    protocol: "openai-responses",
    thinkingLevel: "high",
  },
  plan: {
    provider: "openai",
    model: "openai/gpt-5.6-sol",
    protocol: "openai-responses",
    thinkingLevel: "max",
  },
  implement: {
    provider: "openai",
    model: "openai/gpt-5.6-terra",
    protocol: "openai-responses",
    thinkingLevel: "max",
  },
  "review-holistic": {
    provider: "anthropic",
    model: "anthropic/claude-opus-5",
    protocol: "anthropic-messages",
    thinkingLevel: "max",
  },
  "review-security": {
    provider: "moonshotai",
    model: "moonshotai/kimi-k3",
    protocol: "openai-completions",
    thinkingLevel: "max",
  },
  "review-data": {
    provider: "openai",
    model: "openai/gpt-5.6-sol",
    protocol: "openai-responses",
    thinkingLevel: "max",
  },
};

function defaultTransport(provider: string): ModelTransport {
  return ["openai", "anthropic", "google"].includes(provider)
    ? "cloudflare-provider-native"
    : "cloudflare-unified";
}

function validProviderNativeProtocol(
  provider: string,
  protocol: ModelProtocol,
): boolean {
  if (provider === "openai")
    return ["openai-responses", "openai-completions"].includes(protocol);
  if (provider === "anthropic") return protocol === "anthropic-messages";
  if (provider === "google") return protocol === "google-generative-ai";
  return false;
}

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
  const transport =
    (envelope.requestedModel ? undefined : configured?.transport) ??
    defaultTransport(provider);
  const thinkingLevel =
    envelope.requestedReasoning ??
    configured?.thinkingLevel ??
    env.ROUTING_REASONING_EFFORT;
  const runtime = runtimeCapabilitiesForModel(model);
  if (
    !provider ||
    !model ||
    !modelProtocols.includes(protocol) ||
    !modelTransports.includes(transport) ||
    (transport === "cloudflare-provider-native" &&
      !validProviderNativeProtocol(provider, protocol)) ||
    !modelThinkingLevels.includes(
      thinkingLevel as ModelRoute["thinkingLevel"],
    ) ||
    !runtime ||
    !modelSupportsThinkingLevel(
      runtime,
      thinkingLevel as ModelRoute["thinkingLevel"],
    )
  )
    throw new Error("invalid_routing_configuration");
  return {
    provider,
    model,
    protocol,
    transport,
    thinkingLevel: thinkingLevel as ModelRoute["thinkingLevel"],
    runtime,
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
  if (
    [
      values.provider,
      values.model,
      values.protocol,
      values.thinkingLevel,
      values.rule,
    ].some((value) => !value)
  )
    throw new Error("missing_route");
  if (!modelProtocols.includes(values.protocol as ModelProtocol))
    throw new Error("invalid_route_protocol");
  const transport = values.transport ?? defaultTransport(values.provider!);
  if (!modelTransports.includes(transport as ModelTransport))
    throw new Error("invalid_route_transport");
  if (
    transport === "cloudflare-provider-native" &&
    !validProviderNativeProtocol(
      values.provider!,
      values.protocol as ModelProtocol,
    )
  )
    throw new Error("invalid_route_transport_protocol");
  if (
    !modelThinkingLevels.includes(
      values.thinkingLevel as ModelRoute["thinkingLevel"],
    )
  )
    throw new Error("invalid_route_thinking_level");
  const runtime = runtimeCapabilitiesForModel(values.model!);
  if (
    !runtime ||
    !modelSupportsThinkingLevel(
      runtime,
      values.thinkingLevel as ModelRoute["thinkingLevel"],
    )
  )
    throw new Error("invalid_route_model_capabilities");
  return {
    provider: values.provider!,
    model: values.model!,
    protocol: values.protocol as ModelProtocol,
    transport: transport as ModelTransport,
    thinkingLevel: values.thinkingLevel as ModelRoute["thinkingLevel"],
    runtime,
    rule: values.rule!,
  };
}

function responseHeaders(response: Response, route: ModelRoute): Headers {
  const headers = new Headers(response.headers);
  for (const [key, header] of Object.entries(routeHeaders))
    headers.set(header, String(route[key as keyof ModelRoute]));
  return headers;
}

function nativeProvider(route: ModelRoute): string {
  if (route.provider === "openai") return "openai";
  if (route.provider === "anthropic") return "anthropic";
  if (route.provider === "google") return "google-ai-studio";
  throw new Error("unsupported_provider_native_route");
}

function nativeModel(route: ModelRoute): string {
  const prefix = `${route.provider}/`;
  if (!route.model.startsWith(prefix) || route.model.length === prefix.length)
    throw new Error("invalid_provider_native_model");
  return route.model.slice(prefix.length);
}

function nativePath(request: Request, route: ModelRoute): string {
  const source = new URL(request.url);
  if (route.protocol === "openai-responses")
    return `/responses${source.search}`;
  if (route.protocol === "openai-completions")
    return `/chat/completions${source.search}`;
  if (route.protocol === "anthropic-messages")
    return `/v1/messages${source.search}`;
  const match = source.pathname.match(
    /^\/(v1(?:beta)?)\/models\/.+(:[A-Za-z][A-Za-z0-9]*)$/,
  );
  if (route.protocol !== "google-generative-ai" || !match)
    throw new Error("invalid_provider_native_endpoint");
  return `/${match[1]}/models/${nativeModel(route)}${match[2]}${source.search}`;
}

function nativeHeaders(
  request: Request,
  env: BrokerEnv,
  route: ModelRoute,
): Headers {
  if (!env.AI_GATEWAY_TOKEN) throw new Error("ai_gateway_token_missing");
  const headers = new Headers({
    "content-type": request.headers.get("content-type") ?? "application/json",
    "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}`,
    "cf-aig-collect-log": "true",
    "cf-aig-collect-log-payload": "false",
    "cf-aig-skip-cache": "true",
    "cf-aig-zdr": "true",
  });
  for (const name of [
    "accept",
    "anthropic-version",
    "anthropic-beta",
    "openai-beta",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (route.provider === "anthropic" && !headers.has("anthropic-version"))
    headers.set("anthropic-version", "2023-06-01");
  return headers;
}

async function runProviderNative(
  request: Request,
  env: BrokerEnv,
  route: ModelRoute,
  body: Record<string, unknown>,
  ai: RawAiBinding,
  outboundFetch: typeof fetch,
): Promise<Response> {
  if (!ai.gateway) throw new Error("ai_gateway_binding_missing");
  const model = nativeModel(route);
  if (route.protocol === "google-generative-ai") delete body.model;
  else body.model = model;
  const baseUrl = await ai
    .gateway(env.AI_GATEWAY_ID)
    .getUrl(nativeProvider(route));
  return outboundFetch(
    `${baseUrl.replace(/\/$/, "")}${nativePath(request, route)}`,
    {
      method: "POST",
      headers: nativeHeaders(request, env, route),
      body: JSON.stringify(body),
      redirect: "manual",
      signal: request.signal,
    },
  );
}

function runUnified(
  env: BrokerEnv,
  route: ModelRoute,
  body: Record<string, unknown>,
  ai: RawAiBinding,
): Promise<Response> {
  body.model = route.model;
  return ai.run(route.model, body, {
    gateway: {
      id: env.AI_GATEWAY_ID,
      collectLog: true,
      skipCache: true,
    },
    extraHeaders: {
      "cf-aig-collect-log-payload": "false",
      "cf-aig-zdr": "true",
    },
    returnRawResponse: true,
  });
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
  enabled: boolean,
): void {
  const existing = tools(body).filter(
    (tool) =>
      !String(tool.type).startsWith("web_search") &&
      tool.type !== "web_search_20250305",
  );
  if (existing.length > 0) body.tools = existing;
  else delete body.tools;
  if (!enabled) return;
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
        transport: route.transport,
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
  outboundFetch: typeof fetch = fetch,
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
  normalizeAnthropicSystem(body, route.protocol);
  applyHostedResearch(
    body,
    route,
    request.headers.get("x-roundhouse-research") === "enabled",
  );

  let response: Response;
  try {
    response =
      route.transport === "cloudflare-provider-native"
        ? await runProviderNative(request, env, route, body, ai, outboundFetch)
        : await runUnified(env, route, body, ai);
  } catch (error) {
    const attemptId = request.headers.get("x-roundhouse-attempt-id");
    console.error(
      JSON.stringify({
        message: "api_request_failed",
        api:
          route.transport === "cloudflare-provider-native"
            ? "ai_gateway_provider_native"
            : "workers_ai",
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
    api:
      route.transport === "cloudflare-provider-native"
        ? "ai_gateway_provider_native"
        : "workers_ai",
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
