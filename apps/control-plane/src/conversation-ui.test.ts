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
  links: [],
  createdAt: 1,
  updatedAt: 1,
  messages: [
    {
      id: "message",
      turnId: "turn",
      direction: "inbound",
      adapter: "web",
      adapterInstallation: "roundhouse-ui",
      externalConversationId: "b1f486ff-7744-49f9-ab78-f74e8409fc2b",
      externalMessageId: "external-message",
      actorId: "7",
      actorLogin: "octocat",
      role: "user",
      body: "Is <script>alert(1)</script> a question?",
      createdAt: 1,
    },
  ],
};

describe("conversation UI", () => {
  it("renders a private, read-only thread without trusting message HTML", () => {
    const html = renderConversation(base, "octocat");
    expect(html).toContain("Prepare delivery brief");
    expect(html).toContain("cannot modify anything");
    expect(html).toContain("Continue the conversation");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("renders an editable draft while still allowing more conversation", () => {
    const html = renderConversation(
      {
        ...base,
        currentBrief: {
          id: "47cff616-eaaa-46fd-870f-dd5cf3c674d8",
          revision: 1,
          state: "draft",
          title: "Build <carefully>",
          outcome: "Add the agreed flow.",
          acceptanceCriteria: ["The user confirms"],
          constraints: ["No shell"],
          evidence: ["Web UI first"],
          uncertainties: ["None"],
          sourceCommit: base.sourceCommit,
          createdAt: 2,
          updatedAt: 2,
        },
      },
      "octocat",
    );
    expect(html).toContain("Review and edit delivery brief");
    expect(html).toContain("Start delivery");
    expect(html).toContain("Build &lt;carefully&gt;");
    expect(html).toContain("Continue the conversation");
  });

  it("closes the conversation only after webhook-confirmed intake", () => {
    const pending = renderConversation(
      {
        ...base,
        status: "handoff_pending",
        promotion: {
          id: "promotion",
          briefId: "brief",
          state: "awaiting_intake",
          actorGithubUserId: 7,
          actorGithubLogin: "octocat",
          issueNumber: 42,
          issueUrl: "https://github.test/octo/project/issues/42",
          createdAt: 2,
          updatedAt: 2,
        },
      },
      "octocat",
    );
    expect(pending).toContain("Waiting for Roundhouse intake");
    expect(pending).not.toContain("Delivery started");

    const promoted = renderConversation(
      {
        ...base,
        status: "promoted",
        promotion: {
          id: "promotion",
          briefId: "brief",
          state: "accepted",
          actorGithubUserId: 7,
          actorGithubLogin: "octocat",
          issueNumber: 42,
          issueUrl: "https://github.test/octo/project/issues/42",
          runId: "run-42",
          createdAt: 2,
          updatedAt: 3,
          completedAt: 3,
        },
        links: [
          {
            kind: "roundhouse.run",
            externalId: "run-42",
            url: "https://roundhouse.test/repositories/octo/project/issues/42",
            createdAt: 3,
          },
        ],
      },
      "octocat",
    );
    expect(promoted).toContain("Delivery started");
    expect(promoted).toContain("Open Roundhouse run");
    expect(promoted).not.toContain("Continue the conversation");
  });

  it("surfaces a terminal turn failure without exposing its internal error", () => {
    const html = renderConversation(
      {
        ...base,
        latestTurn: {
          id: "failed-turn",
          conversationId: base.id,
          kind: "message",
          state: "failed",
          sourceCommit: base.sourceCommit,
          configuredModel: "unapproved/model",
          configuredReasoning: "high",
          attempts: 5,
          errorCode: "sensitive_upstream_detail",
          createdAt: 2,
          updatedAt: 3,
          completedAt: 3,
        },
      },
      "octocat",
    );
    expect(html).toContain("could not complete the last reply");
    expect(html).toContain("Continue the conversation");
    expect(html).not.toContain("sensitive_upstream_detail");
  });
});
