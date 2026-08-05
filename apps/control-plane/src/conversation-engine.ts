// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  isModelRoute,
  modelErrorCodesHeader,
  modelErrorMessageHeader,
  modelErrorParamHeader,
  modelErrorSourceHeader,
  modelErrorTypeHeader,
  modelRetryAfterHeader,
  modelStopReasonHeader,
  modelUpstreamRequestIdHeader,
  normalizeRepositoryPath,
  type ModelRoute,
} from "@roundhouse/core";
import type {
  Conversation,
  ConversationCallUsage,
  ConversationMessage,
  ConversationTurn,
  DeliveryBrief,
} from "./conversation-store.js";
import type { GitHubApi } from "./github.js";
import { normalizeModelId } from "./model-identity.js";
import { estimateModelCostUsd } from "./model-prices.js";

type Broker = Pick<Fetcher, "fetch">;

const maxToolRounds = 8;
const maxTreePaths = 2_000;
const maxTreeOutputBytes = 60_000;
const maxFileBytes = 200_000;
const maxTranscriptCharacters = 80_000;

const routeHeaders = {
  provider: "x-roundhouse-routing-provider",
  model: "x-roundhouse-routing-model",
  protocol: "x-roundhouse-routing-protocol",
  transport: "x-roundhouse-routing-transport",
  thinkingLevel: "x-roundhouse-routing-thinking-level",
  rule: "x-roundhouse-routing-rule",
} as const;

interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

const repositoryTools: readonly ToolDefinition[] = [
  {
    name: "list_repository_files",
    description:
      "List file paths from the repository commit snapshotted for this conversation.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {},
    },
  },
  {
    name: "read_repository_file",
    description:
      "Read one UTF-8 text file from the repository commit snapshotted for this conversation.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string", minLength: 1, maxLength: 500 },
      },
    },
  },
];

interface FunctionCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

interface ParsedModelResponse {
  readonly text?: string;
  readonly calls: readonly FunctionCall[];
  readonly nativeAssistant: unknown;
}

interface ModelRequest {
  readonly endpoint: string;
  readonly body: Record<string, unknown>;
}

