// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  isModelRoute,
  normalizeRepositoryPath,
  type ModelRoute,
} from "@roundhouse/core";
import type {
  Conversation,
  ConversationMessage,
  DeliveryBrief,
} from "./conversation-store.js";
import type { GitHubApi } from "./github.js";

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

const repositoryTools = [
  {
    type: "function",
    name: "list_repository_files",
    description:
      "List file paths from the repository commit snapshotted for this conversation.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {},
    },
  },
  {
    type: "function",
    name: "read_repository_file",
    description:
      "Read one UTF-8 text file from the repository commit snapshotted for this conversation.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string", minLength: 1, maxLength: 500 },
      },
    },
  },
] as const;

function brokerHeaders(route: ModelRoute, research: boolean): Headers {
  const headers = new Headers({
    "content-type": "application/json",
    "x-roundhouse-research": research ? "enabled" : "disabled",
  });
  headers.set(routeHeaders.provider, route.provider);
  headers.set(routeHeaders.model, route.model);
  headers.set(routeHeaders.protocol, route.protocol);
  if (route.transport) headers.set(routeHeaders.transport, route.transport);
  headers.set(routeHeaders.thinkingLevel, route.thinkingLevel);
  headers.set(routeHeaders.rule, route.rule);
  return headers;
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
  if (!isModelRoute(route) || route.protocol !== "openai-responses")
    throw new Error("conversation_route_unsupported");
  return route;
}

function responseText(value: Record<string, unknown>): string | undefined {
  if (typeof value.output_text === "string" && value.output_text.trim())
    return value.output_text.trim();
  if (!Array.isArray(value.output)) return undefined;
  const text = value.output.flatMap((item) => {
    if (!item || typeof item !== "object" || !("content" in item)) return [];
    const content = Array.isArray(item.content) ? item.content : [];
    return content.flatMap((part: unknown) =>
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "output_text" &&
      "text" in part &&
      typeof part.text === "string"
        ? [part.text]
        : [],
    );
  });
  return text.join("\n").trim() || undefined;
}

type FunctionCall = {
  readonly type: "function_call";
  readonly name: string;
  readonly arguments: string;
  readonly call_id: string;
};

function functionCalls(
  value: Record<string, unknown>,
): readonly FunctionCall[] {
  if (!Array.isArray(value.output)) return [];
  return value.output.filter((item): item is FunctionCall => {
    if (!item || typeof item !== "object") return false;
    const call = item as Record<string, unknown>;
    return (
      call.type === "function_call" &&
      typeof call.name === "string" &&
      typeof call.arguments === "string" &&
      typeof call.call_id === "string"
    );
  });
}

