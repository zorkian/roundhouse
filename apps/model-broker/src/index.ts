// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { observeResponse } from "@roundhouse/response-observer";

const routingHeaders = [
  "x-roundhouse-attempt-id",
  "x-roundhouse-role",
  "x-roundhouse-task-type",
  "x-roundhouse-complexity",
] as const;
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

export interface BrokerRoute {
  readonly provider: "openai" | "anthropic" | "moonshotai";
  readonly model: string;
  readonly reasoningEffort: string;
  readonly rule:
    | "qualification-default-v1"
    | "reproduction-default-v1"
    | "planning-default-v1"
    | "implementation-default-v1"
    | "review-default-v1"
    | "review-holistic-v1"
    | "review-security-v1"
    | "review-data-v1";
}

const defaultRoutes: Readonly<
  Record<string, Pick<BrokerRoute, "provider" | "model">>
> = {
  plan: { provider: "anthropic", model: "anthropic/claude-opus-4.8" },
  implement: { provider: "openai", model: "openai/gpt-5.6-sol" },
  "review-holistic": {
    provider: "anthropic",
    model: "anthropic/claude-fable-5",
  },
  "review-security": { provider: "moonshotai", model: "moonshotai/kimi-k3" },
  "review-data": { provider: "moonshotai", model: "moonshotai/kimi-k3" },
};

function configuredRoutes(env: BrokerEnv) {
  const value = (env as BrokerEnv & { ROUTING_ROUTES?: string }).ROUTING_ROUTES;
  if (!value) return defaultRoutes;
  try {
    return { ...defaultRoutes, ...(JSON.parse(value) as typeof defaultRoutes) };
  } catch {
    throw new Error("invalid_routing_configuration");
  }
}

export function selectRoute(request: Request, env: BrokerEnv): BrokerRoute {
  for (const header of routingHeaders)
    if (!request.headers.get(header)) throw new Error(`missing_${header}`);
  const role = request.headers.get("x-roundhouse-role")!;
  const configured = configuredRoutes(env)[role];
  const model = configured?.model ?? env.ROUTING_MODEL;
  const provider = configured?.provider ?? model.split("/", 1)[0] ?? "";
  if (!["openai", "anthropic", "moonshotai"].includes(provider))
    throw new Error("invalid_routing_provider");
  return {
    provider: provider as BrokerRoute["provider"],
    model,
    reasoningEffort: env.ROUTING_REASONING_EFFORT,
    rule:
      role === "review-holistic"
        ? "review-holistic-v1"
        : role === "review-security"
          ? "review-security-v1"
          : role === "review-data"
            ? "review-data-v1"
            : role === "reproduce"
              ? "reproduction-default-v1"
              : request.headers.get("x-roundhouse-role") === "plan"
                ? "planning-default-v1"
                : request.headers.get("x-roundhouse-role") === "implement"
                  ? "implementation-default-v1"
                  : request.headers.get("x-roundhouse-role") === "review"
                    ? "review-default-v1"
                    : "qualification-default-v1",
  };
}

function routingResponseHeaders(response: Response, route: BrokerRoute) {
  const headers = new Headers(response.headers);
  headers.set("x-roundhouse-routing-model", route.model);
  headers.set("x-roundhouse-routing-provider", route.provider);
  headers.set("x-roundhouse-routing-effort", route.reasoningEffort);
  headers.set("x-roundhouse-routing-rule", route.rule);
  return headers;
}

function applyToolPolicy(body: Record<string, unknown>, role: string): void {
  const tools = Array.isArray(body.tools)
    ? body.tools.filter(
        (tool): tool is Record<string, unknown> =>
          Boolean(tool) && typeof tool === "object",
      )
    : [];
  const withoutWebSearch = tools.filter(
    (tool) => tool.type !== "web_search" && tool.type !== "web_search_preview",
  );
  if (researchRoles.has(role)) {
    body.tools = [...withoutWebSearch, { type: "web_search" }];
  } else if (withoutWebSearch.length) {
    body.tools = withoutWebSearch;
  } else {
    delete body.tools;
  }
}

export async function brokerRequest(
  request: Request,
  env: BrokerEnv,
  ai: RawAiBinding = env.AI as unknown as RawAiBinding,
): Promise<Response> {
  const url = new URL(request.url);
  const responses = request.method === "POST" && url.pathname === "/responses";
  const models = request.method === "GET" && url.pathname === "/models";
  if (!responses && !models)
    return Response.json({ error: "not_found" }, { status: 404 });

  let route: BrokerRoute;
  try {
    route = selectRoute(request, env);
  } catch {
    return Response.json(
      { error: "invalid_routing_envelope" },
      { status: 400 },
    );
  }

  // Codex already has metadata for the selected built-in model. An empty
  // catalog keeps its optional refresh endpoint local to the private broker.
  if (models) return Response.json({ models: [] });

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
  body.reasoning = {
    ...(typeof body.reasoning === "object" && body.reasoning
      ? (body.reasoning as Record<string, unknown>)
      : {}),
    effort: route.reasoningEffort,
  };
  applyToolPolicy(body, request.headers.get("x-roundhouse-role") ?? "");

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
  const captured = await observeResponse(response, {
    api: "workers_ai",
    operation: "run_model",
    ...(attemptId ? { attemptId } : {}),
    model: route.model,
  });
  return new Response(captured.body, {
    status: captured.status,
    statusText: captured.statusText,
    headers: routingResponseHeaders(captured, route),
  });
}

const worker: ExportedHandler<BrokerEnv> = {
  fetch(request, env) {
    return brokerRequest(request, env);
  },
};

export default worker;
