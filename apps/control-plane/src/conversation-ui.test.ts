// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
  renderConversation,
  renderConversationIndex,
  renderConversationPollState,
} from "./conversation-ui.js";
import type {
  Conversation,
  ConversationSummary,
} from "./conversation-store.js";

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
  it("renders semantic titles with escaped metadata and an untitled fallback", () => {
    const now = Date.parse("2026-08-02T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const conversations: ConversationSummary[] = [
        {
          id: base.id,
          title: "Clarify <conversation> list titles",
          repository: "octo/<project>",
          status: "open",
          updatedAt: now - 6 * 60_000,
        },
        {
          id: "d7026e8f-3e94-4bfc-8a5d-e6e5ef67f4cd",
          repository: "acme/docs",
          status: "handoff_pending",
          promotionState: "awaiting_intake",
          issueNumber: 482,
          issueUrl: "https://github.test/issues/482?label=<unsafe>&state=open",
          updatedAt: now - 3 * 60 * 60_000,
        },
        {
          id: "55f5f1d1-cf1c-4e96-8b3d-1bdf01f574b0",
          title: "Start the delivery workflow",
          repository: "acme/docs",
          status: "promoted",
          promotionState: "accepted",
          updatedAt: now - 2 * 24 * 60 * 60_000,
        },
      ];
      const html = renderConversationIndex(
        [base.repository],
        conversations,
        "octocat",
        undefined,
        "00000000-0000-4000-8000-000000000001",
      );
      expect(html).toContain(
        "<strong>Clarify &lt;conversation&gt; list titles</strong>",
      );
      expect(html).toContain("<strong>New conversation</strong>");
      expect(html).toContain("octo/&lt;project&gt;");
      expect(html).toContain('<span class="status open">Open</span>');
      expect(html).toContain(
        '<span class="status waiting">Waiting to start delivery</span>',
      );
      expect(html).toContain(
        '<span class="status succeeded">Delivery started</span>',
      );
      expect(html).toContain("Updated 6 minutes ago");
      expect(html).toContain("Updated 3 hours ago");
      expect(html).toContain("Updated 2 days ago");
      expect(html).toContain(
        ".status.waiting{background:#fff4d6;color:#8a5b00}",
      );
      expect(html).toContain(
        'href="https://github.test/issues/482?label=&lt;unsafe&gt;&amp;state=open">Issue #482</a>',
      );
      expect(html).not.toContain("<conversation>");
      expect(html).not.toContain("awaiting_intake");
      expect(html).not.toContain("UTC");
    } finally {
      vi.useRealTimers();
    }
  });

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

  it("uses same-origin partial polling for active conversations without a hard refresh", () => {
    const active = {
      ...base,
      activeTurn: {
        id: "active-turn",
        conversationId: base.id,
        kind: "message" as const,
        ordinal: 1,
        state: "running" as const,
        sourceCommit: base.sourceCommit,
        configuredModel: "openai/gpt-5.6-sol",
        configuredReasoning: "high",
        attempts: 1,
        createdAt: 2,
        updatedAt: 2,
      },
    };
    const html = renderConversation(active, "octocat");
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain("/assets/conversation-poll.js");
    expect(html).toContain(`/conversations/${base.id}/state`);
    expect(html).toContain('id="conversation-messages"');
    expect(html).toContain('data-message-id="message"');
    expect(html).toContain('id="conversation-live-status"');
    expect(html).toContain('role="status" aria-live="polite"');

    const state = renderConversationPollState(active, "message-id");
    expect(state.polling).toBe(true);
    expect(state.messages[0]).toMatchObject({ id: "message" });
    expect(state.status.key).toBe("turn:running");
  });

  it("does not start polling once a turn is terminal", () => {
    const terminal = {
      ...base,
      latestTurn: {
        id: "complete-turn",
        conversationId: base.id,
        kind: "message" as const,
        ordinal: 1,
        state: "succeeded" as const,
        sourceCommit: base.sourceCommit,
        configuredModel: "openai/gpt-5.6-sol",
        configuredReasoning: "high",
        attempts: 1,
        createdAt: 2,
        updatedAt: 3,
        completedAt: 3,
      },
    };
    expect(renderConversation(terminal, "octocat")).not.toContain(
      "conversation-poll.js",
    );
    expect(renderConversationPollState(terminal).polling).toBe(false);
  });

  it("surfaces a terminal turn failure without exposing its internal error", () => {
    const html = renderConversation(
      {
        ...base,
        latestTurn: {
          id: "failed-turn",
          conversationId: base.id,
          kind: "message",
          ordinal: 2,
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
