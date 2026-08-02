// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { renderConversation } from "./conversation-ui.js";
import type { Conversation } from "./conversation-store.js";

const base: Conversation = {
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
      id: "message",
      turnId: "turn",
      adapter: "web",
      role: "user",
      body: "Is <script>alert(1)</script> a question?",
      createdAt: 1,
    },
  ],
};

describe("conversation UI", () => {
  it("renders an open read-only thread without trusting message HTML", () => {
    const html = renderConversation(base, "octocat");
    expect(html).toContain("Prepare delivery brief");
    expect(html).toContain("cannot modify anything");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("requires review of the frozen brief before start delivery", () => {
    const html = renderConversation(
      {
        ...base,
        status: "ready",
        deliveryBrief: {
          title: "Build <carefully>",
          outcome: "Add the agreed flow.",
          acceptanceCriteria: ["The user confirms"],
          constraints: ["No shell"],
          context: [],
        },
      },
      "octocat",
    );
    expect(html).toContain("Review delivery brief");
    expect(html).toContain("Start delivery");
    expect(html).toContain("Build &lt;carefully&gt;");
    expect(html).not.toContain("Continue the conversation");
  });
});