interface StructuredOutput {
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

interface ProtocolAdapter {
  readonly initial: (input: {
    readonly route: ModelRoute;
    readonly instructions: string;
    readonly messages: readonly ConversationMessage[];
    readonly tools: readonly ToolDefinition[];
    readonly structuredOutput?: StructuredOutput;
    readonly maxOutputTokens: number;
  }) => ModelRequest;
  readonly parse: (value: Record<string, unknown>) => ParsedModelResponse;
  readonly continue: (
    request: ModelRequest,
    response: ParsedModelResponse,
    results: readonly {
      readonly call: FunctionCall;
      readonly output: string;
    }[],
  ) => ModelRequest;
}

function brokerHeaders(
  route: ModelRoute,
  research: boolean,
  conversation: Pick<Conversation, "id">,
  turn: Pick<ConversationTurn, "id">,
): Headers {
  const headers = new Headers({
    "content-type": "application/json",
    "x-roundhouse-research": research ? "enabled" : "disabled",
    "x-roundhouse-workload": "conversation",
    "x-roundhouse-role": "conversation",
    "x-roundhouse-conversation-id": conversation.id,
    "x-roundhouse-turn-id": turn.id,
  });
  headers.set(routeHeaders.provider, route.provider);
  headers.set(routeHeaders.model, route.model);
  headers.set(routeHeaders.protocol, route.protocol);
  if (route.transport) headers.set(routeHeaders.transport, route.transport);
  headers.set(routeHeaders.thinkingLevel, route.thinkingLevel);
  headers.set(routeHeaders.rule, route.rule);
  return headers;
}

function brokerFailureFields(response: Headers): Record<string, unknown> {
  const source = response.get(modelErrorSourceHeader);
  const errorType = response.get(modelErrorTypeHeader);
  const errorMessage = response.get(modelErrorMessageHeader);
  const codes = response.get(modelErrorCodesHeader);
  const errorParam = response.get(modelErrorParamHeader);
  const requestId = response.get(modelUpstreamRequestIdHeader);
  const retryAfter = response.get(modelRetryAfterHeader);
  const stopReason = response.get(modelStopReasonHeader);
  return {
    stopReason: stopReason ?? null,
    ...(source ? { source } : {}),
    ...(errorType ? { errorType } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    ...(codes ? { codes: codes.split(",").filter(Boolean) } : {}),
    ...(errorParam ? { errorParam } : {}),
    ...(requestId ? { requestId } : {}),
    ...(retryAfter ? { retryAfter } : {}),
  };
}

function conversationModelErrorFields(value: Record<string, unknown>): {
  readonly errorType?: string;
  readonly errorMessage?: string;
  readonly codes?: readonly string[];
  readonly errorParam?: string;
} {
  const codes = [
    value.internalCode,
    ...((value.errors as readonly { code?: unknown }[] | undefined) ?? []).map(
      (error) => error.code,
    ),
    ...(Array.isArray(value.error)
      ? value.error.map((error: { code?: unknown }) => error.code)
      : value.error && typeof value.error === "object"
        ? [(value.error as { code?: unknown }).code]
        : []),
  ]
    .filter((code) => code !== undefined && code !== null && code !== "")
    .map((code) => String(code));
  const error = value.error;
  if (typeof error === "string")
    return {
      ...(codes.length ? { codes } : {}),
      errorMessage: error.slice(0, 500),
    };
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const record = error as Record<string, unknown>;
    return {
      ...(codes.length ? { codes } : {}),
      ...(typeof record.type === "string"
        ? { errorType: record.type }
        : typeof record.code === "string"
          ? { errorType: record.code }
          : {}),
      ...(typeof record.message === "string"
        ? { errorMessage: record.message.slice(0, 500) }
        : {}),
      ...(typeof record.param === "string"
        ? { errorParam: record.param.slice(0, 120) }
        : {}),
    };
  }
  const first = Array.isArray(value.errors)
    ? value.errors.find(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      )
    : Array.isArray(value.error)
      ? value.error.find(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object",
        )
      : undefined;
  return {
    ...(codes.length ? { codes } : {}),
    ...(first &&
    (typeof first.type === "string" ||
      typeof first.code === "string" ||
      typeof first.code === "number")
      ? {
          errorType:
            typeof first.type === "string" ? first.type : String(first.code),
        }
      : {}),
    ...(first && typeof first.message === "string"
      ? { errorMessage: first.message.slice(0, 500) }
      : typeof value.message === "string"
        ? { errorMessage: value.message.slice(0, 500) }
        : {}),
  };
}

export async function resolveConversationRoute(
  broker: Broker,
  conversation: Pick<Conversation, "context" | "profileHash">,
): Promise<ModelRoute> {
  const response = await broker.fetch(
    new Request("https://broker.roundhouse.internal/route", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role: "conversation",
        taskType: "conversation",
        complexity: "unknown",
        requestedModel: conversation.context.model.id,
        requestedReasoning: conversation.context.model.reasoning,
        profileHash: conversation.profileHash,
      }),
    }),
  );
  if (!response.ok)
    throw new Error(`conversation_route_http_${response.status}`);
  const route: unknown = await response.json();
  if (!isModelRoute(route)) throw new Error("conversation_route_unsupported");
  return route;
}

function selectedTranscript(messages: readonly ConversationMessage[]) {
  let remaining = maxTranscriptCharacters;
  const selected: ConversationMessage[] = [];
  for (const message of [...messages].reverse()) {
    if (remaining <= 0) break;
    const body = message.body.slice(-remaining);
    selected.push({ ...message, body });
    remaining -= body.length;
  }
  return selected.reverse();
}

function textFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!Array.isArray(value)) return undefined;
  const text = value
    .flatMap((part) => {
      if (typeof part === "string") return [part];
      if (!part || typeof part !== "object") return [];
      const record = part as Record<string, unknown>;
      return typeof record.text === "string" ? [record.text] : [];
    })
    .join("\n")
    .trim();
  return text || undefined;
}

