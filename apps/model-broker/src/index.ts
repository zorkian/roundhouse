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
const defaultAnthropicMaxTokens = 8192;

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

type NativeFormat = "responses" | "messages" | "chat";

function routeFormat(provider: BrokerRoute["provider"]): NativeFormat {
  return provider === "anthropic"
    ? "messages"
    : provider === "moonshotai"
      ? "chat"
      : "responses";
}

function messageContent(value: unknown) {
  if (!Array.isArray(value)) return value ?? "";
  return value.map((item) => {
    if (!item || typeof item !== "object") return item;
    const part = item as Record<string, unknown>;
    return part.type === "input_text" || part.type === "output_text"
      ? { type: "text", text: part.text ?? "" }
      : part;
  });
}

function toolInput(value: unknown) {
  try {
    return JSON.parse(String(value ?? "{}")) as unknown;
  } catch {
    return {};
  }
}

function responseMessages(body: Record<string, unknown>, format: NativeFormat) {
  const messages: Record<string, unknown>[] = [];
  const input = body.input;
  if (typeof input === "string")
    messages.push({ role: "user", content: input });
  else if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      const value = item as Record<string, unknown>;
      if (typeof value.role === "string")
        messages.push({
          role: value.role,
          content: messageContent(value.content),
        });
      else if (value.type === "function_call")
        messages.push(
          format === "messages"
            ? {
                role: "assistant",
                content: [
                  {
                    type: "tool_use",
                    id: value.call_id,
                    name: value.name,
                    input: toolInput(value.arguments),
                  },
                ],
              }
            : {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: value.call_id,
                    type: "function",
                    function: {
                      name: value.name,
                      arguments: value.arguments ?? "{}",
                    },
                  },
                ],
              },
        );
      else if (value.type === "function_call_output")
        messages.push(
          format === "messages"
            ? {
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: value.call_id,
                    content: String(value.output ?? ""),
                  },
                ],
              }
            : {
                role: "tool",
                content: String(value.output ?? ""),
                tool_call_id: value.call_id,
              },
        );
    }
  }
  return messages;
}

function nativeTools(body: Record<string, unknown>, format: NativeFormat) {
  if (!Array.isArray(body.tools)) return undefined;
  const result: Record<string, unknown>[] = [];
  for (const item of body.tools) {
    if (!item || typeof item !== "object") continue;
    const tool = item as Record<string, unknown>;
    if (format === "messages" && tool.type === "web_search") {
      result.push({ type: "web_search_20250305", name: "web_search" });
      continue;
    }
    if (tool.type !== "function") continue;
    if (format === "messages") {
      result.push({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters ?? { type: "object", properties: {} },
      });
    } else {
      result.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ?? { type: "object", properties: {} },
        },
      });
    }
  }
  return result;
}