function decodeBase64(value: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(value.replaceAll("\n", "")), (character) =>
      character.charCodeAt(0),
    ),
  );
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
    const tree = await github.get<{
      truncated?: boolean;
      tree?: readonly { path?: string; type?: string }[];
    }>(
      `/repos/${conversation.repository.name}/git/trees/${encodeURIComponent(conversation.sourceCommit)}?recursive=1`,
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
    const file = await github.get<{
      type?: string;
      encoding?: string;
      content?: string;
      size?: number;
    }>(
      `/repos/${conversation.repository.name}/contents/${path}?ref=${encodeURIComponent(conversation.sourceCommit)}`,
    );
    if (
      file.type !== "file" ||
      file.encoding !== "base64" ||
      typeof file.content !== "string"
    )
      return JSON.stringify({ error: "file_unavailable" });
    if ((file.size ?? 0) > maxFileBytes)
      return JSON.stringify({ error: "file_too_large" });
    const content = decodeBase64(file.content);
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

function transcript(messages: readonly ConversationMessage[]) {
  let remaining = maxTranscriptCharacters;
  const selected: ConversationMessage[] = [];
  for (const message of [...messages].reverse()) {
    if (remaining <= 0) break;
    const body = message.body.slice(-remaining);
    selected.push({ ...message, body });
    remaining -= body.length;
  }
  return selected.reverse().map((message) => ({
    role: message.role,
    content: message.body,
  }));
}

async function responsesCall(
  broker: Broker,
  route: ModelRoute,
  body: Record<string, unknown>,
  research: boolean,
): Promise<Record<string, unknown>> {
  const response = await broker.fetch(
    new Request("https://broker.roundhouse.internal/v1/responses", {
      method: "POST",
      headers: brokerHeaders(route, research),
      body: JSON.stringify(body),
    }),
  );
  if (!response.ok)
    throw new Error(`conversation_model_http_${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

export async function executeConversationTurn(
  broker: Broker,
  github: GitHubApi,
  conversation: Conversation,
): Promise<string> {
  const route = await resolveConversationRoute(broker, conversation);
  let input: unknown[] = transcript(conversation.messages);
  for (let round = 0; round <= maxToolRounds; round += 1) {
    const value = await responsesCall(
      broker,
      route,
      {
        instructions: conversationInstructions(conversation),
        input,
        tools: repositoryTools,
        tool_choice: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
        max_output_tokens: 8_000,
        ...(route.thinkingLevel === "off"
          ? {}
          : { reasoning: { effort: route.thinkingLevel } }),
      },
      true,
    );
    const calls = functionCalls(value);
    if (!calls.length) {
      const text = responseText(value);
      if (!text) throw new Error("conversation_model_output_missing");
      return text;
    }
    if (round === maxToolRounds)
      throw new Error("conversation_tool_round_limit");
    const output = Array.isArray(value.output) ? value.output : [];
    const results = await Promise.all(
      calls.map(async (call) => ({
        type: "function_call_output",
        call_id: call.call_id,
        output: await executeRepositoryTool(github, conversation, call),
      })),
    );
    input = [...input, ...output, ...results];
  }
  throw new Error("conversation_model_output_missing");
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

export async function synthesizeDeliveryBrief(
  broker: Broker,
  conversation: Conversation,
): Promise<DeliveryBrief> {
  const route = await resolveConversationRoute(broker, conversation);
  const value = await responsesCall(
    broker,
    route,
    {
      instructions: [
        "Convert the conversation into a concise implementation brief.",
        "Record only decisions supported by the transcript. Put unresolved limitations in constraints or context; do not invent requirements.",
        "The title must be an imperative GitHub issue title no longer than 100 characters.",
      ].join("\n"),
      input: transcript(conversation.messages),
      store: false,
      include: ["reasoning.encrypted_content"],
      max_output_tokens: 4_000,
      ...(route.thinkingLevel === "off"
        ? {}
        : { reasoning: { effort: route.thinkingLevel } }),
      text: {
        format: {
          type: "json_schema",
          name: "delivery_brief",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "title",
              "outcome",
              "acceptanceCriteria",
              "constraints",
              "context",
            ],
            properties: {
              title: { type: "string" },
              outcome: { type: "string" },
              acceptanceCriteria: {
                type: "array",
                items: { type: "string" },
              },
              constraints: { type: "array", items: { type: "string" } },
              context: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
    false,
  );
  const text = responseText(value);
  if (!text) throw new Error("delivery_brief_missing");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("delivery_brief_invalid");
  }
  const acceptanceCriteria = stringArray(parsed.acceptanceCriteria);
  const constraints = stringArray(parsed.constraints);
  const context = stringArray(parsed.context);
  if (
    typeof parsed.title !== "string" ||
    !parsed.title.trim() ||
    parsed.title.length > 100 ||
    typeof parsed.outcome !== "string" ||
    !parsed.outcome.trim() ||
    !acceptanceCriteria ||
    !constraints ||
    !context
  )
    throw new Error("delivery_brief_invalid");
  return {
    title: parsed.title.trim(),
    outcome: parsed.outcome.trim(),
    acceptanceCriteria,
    constraints,
    context,
  };
}

export function renderDeliveryBrief(
  brief: DeliveryBrief,
  conversationUrl?: string,
): string {
  const section = (heading: string, items: readonly string[]) =>
    items.length
      ? [`## ${heading}`, "", ...items.map((item) => `- ${item}`), ""]
      : [];
  return [
    "<!-- roundhouse:conversation-promotion:v0 -->",
    "## Outcome",
    "",
    brief.outcome,
    "",
    ...section("Acceptance criteria", brief.acceptanceCriteria),
    ...section("Constraints", brief.constraints),
    ...section("Context", brief.context),
    conversationUrl
      ? `_Promoted from a [private Roundhouse conversation](${conversationUrl})._`
      : "_Promoted from a private Roundhouse conversation._",
  ].join("\n");
}