const openAiResponsesAdapter: ProtocolAdapter = {
  initial(input) {
    return {
      endpoint: "/v1/responses",
      body: {
        instructions: input.instructions,
        input: selectedTranscript(input.messages).map((message) => ({
          role: message.role,
          content: message.body,
        })),
        ...(input.tools.length
          ? {
              tools: input.tools.map((tool) => ({
                type: "function",
                name: tool.name,
                description: tool.description,
                strict: true,
                parameters: tool.parameters,
              })),
              tool_choice: "auto",
            }
          : {}),
        store: false,
        include: ["reasoning.encrypted_content"],
        max_output_tokens: input.maxOutputTokens,
        ...(input.route.thinkingLevel === "off"
          ? {}
          : { reasoning: { effort: input.route.thinkingLevel } }),
        ...(input.structuredOutput
          ? {
              text: {
                format: {
                  type: "json_schema",
                  name: input.structuredOutput.name,
                  strict: true,
                  schema: input.structuredOutput.schema,
                },
              },
            }
          : {}),
      },
    };
  },
  parse(value) {
    const output = Array.isArray(value.output) ? value.output : [];
    const calls = output.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const call = item as Record<string, unknown>;
      return call.type === "function_call" &&
        typeof call.call_id === "string" &&
        typeof call.name === "string" &&
        typeof call.arguments === "string"
        ? [
            {
              id: call.call_id,
              name: call.name,
              arguments: call.arguments,
            },
          ]
        : [];
    });
    const outputText =
      typeof value.output_text === "string"
        ? value.output_text.trim()
        : output
            .flatMap((item) => {
              if (!item || typeof item !== "object") return [];
              return (
                textFromUnknown(
                  (item as Record<string, unknown>).content,
                )?.split("\n") ?? []
              );
            })
            .join("\n")
            .trim();
    return {
      ...(outputText ? { text: outputText } : {}),
      calls,
      nativeAssistant: output,
    };
  },
  continue(request, response, results) {
    const input = Array.isArray(request.body.input) ? request.body.input : [];
    return {
      ...request,
      body: {
        ...request.body,
        input: [
          ...input,
          ...(Array.isArray(response.nativeAssistant)
            ? response.nativeAssistant
            : []),
          ...results.map(({ call, output }) => ({
            type: "function_call_output",
            call_id: call.id,
            output,
          })),
        ],
      },
    };
  },
};

const openAiCompletionsAdapter: ProtocolAdapter = {
  initial(input) {
    return {
      endpoint: "/v1/chat/completions",
      body: {
        messages: [
          { role: "system", content: input.instructions },
          ...selectedTranscript(input.messages).map((message) => ({
            role: message.role,
            content: message.body,
          })),
        ],
        ...(input.tools.length
          ? {
              tools: input.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  strict: true,
                  parameters: tool.parameters,
                },
              })),
              tool_choice: "auto",
            }
          : {}),
        max_tokens: input.maxOutputTokens,
        ...(input.structuredOutput
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: input.structuredOutput.name,
                  strict: true,
                  schema: input.structuredOutput.schema,
                },
              },
            }
          : {}),
      },
    };
  },
  parse(value) {
    const choices = Array.isArray(value.choices) ? value.choices : [];
    const message =
      choices[0] && typeof choices[0] === "object"
        ? ((choices[0] as Record<string, unknown>).message as
            Record<string, unknown> | undefined)
        : undefined;
    const toolCalls = Array.isArray(message?.tool_calls)
      ? message.tool_calls
      : [];
    const calls = toolCalls.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const call = item as Record<string, unknown>;
      const fn = call.function as Record<string, unknown> | undefined;
      return typeof call.id === "string" &&
        typeof fn?.name === "string" &&
        typeof fn.arguments === "string"
        ? [{ id: call.id, name: fn.name, arguments: fn.arguments }]
        : [];
    });
    const text = textFromUnknown(message?.content);
    return {
      ...(text ? { text } : {}),
      calls,
      nativeAssistant: message ?? {},
    };
  },
  continue(request, response, results) {
    const messages = Array.isArray(request.body.messages)
      ? request.body.messages
      : [];
    return {
      ...request,
      body: {
        ...request.body,
        messages: [
          ...messages,
          response.nativeAssistant,
          ...results.map(({ call, output }) => ({
            role: "tool",
            tool_call_id: call.id,
            content: output,
          })),
        ],
      },
    };
  },
};

