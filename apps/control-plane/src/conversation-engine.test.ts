// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { runtimeCapabilitiesForModel } from "@roundhouse/core";
import {
  executeConversationTurn,
  executeRepositoryTool,
  promotionIssueMarker,
  promotionStartMarker,
  renderDeliveryBrief,
  resolveConversationRoute,
} from "./conversation-engine.js";
import type { Conversation, ConversationTurn } from "./conversation-store.js";
import type { GitHubApi } from "./github.js";

const conversation: Conversation = {
  id: "b1f486ff-7744-49f9-ab78-f74e8409fc2b",
  repository: {
    id: "repo_123",
    githubId: "123",
    name: "octo/project",
    installationId: 99,
  },
  creatorGithubUserId: 7,
  creatorGithubLogin: "octocat",
  status: "open",
  sourceCommit: "a".repeat(40),
  profileHash: "b".repeat(64),
  context: {
    model: { id: "openai/gpt-5.6-sol", reasoning: "high" },
    defaultBranch: "main",
  },
  links: [],
  createdAt: 1,
  updatedAt: 1,
  messages: [
    {
      id: "message-1",
      turnId: "turn-1",
      direction: "inbound",
      role: "user",
      actorId: "7",
      actorLogin: "octocat",
      adapter: "web",
      adapterInstallation: "roundhouse-ui",
      externalConversationId: "b1f486ff-7744-49f9-ab78-f74e8409fc2b",
      externalMessageId: "external-1",
      body: "Where is the dashboard rendered?",
      createdAt: 1,
    },
  ],
};

const turn: ConversationTurn = {
  id: "turn-1",
  conversationId: conversation.id,
  triggeringMessageId: "message-1",
  kind: "message",
  state: "running",
  sourceCommit: conversation.sourceCommit,
  configuredModel: "openai/gpt-5.6-sol",
  configuredReasoning: "high",
  attempts: 1,
  createdAt: 1,
  updatedAt: 1,
};

const responsesRoute = {
  provider: "openai",
  model: "openai/gpt-5.6-sol",
  protocol: "openai-responses" as const,
  transport: "cloudflare-provider-native" as const,
  thinkingLevel: "high" as const,
  runtime: runtimeCapabilitiesForModel("openai/gpt-5.6-sol")!,
  rule: "profile-conversation-v2",
};

function broker(responses: readonly Response[]) {
  let index = 0;
  const fetch = vi.fn(async () => responses[index++]!.clone());
  return { fetch } as unknown as Pick<Fetcher, "fetch"> & {
    fetch: ReturnType<typeof vi.fn>;
  };
}

const github = { get: vi.fn() } as unknown as GitHubApi;

