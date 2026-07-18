// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

const routingHeaders = [
  "x-roundhouse-attempt-id",
  "x-roundhouse-role",
  "x-roundhouse-task-type",
  "x-roundhouse-complexity",
] as const;

export type BrokerEnv = Cloudflare.Env;

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
  readonly model: string;
  readonly reasoningEffort: string;
  readonly rule:
    | "qualification-default-v1"
    | "reproduction-default-v1"
    | "planning-default-v1";
}

export function selectRoute(request: Request, env: BrokerEnv): BrokerRoute {
  for (const header of routingHeaders)
    if (!request.headers.get(header)) throw new Error(`missing_${header}`);
  return {
    model: env.ROUTING_MODEL,
    reasoningEffort: env.ROUTING_REASONING_EFFORT,
    rule:
      request.headers.get("x-roundhouse-role") === "reproduce"
        ? "reproduction-default-v1"
        : request.headers.get("x-roundhouse-role") === "plan"
          ? "planning-default-v1"
          : "qualification-default-v1",
  };
}

function routingResponseHeaders(response: Response, route: BrokerRoute) {
  const headers = new Headers(response.headers);
  headers.set("x-roundhouse-routing-model", route.model);
  headers.set("x-roundhouse-routing-effort", route.reasoningEffort);
  headers.set("x-roundhouse-routing-rule", route.rule);
  return headers;
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
  } catch {
    return Response.json({ error: "model_upstream_failed" }, { status: 502 });
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: routingResponseHeaders(response, route),
  });
}

const worker: ExportedHandler<BrokerEnv> = {
  fetch(request, env) {
    return brokerRequest(request, env);
  },
};

export default worker;