const anthropicMessagesAdapter: ProtocolAdapter = {
  initial(input) {
    const schemaInstruction = input.structuredOutput
      ? `\n\nReturn only JSON matching the ${input.structuredOutput.name} schema:\n${JSON.stringify(input.structuredOutput.schema)}`
      : "";
    return {
      endpoint: "/v1/messages",
      body: {
        system: `${input.instructions}${schemaInstruction}`,
        messages: selectedTranscript(input.messages).map((message) => ({
          role: message.role,
          content: message.body,
        })),
        ...(input.tools.length
          ? {
              tools: input.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters,
              })),
            }
          : {}),
        max_tokens: input.maxOutputTokens,
      },
    };
  },
  parse(value) {
    const content = Array.isArray(value.content) ? value.content : [];
    const calls = content.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const call = item as Record<string, unknown>;
      return call.type === "tool_use" &&
        typeof call.id === "string" &&
        typeof call.name === "string"
        ? [
            {
              id: call.id,
              name: call.name,
              arguments: JSON.stringify(call.input ?? {}),
            },
          ]
        : [];
    });
    const text = content
      .flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const part = item as Record<string, unknown>;
        return part.type === "text" && typeof part.text === "string"
          ? [part.text]
          : [];
      })
      .join("\n")
      .trim();
    return {
      ...(text ? { text } : {}),
      calls,
      nativeAssistant: content,
    };
  },
  continue(request, response, results) {
    const messages = Array.isArray(request.body.messages)
      ? request.body.messages
      : [];
    return {
      ...request,
      body: {
        ...request.body,
        messages: [
          ...messages,
          { role: "assistant", content: response.nativeAssistant },
          {
            role: "user",
            content: results.map(({ call, output }) => ({
              type: "tool_result",
              tool_use_id: call.id,
              content: output,
            })),
          },
        ],
      },
    };
  },
};

const googleGenerativeAiAdapter: ProtocolAdapter = {
  initial(input) {
    return {
      endpoint: `/v1beta/models/${encodeURIComponent(input.route.model)}:generateContent`,
      body: {
        systemInstruction: { parts: [{ text: input.instructions }] },
        contents: selectedTranscript(input.messages).map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.body }],
        })),
        ...(input.tools.length
          ? {
              tools: [
                {
                  functionDeclarations: input.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  })),
                },
              ],
            }
          : {}),
        generationConfig: {
          maxOutputTokens: input.maxOutputTokens,
          ...(input.structuredOutput
            ? {
                responseMimeType: "application/json",
                responseSchema: input.structuredOutput.schema,
              }
            : {}),
        },
      },
    };
  },
  parse(value) {
    const candidates = Array.isArray(value.candidates) ? value.candidates : [];
    const content =
      candidates[0] && typeof candidates[0] === "object"
        ? ((candidates[0] as Record<string, unknown>).content as
            Record<string, unknown> | undefined)
        : undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const calls = parts.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const functionCall = (item as Record<string, unknown>).functionCall as
        Record<string, unknown> | undefined;
      return typeof functionCall?.name === "string"
        ? [
            {
              id: `google-${index}-${crypto.randomUUID()}`,
              name: functionCall.name,
              arguments: JSON.stringify(functionCall.args ?? {}),
            },
          ]
        : [];
    });
    const text = parts
      .flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const part = item as Record<string, unknown>;
        return typeof part.text === "string" ? [part.text] : [];
      })
      .join("\n")
      .trim();
    return {
      ...(text ? { text } : {}),
      calls,
      nativeAssistant: content ?? { role: "model", parts: [] },
    };
  },
  continue(request, response, results) {
    const contents = Array.isArray(request.body.contents)
      ? request.body.contents
      : [];
    return {
      ...request,
      body: {
        ...request.body,
        contents: [
          ...contents,
          response.nativeAssistant,
          {
            role: "user",
            parts: results.map(({ call, output }) => ({
              functionResponse: {
                name: call.name,
                response: { output },
              },
            })),
          },
        ],
      },
    };
  },
};

function adapterFor(route: ModelRoute): ProtocolAdapter {
  if (route.protocol === "openai-responses") return openAiResponsesAdapter;
  if (route.protocol === "openai-completions") return openAiCompletionsAdapter;
  if (route.protocol === "anthropic-messages") return anthropicMessagesAdapter;
  if (route.protocol === "google-generative-ai")
    return googleGenerativeAiAdapter;
  throw new Error("conversation_route_unsupported");
}

