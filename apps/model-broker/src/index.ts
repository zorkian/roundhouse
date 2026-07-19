// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { reviewerForRole } from "@roundhouse/core";

const routingHeaders = [
  "x-roundhouse-attempt-id",
  "x-roundhouse-role",
  "x-roundhouse-task-type",
  "x-roundhouse-complexity",
] as const;
const researchRoles = new Set(["qualify", "reproduce", "plan"]);
const responseLogChunkSize = 4_000;

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
    | "planning-default-v1"
    | "implementation-default-v1"
    | "review-default-v1"
    | "review-holistic-v1"
    | "review-security-v1"
    | "review-data-v1";
}

export function selectRoute(request: Request, env: BrokerEnv): BrokerRoute {
  for (const header of routingHeaders)
    if (!request.headers.get(header)) throw new Error(`missing_${header}`);
  const role = request.headers.get("x-roundhouse-role")!;
  const reviewer = reviewerForRole(role);
  return {
    model: reviewer?.model ?? env.ROUTING_MODEL,
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
  headers.set("x-roundhouse-routing-effort", route.reasoningEffort);
  headers.set("x-roundhouse-routing-rule", route.rule);
  return headers;
}

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = /^(set-cookie)$/i.test(name) ? "[REDACTED]" : value;
  });
  return headers;
}

function logBodyText(
  fields: Readonly<Record<string, unknown>>,
  text: string,
  sequence: { value: number },
): void {
  for (let offset = 0; offset < text.length; offset += responseLogChunkSize) {
    console.log(
      JSON.stringify({
        message: "api_response_body",
        ...fields,
        sequence: sequence.value++,
        body: text.slice(offset, offset + responseLogChunkSize),
      }),
    );
  }
}

function captureUpstreamResponse(
  response: Response,
  route: BrokerRoute,
  attemptId: string,
): Response {
  const fields = {
    api: "workers_ai",
    operation: "run_model",
    attemptId,
    model: route.model,
  };
  console.log(
    JSON.stringify({
      message: "api_response_opened",
      ...fields,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders(response),
      hasBody: Boolean(response.body),
    }),
  );
  if (!response.body) return response;
  const decoder = new TextDecoder();
  const sequence = { value: 0 };
  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        logBodyText(fields, decoder.decode(chunk, { stream: true }), sequence);
        controller.enqueue(chunk);
      },
      flush() {
        logBodyText(fields, decoder.decode(), sequence);
        console.log(
          JSON.stringify({
            message: "api_response_completed",
            ...fields,
            status: response.status,
            bodyChunks: sequence.value,
          }),
        );
      },
    }),
  );
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
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
    console.error(
      JSON.stringify({
        message: "api_request_failed",
        api: "workers_ai",
        operation: "run_model",
        attemptId: request.headers.get("x-roundhouse-attempt-id"),
        model: route.model,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json({ error: "model_upstream_failed" }, { status: 502 });
  }
  const captured = captureUpstreamResponse(
    response,
    route,
    request.headers.get("x-roundhouse-attempt-id") ?? "",
  );
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
