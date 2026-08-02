// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
  executeConversationTurn,
  executeRepositoryTool,
  renderDeliveryBrief,
  resolveConversationRoute,
  synthesizeDeliveryBrief,
} from "./conversation-engine.js";
import type { Conversation } from "./conversation-store.js";
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
  createdAt: 1,
  updatedAt: 1,
  messages: [
    {
      id: "message-1",
      turnId: "turn-1",
      role: "user",
      adapter: "web",
      body: "Where is the dashboard rendered?",
      createdAt: 1,
    },
  ],
};

const route = {
  provider: "openai",
  model: "openai/gpt-5.6-sol",
  protocol: "openai-responses" as const,
  transport: "cloudflare-provider-native" as const,
  thinkingLevel: "high" as const,
  rule: "profile-conversation-v2",
};

function broker(responses: readonly Response[]) {
  let index = 0;
  const fetch = vi.fn(async () => responses[index++]!.clone());
  return { fetch } as unknown as Pick<Fetcher, "fetch"> & {
    fetch: ReturnType<typeof vi.fn>;
  };
}

describe("conversation engine", () => {
  it("resolves the repository-configured route", async () => {
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

  it("allows only bounded snapshot repository reads", async () => {
    const get = vi.fn(async (path: string) => {
      expect(path).toContain(
        `/contents/src/dashboard.ts?ref=${"a".repeat(40)}`,
      );
      return {
        type: "file",
        encoding: "base64",
        size: 13,
        content: btoa("renderDashboard"),
      };
    });
    const output = await executeRepositoryTool(
      { get } as unknown as GitHubApi,
      conversation,
      {
        name: "read_repository_file",
        arguments: JSON.stringify({ path: "src/dashboard.ts" }),
      },
    );
    expect(JSON.parse(output)).toEqual({
      path: "src/dashboard.ts",
      content: "renderDashboard",
    });

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

  it("executes a repository tool loop without exposing credentials", async () => {
    const modelBroker = broker([
      Response.json(route),
      Response.json({
        output: [
          {
            type: "function_call",
            name: "read_repository_file",
            arguments: '{"path":"src/dashboard.ts"}',
            call_id: "call-1",
          },
        ],
      }),
      Response.json({ output_text: "The dashboard is rendered there." }),
    ]);
    const github = {
      get: vi.fn(async () => ({
        type: "file",
        encoding: "base64",
        size: 4,
        content: btoa("body"),
      })),
    } as unknown as GitHubApi;
    await expect(
      executeConversationTurn(modelBroker, github, conversation),
    ).resolves.toBe("The dashboard is rendered there.");
    const modelRequest = modelBroker.fetch.mock.calls[1]![0] as Request;
    expect(modelRequest.headers.get("authorization")).toBeNull();
    expect(modelRequest.headers.get("x-roundhouse-research")).toBe("enabled");
    await expect(modelRequest.clone().json()).resolves.toMatchObject({
      reasoning: { effort: "high" },
      store: false,
    });
    const continued = modelBroker.fetch.mock.calls[2]![0] as Request;
    const continuedBody = (await continued.clone().json()) as {
      input: readonly { type?: string; call_id?: string; output?: string }[];
    };
    expect(continuedBody.input).toContainEqual(
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call-1",
      }),
    );
  });

  it("produces and renders a validated delivery brief", async () => {
    const brief = {
      title: "Add conversational entry",
      outcome: "Let users clarify work before delivery.",
      acceptanceCriteria: ["Questions remain read-only"],
      constraints: ["No shell access"],
      context: ["The web UI is the first adapter"],
    };
    const modelBroker = broker([
      Response.json(route),
      Response.json({ output_text: JSON.stringify(brief) }),
    ]);
    await expect(
      synthesizeDeliveryBrief(modelBroker, conversation),
    ).resolves.toEqual(brief);
    expect(renderDeliveryBrief(brief)).toContain(
      "<!-- roundhouse:conversation-promotion:v0 -->",
    );
    expect(renderDeliveryBrief(brief)).toContain(
      "- Questions remain read-only",
    );
    const request = modelBroker.fetch.mock.calls[1]![0] as Request;
    expect(request.headers.get("x-roundhouse-research")).toBe("disabled");
  });
});