function decodeBase64Utf8(value: string): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(value.replaceAll("\n", "")), (character) =>
        character.charCodeAt(0),
      ),
    );
  } catch {
    return undefined;
  }
}

export async function executeRepositoryTool(
  github: GitHubApi,
  conversation: Pick<Conversation, "repository" | "sourceCommit">,
  call: Pick<FunctionCall, "name" | "arguments">,
): Promise<string> {
  let input: unknown;
  try {
    input = JSON.parse(call.arguments);
  } catch {
    return JSON.stringify({ error: "invalid_arguments" });
  }
  if (call.name === "list_repository_files") {
    if (!input || typeof input !== "object" || Object.keys(input).length)
      return JSON.stringify({ error: "invalid_arguments" });
    const commit = await github.get<{ tree?: { sha?: string } }>(
      `/repos/${conversation.repository.name}/git/commits/${encodeURIComponent(conversation.sourceCommit)}`,
    );
    if (typeof commit.tree?.sha !== "string")
      return JSON.stringify({ error: "tree_unavailable" });
    const tree = await github.get<{
      truncated?: boolean;
      tree?: readonly { path?: string; type?: string }[];
    }>(
      `/repos/${conversation.repository.name}/git/trees/${encodeURIComponent(commit.tree.sha)}?recursive=1`,
    );
    const paths = (tree.tree ?? [])
      .filter(
        (entry) => entry.type === "blob" && typeof entry.path === "string",
      )
      .map((entry) => entry.path!)
      .slice(0, maxTreePaths);
    const result = JSON.stringify({
      paths,
      truncated: Boolean(tree.truncated) || paths.length === maxTreePaths,
    });
    return new TextEncoder().encode(result).byteLength <= maxTreeOutputBytes
      ? result
      : JSON.stringify({ paths: paths.slice(0, 750), truncated: true });
  }
  if (call.name === "read_repository_file") {
    if (
      !input ||
      typeof input !== "object" ||
      Object.keys(input).some((key) => key !== "path") ||
      !("path" in input) ||
      typeof input.path !== "string"
    )
      return JSON.stringify({ error: "invalid_arguments" });
    let path: string;
    try {
      path = normalizeRepositoryPath(input.path);
    } catch {
      return JSON.stringify({ error: "invalid_path" });
    }
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const file = await github.get<{
      type?: string;
      encoding?: string;
      content?: string;
      size?: number;
    }>(
      `/repos/${conversation.repository.name}/contents/${encodedPath}?ref=${encodeURIComponent(conversation.sourceCommit)}`,
    );
    if (
      file.type !== "file" ||
      file.encoding !== "base64" ||
      typeof file.content !== "string"
    )
      return JSON.stringify({ error: "file_unavailable" });
    if ((file.size ?? 0) > maxFileBytes)
      return JSON.stringify({ error: "file_too_large" });
    const content = decodeBase64Utf8(file.content);
    if (content === undefined || content.includes("\0"))
      return JSON.stringify({ error: "file_not_utf8_text" });
    if (new TextEncoder().encode(content).byteLength > maxFileBytes)
      return JSON.stringify({ error: "file_too_large" });
    return JSON.stringify({ path, content });
  }
  return JSON.stringify({ error: "tool_not_allowed" });
}