describe("conversation engine", () => {
  it("resolves the repository-configured route without a provider restriction", async () => {
    const route = {
      ...responsesRoute,
      provider: "anthropic",
      model: "anthropic/claude-opus-5",
      protocol: "anthropic-messages" as const,
      runtime: runtimeCapabilitiesForModel("anthropic/claude-opus-5")!,
    };
    const modelBroker = broker([Response.json(route)]);
    await expect(
      resolveConversationRoute(modelBroker, conversation),
    ).resolves.toEqual(route);
    const request = modelBroker.fetch.mock.calls[0]![0] as Request;
    await expect(request.clone().json()).resolves.toMatchObject({
      role: "conversation",
      requestedModel: "openai/gpt-5.6-sol",
      requestedReasoning: "high",
      profileHash: "b".repeat(64),
    });
  });

  it("resolves the snapshotted commit to its tree before listing files", async () => {
    const treeSha = "c".repeat(40);
    const get = vi.fn(async (path: string) => {
      if (path.includes("/git/commits/")) return { tree: { sha: treeSha } };
      expect(path).toContain(`/git/trees/${treeSha}?recursive=1`);
      return {
        tree: [
          { path: "src/index.ts", type: "blob" },
          { path: "src", type: "tree" },
        ],
      };
    });
    await expect(
      executeRepositoryTool({ get } as unknown as GitHubApi, conversation, {
        name: "list_repository_files",
        arguments: "{}",
      }),
    ).resolves.toBe(
      JSON.stringify({ paths: ["src/index.ts"], truncated: false }),
    );
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0]![0]).toContain(
      `/git/commits/${conversation.sourceCommit}`,
    );
  });

  it("allows only bounded, exact-snapshot UTF-8 repository reads", async () => {
    const get = vi.fn(async (path: string) => {
      expect(path).toContain(`/contents/src/a%23b.ts?ref=${"a".repeat(40)}`);
      return {
        type: "file",
        encoding: "base64",
        size: 15,
        content: btoa("renderDashboard"),
      };
    });
    await expect(
      executeRepositoryTool({ get } as unknown as GitHubApi, conversation, {
        name: "read_repository_file",
        arguments: JSON.stringify({ path: "src/a#b.ts" }),
      }),
    ).resolves.toBe(
      JSON.stringify({ path: "src/a#b.ts", content: "renderDashboard" }),
    );
    await expect(
      executeRepositoryTool({ get } as unknown as GitHubApi, conversation, {
        name: "read_repository_file",
        arguments: JSON.stringify({ path: "../secret" }),
      }),
    ).resolves.toBe(JSON.stringify({ error: "invalid_path" }));
    await expect(
      executeRepositoryTool({ get } as unknown as GitHubApi, conversation, {
        name: "create_issue",
        arguments: "{}",
      }),
    ).resolves.toBe(JSON.stringify({ error: "tool_not_allowed" }));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("executes a Responses tool loop and records every model call", async () => {
    const modelBroker = broker([
      Response.json(responsesRoute),
      Response.json({
        id: "response-1",
        output: [
          {
            type: "function_call",
            name: "read_repository_file",
            arguments: '{"path":"src/dashboard.ts"}',
            call_id: "call-1",
          },
        ],
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      }),
      Response.json({
        id: "response-2",
        output_text: "The dashboard is rendered there.",
        usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
      }),
    ]);
    const repositoryApi = {
      get: vi.fn(async () => ({
        type: "file",
        encoding: "base64",
        size: 4,
        content: btoa("body"),
      })),
    } as unknown as GitHubApi;
    await expect(
      executeConversationTurn(modelBroker, repositoryApi, conversation, turn),
    ).resolves.toMatchObject({
      text: "The dashboard is rendered there.",
      usage: [{ totalTokens: 12 }, { totalTokens: 20 }],
    });
    const firstModelRequest = modelBroker.fetch.mock.calls[1]![0] as Request;
    expect(firstModelRequest.headers.get("authorization")).toBeNull();
    expect(firstModelRequest.headers.get("x-roundhouse-research")).toBe(
      "enabled",
    );
    const continuedBody = (await (
      modelBroker.fetch.mock.calls[2]![0] as Request
    )
      .clone()
      .json()) as {
      input: readonly { type?: string; call_id?: string }[];
    };
    expect(continuedBody.input).toContainEqual(
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call-1",
      }),
    );
  });

  it.each([
    [
      "openai-completions",
      {
        choices: [{ message: { role: "assistant", content: "Chat answer" } }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      },
      "Chat answer",
    ],
    [
      "anthropic-messages",
      {
        content: [{ type: "text", text: "Anthropic answer" }],
        usage: { input_tokens: 3, output_tokens: 4 },
      },
      "Anthropic answer",
    ],
    [
      "google-generative-ai",
      {
        candidates: [
          { content: { role: "model", parts: [{ text: "Google answer" }] } },
        ],
        usageMetadata: {
          promptTokenCount: 4,
          candidatesTokenCount: 5,
          totalTokenCount: 9,
        },
      },
      "Google answer",
    ],
  ] as const)(
    "supports the %s protocol adapter",
    async (protocol, response, expected) => {
      const route = { ...responsesRoute, protocol, model: `${protocol}/model` };
      const modelBroker = broker([
        Response.json(route),
        Response.json(response),
      ]);
      await expect(
        executeConversationTurn(modelBroker, github, conversation, turn),
      ).resolves.toMatchObject({
        text: expected,
        route: { protocol },
      });
    },
  );

  it("creates a validated editable brief and deterministic promotion markers", async () => {
    const brief = {
      title: "Add conversational entry",
      outcome: "Let users clarify work before delivery.",
      acceptanceCriteria: ["Questions remain read-only"],
      constraints: ["No shell access"],
      evidence: ["The web UI is the first adapter"],
      uncertainties: [],
    };
    const modelBroker = broker([
      Response.json(responsesRoute),
      Response.json({
        output_text: JSON.stringify(brief),
        usage: { total_tokens: 10 },
      }),
    ]);
    const result = await executeConversationTurn(
      modelBroker,
      github,
      conversation,
      {
        ...turn,
        id: "turn-brief",
        kind: "brief",
        triggeringMessageId: undefined,
      },
    );
    expect(result.brief).toEqual(brief);
    const identified = { id: "47cff616-eaaa-46fd-870f-dd5cf3c674d8", ...brief };
    const rendered = renderDeliveryBrief(identified, conversation.id);
    expect(rendered).toContain(
      promotionIssueMarker(conversation.id, identified.id),
    );
    expect(promotionStartMarker(conversation.id, identified.id)).toContain(
      "conversation-start",
    );
    expect(rendered).toContain("- Questions remain read-only");
    const request = modelBroker.fetch.mock.calls[1]![0] as Request;
    expect(request.headers.get("x-roundhouse-research")).toBe("disabled");
  });

  it("attaches successful-call usage when later output validation fails", async () => {
    const modelBroker = broker([
      Response.json(responsesRoute),
      Response.json({ output_text: "not-json", usage: { total_tokens: 7 } }),
    ]);
    await expect(
      executeConversationTurn(modelBroker, github, conversation, {
        ...turn,
        kind: "brief",
      }),
    ).rejects.toMatchObject({
      message: "delivery_brief_invalid",
      usage: [{ totalTokens: 7 }],
    });
  });

  it("clamps cached tokens when estimating cost from malformed usage", async () => {
    const modelBroker = broker([
      Response.json(responsesRoute),
      Response.json({
        id: "response-malformed-cache",
        output_text: "Cached answer",
        usage: {
          input_tokens: 1,
          input_tokens_details: { cached_tokens: 1_000 },
          output_tokens: 0,
          total_tokens: 1,
        },
      }),
    ]);
    const result = await executeConversationTurn(
      modelBroker,
      github,
      conversation,
      turn,
    );
    expect(result.usage[0]).toMatchObject({
      inputTokens: 1,
      cachedInputTokens: 1_000,
    });
    expect(result.usage[0]!.costUsd).toBeCloseTo(0.000000175, 12);
  });
});