export function adaptRequest(
  body: Record<string, unknown>,
  route: BrokerRoute,
): Record<string, unknown> {
  const format = routeFormat(route.provider);
  if (format === "responses") return body;
  const messages = responseMessages(body, format);
  const tools = nativeTools(body, format);
  const common = {
    model: route.model,
    messages,
    ...(typeof body.max_output_tokens === "number"
      ? { max_tokens: body.max_output_tokens }
      : format === "messages"
        ? { max_tokens: defaultAnthropicMaxTokens }
        : {}),
    ...(tools?.length ? { tools } : {}),
    stream: body.stream === true,
  };
  if (format === "messages")
    return {
      ...common,
      ...(typeof body.instructions === "string"
        ? { system: body.instructions }
        : {}),
    };
  return {
    ...common,
    ...(body.stream === true
      ? { stream_options: { include_usage: true } }
      : {}),
    messages:
      typeof body.instructions === "string"
        ? [{ role: "system", content: body.instructions }, ...messages]
        : messages,
  };
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeNative(value: Record<string, unknown>, route: BrokerRoute) {
  if (route.provider === "openai" || Array.isArray(value.output)) return value;
  const usage = (value.usage ?? {}) as Record<string, unknown>;
  const output: Record<string, unknown>[] = [];
  let completionReason: unknown;
  if (route.provider === "anthropic") {
    completionReason = value.stop_reason;
    for (const [index, part] of (Array.isArray(value.content)
      ? value.content
      : []
    ).entries()) {
      if (!part || typeof part !== "object") continue;
      const content = part as Record<string, unknown>;
      if (content.type === "text")
        output.push({
          id: `${String(value.id ?? "response")}_message_${index}`,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [
            completionReason === "refusal"
              ? { type: "refusal", refusal: content.text ?? "" }
              : {
                  type: "output_text",
                  text: content.text ?? "",
                  annotations: [],
                },
          ],
        });
      if (content.type === "tool_use")
        output.push({
          id: String(
            content.id ?? `${String(value.id ?? "response")}_call_${index}`,
          ),
          type: "function_call",
          status: "completed",
          call_id: content.id,
          name: content.name,
          arguments: JSON.stringify(content.input ?? {}),
        });
    }
  } else {
    const choice = Array.isArray(value.choices)
      ? (value.choices[0] as Record<string, unknown> | undefined)
      : undefined;
    const message = (choice?.message ?? {}) as Record<string, unknown>;
    if (
      (typeof message.content === "string" && message.content) ||
      typeof message.refusal === "string"
    )
      output.push({
        id: `${String(value.id ?? "response")}_message_0`,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          typeof message.refusal === "string"
            ? { type: "refusal", refusal: message.refusal }
            : {
                type: "output_text",
                text: message.content,
                annotations: [],
              },
        ],
      });
    for (const [index, item] of (Array.isArray(message.tool_calls)
      ? message.tool_calls
      : []
    ).entries()) {
      const call = item as Record<string, unknown>;
      const fn = (call.function ?? {}) as Record<string, unknown>;
      output.push({
        id: String(
          call.id ?? `${String(value.id ?? "response")}_call_${index}`,
        ),
        type: "function_call",
        status: "completed",
        call_id: call.id,
        name: fn.name,
        arguments: fn.arguments ?? "{}",
      });
    }
    completionReason = choice?.finish_reason;
  }
  const inputTokens = number(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = number(usage.output_tokens ?? usage.completion_tokens);
  const cacheDetails = (usage.prompt_tokens_details ?? {}) as Record<
    string,
    unknown
  >;
  return {
    id: value.id,
    object: "response",
    status: "completed",
    model: value.model ?? route.model,
    output,
    completion_reason: completionReason,
    usage: {
      input_tokens: inputTokens,
      input_tokens_details: {
        cached_tokens: number(
          usage.cache_read_input_tokens ?? cacheDetails.cached_tokens,
        ),
      },
      output_tokens: outputTokens,
      total_tokens: number(usage.total_tokens) || inputTokens + outputTokens,
      ...(usage.cost_usd === undefined ? {} : { cost_usd: usage.cost_usd }),
    },
  };
}

function eventPayloads(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
}

function streamDelta(event: Record<string, unknown>, route: BrokerRoute) {
  if (route.provider === "anthropic" && event.type === "content_block_delta") {
    const delta = (event.delta ?? {}) as Record<string, unknown>;
    const index = number(event.index);
    if (typeof delta.text === "string")
      return {
        type: "response.output_text.delta",
        item_id: `message_${index}`,
        output_index: index,
        content_index: 0,
        delta: delta.text,
      };
    if (typeof delta.partial_json === "string")
      return {
        type: "response.function_call_arguments.delta",
        item_id: `call_${index}`,
        output_index: index,
        delta: delta.partial_json,
      };
  }
  if (route.provider === "moonshotai" && Array.isArray(event.choices)) {
    const choice = event.choices[0] as Record<string, unknown> | undefined;
    const delta = (choice?.delta ?? {}) as Record<string, unknown>;
    if (typeof delta.content === "string")
      return {
        type: "response.output_text.delta",
        item_id: "message_0",
        output_index: 0,
        content_index: 0,
        delta: delta.content,
      };
    const call = Array.isArray(delta.tool_calls)
      ? (delta.tool_calls[0] as Record<string, unknown> | undefined)
      : undefined;
    const fn = (call?.function ?? {}) as Record<string, unknown>;
    if (typeof fn.arguments === "string")
      return {
        type: "response.function_call_arguments.delta",
        item_id: String(call?.id ?? `call_${number(call?.index)}`),
        output_index: number(call?.index),
        delta: fn.arguments,
      };
  }
}

function normalizeStream(response: Response, route: BrokerRoute): Response {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let text = "";
  let pending = "";
  return new Response(
    new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (!done) {
          const chunk = decoder.decode(value, { stream: true });
          text += chunk;
          pending += chunk;
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            try {
              const event = JSON.parse(line.slice(5).trim()) as Record<
                string,
                unknown
              >;
              const normalized = streamDelta(event, route);
              if (normalized)
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(normalized)}\n\n`),
                );
            } catch {
              // Ignore keepalives and the terminal [DONE] marker.
            }
          }
          return;
        }
        const final = await normalizeResponse(
          new Response(text, {
            headers: { "content-type": "text/event-stream" },
          }),
          route,
          false,
        );
        const normalized = await final.json();
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "response.completed", response: normalized })}\n\ndata: [DONE]\n\n`,
          ),
        );
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

export async function normalizeResponse(
  response: Response,
  route: BrokerRoute,
  streamed: boolean,
): Promise<Response> {
  if (route.provider === "openai") return response;
  const eventStream = response.headers
    .get("content-type")
    ?.includes("text/event-stream");
  if (response.ok && streamed && eventStream && response.body)
    return normalizeStream(response, route);
  const text = await response.text();
  if (!response.ok) {
    let upstream: unknown;
    try {
      upstream = JSON.parse(text);
    } catch {
      upstream = { message: text };
    }
    return Response.json(
      {
        error: {
          type: "model_upstream_error",
          provider: route.provider,
          upstream,
        },
      },
      { status: response.status },
    );
  }
  let native: Record<string, unknown> | undefined;
  const anthropicContent: Record<string, unknown>[] = [];
  const chatToolCalls = new Map<number, Record<string, unknown>>();
  let chatText = "";
  if (!eventStream) {
    try {
      native = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: "invalid_model_response" },
        { status: 502 },
      );
    }
  }
  const candidates = eventStream ? eventPayloads(text) : [];
  for (const candidate of candidates) {
    try {
      const event = JSON.parse(candidate) as Record<string, unknown>;
      if (route.provider === "anthropic" && event.type === "message_start")
        native = (event.message ?? {}) as Record<string, unknown>;
      else if (
        route.provider === "anthropic" &&
        event.type === "content_block_start"
      ) {
        const index = number(event.index);
        anthropicContent[index] = {
          ...((event.content_block ?? {}) as Record<string, unknown>),
        };
      } else if (
        route.provider === "anthropic" &&
        event.type === "content_block_delta"
      ) {
        const index = number(event.index);
        const delta = (event.delta ?? {}) as Record<string, unknown>;
        const content = anthropicContent[index] ?? {};
        if (typeof delta.text === "string")
          content.text = String(content.text ?? "") + delta.text;
        if (typeof delta.partial_json === "string")
          content.partial_json =
            String(content.partial_json ?? "") + delta.partial_json;
        anthropicContent[index] = content;
      } else if (event.type === "message_delta" && native) {
        native.stop_reason = (event.delta as Record<string, unknown>)
          ?.stop_reason;
        native.usage = {
          ...(native.usage as object),
          ...(event.usage as object),
        };
      } else if (route.provider === "moonshotai" && event.choices) {
        native ??= { id: event.id, model: event.model, usage: {} };
        if (event.usage) native.usage = event.usage;
        const choice = (event.choices as Record<string, unknown>[])[0];
        if (choice) {
          if (choice.finish_reason) native.finish_reason = choice.finish_reason;
          const delta = (choice.delta ?? {}) as Record<string, unknown>;
          if (typeof delta.content === "string") chatText += delta.content;
          for (const rawCall of Array.isArray(delta.tool_calls)
            ? delta.tool_calls
            : []) {
            const call = rawCall as Record<string, unknown>;
            const index = number(call.index);
            const current = chatToolCalls.get(index) ?? {};
            const fn = (call.function ?? {}) as Record<string, unknown>;
            const oldFn = (current.function ?? {}) as Record<string, unknown>;
            chatToolCalls.set(index, {
              ...current,
              ...call,
              function: {
                ...oldFn,
                ...fn,
                arguments:
                  String(oldFn.arguments ?? "") + String(fn.arguments ?? ""),
              },
            });
          }
        }
      } else if (!event.type) native = event;
    } catch {
      // Ignore native keepalive and non-JSON event fields.
    }
  }
  if (!native)
    return Response.json({ error: "invalid_model_response" }, { status: 502 });
  if (route.provider === "anthropic" && anthropicContent.length) {
    for (const content of anthropicContent)
      if (content.partial_json) {
        try {
          content.input = JSON.parse(String(content.partial_json));
        } catch {
          content.input = {};
        }
      }
    native.content = anthropicContent;
  }
  if (route.provider === "moonshotai" && !native.choices)
    native.choices = [
      {
        finish_reason: native.finish_reason,
        message: {
          content: chatText,
          tool_calls: [...chatToolCalls.values()],
        },
      },
    ];
  const normalized = normalizeNative(native, route);
  if (!streamed) return Response.json(normalized);
  return new Response(
    `data: ${JSON.stringify({ type: "response.completed", response: normalized })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
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
    response = await ai.run(route.model, adaptRequest(body, route), {
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
  response = await normalizeResponse(response, route, body.stream === true);
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