function conversationInstructions(conversation: Conversation): string {
  return [
    "You are Roundhouse's conversational planning assistant.",
    "Help the user understand the repository, explore options, and turn an idea into a clear implementation request only when they explicitly decide to build it.",
    "Treat questions as questions. Do not imply that discussion has started delivery.",
    "You are read-only: you cannot edit files, run commands, create issues, start runs, or perform external mutations. Never claim that you did.",
    "Use repository tools when repository facts matter. You may use hosted public web research when current external facts matter.",
    `Repository: ${conversation.repository.name}`,
    `Snapshotted branch: ${conversation.context.defaultBranch}`,
    `Snapshotted commit: ${conversation.sourceCommit}`,
    ...(conversation.context.projectInstructions
      ? ["Repository instructions:", conversation.context.projectInstructions]
      : []),
  ].join("\n\n");
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function usageForResponse(input: {
  readonly value: Record<string, unknown>;
  readonly route: ModelRoute;
  readonly conversation: Conversation;
  readonly turn: ConversationTurn;
  readonly callKind: ConversationCallUsage["callKind"];
  readonly latencyMs: number;
  readonly outcome: ConversationCallUsage["outcome"];
}): ConversationCallUsage {
  const value = input.value;
  const usage = (value.usage ?? value.usageMetadata ?? {}) as Record<
    string,
    unknown
  >;
  const inputDetails = (usage.input_tokens_details ??
    usage.prompt_tokens_details ??
    {}) as Record<string, unknown>;
  const outputDetails = (usage.output_tokens_details ??
    usage.completion_tokens_details ??
    {}) as Record<string, unknown>;
  const inputTokens = number(
    usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount,
  );
  const cachedInputTokens = number(
    inputDetails.cached_tokens ??
      usage.cache_read_input_tokens ??
      usage.prompt_cache_hit_tokens ??
      usage.cachedContentTokenCount,
  );
  const cacheCreationInputTokens = number(
    inputDetails.cache_creation_tokens ??
      inputDetails.cache_write_tokens ??
      usage.cache_creation_input_tokens,
  );
  const outputTokens = number(
    usage.output_tokens ??
      usage.completion_tokens ??
      usage.candidatesTokenCount,
  );
  const reasoningTokens = number(
    outputDetails.reasoning_tokens ?? usage.thoughtsTokenCount,
  );
  const totalTokens =
    number(usage.total_tokens ?? usage.totalTokenCount) ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);
  const model = normalizeModelId({
    model:
      typeof value.model === "string"
        ? value.model
        : typeof value.modelVersion === "string"
          ? value.modelVersion
          : input.route.model,
    provider: input.route.provider,
    configuredModel: input.turn.configuredModel,
  });
  const directCost = number(usage.cost_usd ?? usage.cost ?? value.cost_usd);
  const costUsd = estimateModelCostUsd({
    model,
    configuredModel: input.turn.configuredModel,
    provider: input.route.provider,
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    outputTokens,
    directCostUsd: directCost,
  });
  const callId =
    typeof value.id === "string"
      ? value.id
      : typeof value.responseId === "string"
        ? value.responseId
        : crypto.randomUUID();
  return {
    callId,
    provider: input.route.provider,
    conversationId: input.conversation.id,
    turnId: input.turn.id,
    callKind: input.callKind,
    model,
    configuredModel: input.turn.configuredModel,
    protocol: input.route.protocol,
    reasoningLevel: input.route.thinkingLevel,
    routingRule: input.route.rule,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(cacheCreationInputTokens === undefined
      ? {}
      : { cacheCreationInputTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(costUsd === undefined ? {} : { costUsd }),
    latencyMs: input.latencyMs,
    outcome: input.outcome,
    createdAt: Date.now(),
  };
}

export class ConversationModelCallError extends Error {
  constructor(
    message: string,
    readonly usage: ConversationCallUsage,
  ) {
    super(message);
  }
}

async function callModel(input: {
  readonly broker: Broker;
  readonly route: ModelRoute;
  readonly request: ModelRequest;
  readonly research: boolean;
  readonly conversation: Conversation;
  readonly turn: ConversationTurn;
  readonly callKind: ConversationCallUsage["callKind"];
}): Promise<{
  readonly value: Record<string, unknown>;
  readonly usage: ConversationCallUsage;
}> {
  const startedAt = Date.now();
  const response = await input.broker.fetch(
    new Request(`https://broker.roundhouse.internal${input.request.endpoint}`, {
      method: "POST",
      headers: brokerHeaders(
        input.route,
        input.research,
        input.conversation,
        input.turn,
      ),
      body: JSON.stringify(input.request.body),
    }),
  );
  let value: Record<string, unknown> = {};
  try {
    value = (await response.json()) as Record<string, unknown>;
  } catch {
    value = {};
  }
  const usage = usageForResponse({
    value,
    route: input.route,
    conversation: input.conversation,
    turn: input.turn,
    callKind: input.callKind,
    latencyMs: Date.now() - startedAt,
    outcome: response.ok ? "succeeded" : "failed",
  });
  if (!response.ok) {
    console.error(
      JSON.stringify({
        message: "conversation_model_response_rejected",
        conversationId: input.conversation.id,
        turnId: input.turn.id,
        callKind: input.callKind,
        status: response.status,
        provider: input.route.provider,
        model: input.route.model,
        protocol: input.route.protocol,
        transport: input.route.transport ?? null,
        rule: input.route.rule,
        latencyMs: Date.now() - startedAt,
        ...brokerFailureFields(response.headers),
        ...conversationModelErrorFields(value),
      }),
    );
    throw new ConversationModelCallError(
      `conversation_model_http_${response.status}`,
      usage,
    );
  }
  return { value, usage };
}

export interface ConversationFirstReply {
  readonly title: string;
  readonly reply: string;
}

export interface ConversationExecutionResult {
  readonly route: ModelRoute;
  readonly text?: string;
  readonly firstReply?: ConversationFirstReply;
  readonly brief?: Omit<
    DeliveryBrief,
    | "id"
    | "revision"
    | "state"
    | "body"
    | "sourceCommit"
    | "createdAt"
    | "updatedAt"
  >;
  readonly usage: readonly ConversationCallUsage[];
}

const firstReplySchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "reply"],
  properties: {
    title: { type: "string" },
    reply: { type: "string" },
  },
} as const;

const briefSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "outcome",
    "acceptanceCriteria",
    "constraints",
    "evidence",
    "uncertainties",
  ],
  properties: {
    title: { type: "string" },
    outcome: { type: "string" },
    acceptanceCriteria: { type: "array", items: { type: "string" } },
    constraints: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
    uncertainties: { type: "array", items: { type: "string" } },
  },
} as const;

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function parseBrief(text: string): ConversationExecutionResult["brief"] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("delivery_brief_invalid");
  }
  const acceptanceCriteria = stringArray(parsed.acceptanceCriteria);
  const constraints = stringArray(parsed.constraints);
  const evidence = stringArray(parsed.evidence);
  const uncertainties = stringArray(parsed.uncertainties);
  if (
    typeof parsed.title !== "string" ||
    !parsed.title.trim() ||
    parsed.title.length > 100 ||
    typeof parsed.outcome !== "string" ||
    !parsed.outcome.trim() ||
    !acceptanceCriteria ||
    !constraints ||
    !evidence ||
    !uncertainties
  )
    throw new Error("delivery_brief_invalid");
  return {
    title: parsed.title.trim(),
    outcome: parsed.outcome.trim(),
    acceptanceCriteria,
    constraints,
    evidence,
    uncertainties,
  };
}

function titleWordCount(title: string): number {
  return title.split(/\s+/u).filter(Boolean).length;
}

function parseFirstReply(text: string): ConversationFirstReply {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("conversation_first_reply_invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("conversation_first_reply_invalid");
  const parsed = value as Record<string, unknown>;
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
  const firstLetter = title.match(/\p{L}/u)?.[0];
  if (
    !title ||
    !reply ||
    title.length > 80 ||
    titleWordCount(title) < 4 ||
    titleWordCount(title) > 10 ||
    !firstLetter ||
    firstLetter === firstLetter.toLocaleLowerCase() ||
    /\p{P}$/u.test(title)
  )
    throw new Error("conversation_first_reply_invalid");
  return { title, reply };
}

export async function executeConversationTurn(
  broker: Broker,
  github: GitHubApi,
  conversation: Conversation,
  turn: ConversationTurn,
  renew?: () => Promise<unknown>,
): Promise<ConversationExecutionResult> {
  const route = await resolveConversationRoute(broker, conversation);
  const adapter = adapterFor(route);
  const callKind = turn.kind === "brief" ? "delivery_brief" : "conversation";
  const firstMessageTurn = turn.kind === "message" && turn.ordinal === 1;
  const structuredOutput =
    turn.kind === "brief"
      ? { name: "delivery_brief", schema: briefSchema }
      : firstMessageTurn
        ? { name: "conversation_first_reply", schema: firstReplySchema }
        : undefined;
  let request = adapter.initial({
    route,
    instructions:
      turn.kind === "brief"
        ? [
            "Convert the conversation into a concise implementation brief.",
            "Record only decisions supported by the transcript. Do not invent requirements.",
            "Put unresolved questions in uncertainties.",
            "The title must be an imperative GitHub issue title no longer than 100 characters.",
            "Evidence should identify the decisions or repository facts supporting the brief.",
          ].join("\n")
        : [
            conversationInstructions(conversation),
            ...(firstMessageTurn
              ? [
                  [
                    "Return a JSON object with title and reply for this first response.",
                    "The title must summarize the user's central question or desired outcome, not truncate or copy their opening words.",
                    "Use sentence case with 4–10 words, no more than 80 characters, and no terminal punctuation.",
                    "Put your normal helpful response in reply.",
                  ].join("\n"),
                ]
              : []),
          ].join("\n\n"),
    messages: conversation.messages,
    tools: turn.kind === "message" ? repositoryTools : [],
    ...(structuredOutput ? { structuredOutput } : {}),
    maxOutputTokens: turn.kind === "brief" ? 4_000 : 8_000,
  });
  const usage: ConversationCallUsage[] = [];
  try {
    for (let round = 0; round <= maxToolRounds; round += 1) {
      await renew?.();
      const called = await callModel({
        broker,
        route,
        request,
        research: turn.kind === "message",
        conversation,
        turn,
        callKind,
      });
      usage.push(called.usage);
      const parsed = adapter.parse(called.value);
      if (!parsed.calls.length) {
        if (!parsed.text) throw new Error("conversation_model_output_missing");
        if (turn.kind === "brief")
          return { route, brief: parseBrief(parsed.text), usage };
        if (firstMessageTurn) {
          const validationStartedAt = Date.now();
          try {
            const firstReply = parseFirstReply(parsed.text);
            console.log(
              JSON.stringify({
                message: "conversation_first_reply_validation",
                conversationId: conversation.id,
                turnId: turn.id,
                outcome: "succeeded",
                titleLength: firstReply.title.length,
                titleWordCount: titleWordCount(firstReply.title),
                durationMs: Date.now() - validationStartedAt,
              }),
            );
            return { route, firstReply, usage };
          } catch (error) {
            console.error(
              JSON.stringify({
                message: "conversation_first_reply_validation",
                conversationId: conversation.id,
                turnId: turn.id,
                outcome: "failed",
                errorCode:
                  error instanceof Error
                    ? error.message
                    : "conversation_first_reply_invalid",
                durationMs: Date.now() - validationStartedAt,
              }),
            );
            throw error;
          }
        }
        return { route, text: parsed.text, usage };
      }
      if (turn.kind !== "message" || round === maxToolRounds)
        throw new Error("conversation_tool_round_limit");
      const results = await Promise.all(
        parsed.calls.map(async (call) => ({
          call,
          output: await executeRepositoryTool(github, conversation, call),
        })),
      );
      request = adapter.continue(request, parsed, results);
    }
    throw new Error("conversation_model_output_missing");
  } catch (error) {
    if (error instanceof ConversationModelCallError) usage.push(error.usage);
    const enriched = (
      error instanceof Error ? error : new Error("conversation_model_failed")
    ) as Error & {
      usage?: readonly ConversationCallUsage[];
      route?: ModelRoute;
    };
    enriched.usage = usage;
    enriched.route = route;
    throw enriched;
  }
}

export function promotionIssueMarker(
  conversationId: string,
  briefId: string,
): string {
  return `<!-- roundhouse:conversation:${conversationId}:brief:${briefId} -->`;
}

export function promotionStartMarker(
  conversationId: string,
  briefId: string,
): string {
  return `<!-- roundhouse:conversation-start:${conversationId}:brief:${briefId} -->`;
}

export function parsePromotionMarker(
  text: string | null | undefined,
): { readonly conversationId: string; readonly briefId: string } | undefined {
  const match = text?.match(
    /<!-- roundhouse:conversation(?:-start)?:([0-9a-f-]{36}):brief:([0-9a-f-]{36}) -->/,
  );
  return match ? { conversationId: match[1]!, briefId: match[2]! } : undefined;
}

export function renderDeliveryBrief(
  brief: Pick<DeliveryBrief, "id" | "body">,
  conversationId: string,
  conversationUrl?: string,
): string {
  return [
    promotionIssueMarker(conversationId, brief.id),
    brief.body,
    conversationUrl
      ? `_Promoted from a [private Roundhouse conversation](${conversationUrl})._`
      : "_Promoted from a private Roundhouse conversation._",
  ].join("\n");
}
