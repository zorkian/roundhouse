// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
  actionableConversationStatus,
  renderConversation,
  renderConversationIndex,
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
      expect(html).toContain(
        '<span class="status waiting">Waiting for your response</span>',
      );
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

  it("selects actionable states in precedence order", () => {
    const cases = [
      [
        "completed delivery overrides every conversation state",
        {
          status: "open" as const,
          promotionState: "accepted" as const,
          promotionRunStatus: "succeeded" as const,
          currentBriefState: "draft" as const,
          activeTurnState: "running" as const,
          latestTurnState: "failed" as const,
        },
        "Delivery complete",
      ],
      [
        "active delivery is started",
        {
          status: "promoted" as const,
          promotionState: "accepted" as const,
          promotionRunStatus: "waiting" as const,
        },
        "Delivery started",
      ],
      [
        "brief review overrides active work",
        {
          status: "open" as const,
          currentBriefState: "draft" as const,
          activeTurnState: "running" as const,
        },
        "Delivery brief ready for review",
      ],
      [
        "active work overrides failed-turn attention",
        {
          status: "open" as const,
          activeTurnState: "pending" as const,
          latestTurnState: "failed" as const,
        },
        "Roundhouse is working",
      ],
      [
        "failed turns need attention before user response",
        { status: "open" as const, latestTurnState: "failed" as const },
        "Needs attention",
      ],
      [
        "waiting user response is the fallback",
        { status: "open" as const },
        "Waiting for your response",
      ],
    ] as const;
    for (const [, input, label] of cases)
      expect(actionableConversationStatus(input).label).toBe(label);
  });

  it("renders a private, read-only thread without trusting message HTML", () => {
    const html = renderConversation(base, "octocat");
    expect(html).toContain("Prepare delivery brief");
    expect(html).toContain("Waiting for your response");
    expect(html).toContain("cannot modify anything");
    expect(html).toContain("Continue the conversation");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("renders Markdown for user and assistant messages", () => {
    const userMessage = base.messages[0]!;
    const logs: unknown[] = [];
    const originalLog = console.log;
    let html = "";
    console.log = (line: string) => logs.push(JSON.parse(line));
    try {
      html = renderConversation(
        {
          ...base,
          messages: [
            {
              ...userMessage,
              body: "# User heading\n\nA **bold** and *emphasized* line.\nA second line.\n\n- one\n- two\n\n[Roundhouse](https://example.test/docs)\n\n```ts\nconst answer = 42;\n```",
            },
            {
              ...userMessage,
              id: "assistant-message",
              direction: "outbound",
              role: "assistant",
              actorId: "roundhouse",
              actorLogin: "Roundhouse",
              body: "## Assistant heading\n\n1. first\n2. second\n\n[Email](mailto:hello@example.test)",
            },
          ],
        },
        "octocat",
      );
    } finally {
      console.log = originalLog;
    }

    expect(html).toContain('<article class="message user">');
    expect(html).toContain('<article class="message assistant">');
    expect(html).toContain('<div class="message-body"><h1>User heading</h1>');
    expect(html).toContain("<h2>Assistant heading</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>emphasized</em>");
    expect(html).toContain("line.<br>A second line.");
    expect(html).toContain("<ul>\n<li>one</li>");
    expect(html).toContain("<ol>\n<li>first</li>");
    expect(html).toContain(
      '<a href="https://example.test/docs" target="_blank" rel="noopener noreferrer">Roundhouse</a>',
    );
    expect(html).toContain(
      '<a href="mailto:hello@example.test" target="_blank" rel="noopener noreferrer">Email</a>',
    );
    expect(html).toContain(
      '<pre><code class="language-ts">const answer = 42;\n</code></pre>',
    );
    expect(html).not.toContain("**bold**");
    expect(logs).toEqual([
      {
        message: "conversation_markdown_rendered",
        conversationId: base.id,
        messageCount: 2,
        durationMs: expect.any(Number),
      },
    ]);
  });

  it("keeps raw HTML, unsafe links, and images inert", () => {
    const userMessage = base.messages[0]!;
    const html = renderConversation(
      {
        ...base,
        messages: [
          {
            ...userMessage,
            body: '<script>alert(1)</script>\n<div onclick="alert(2)">unsafe</div>',
          },
          {
            ...userMessage,
            id: "unsafe-assistant-message",
            direction: "outbound",
            role: "assistant",
            actorId: "roundhouse",
            actorLogin: "Roundhouse",
            body: "[bad script](javascript:alert(3))\n[bad data](data:text/html;base64,PHNjcmlwdD4=)\n![diagram alt](https://example.test/diagram.png)",
          },
        ],
      },
      "octocat",
    );

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain(
      "&lt;div onclick=&quot;alert(2)&quot;&gt;unsafe&lt;/div&gt;",
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('<div onclick="alert(2)">');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
    expect(html).toContain("bad script");
    expect(html).toContain("bad data");
    expect(html).toContain("diagram alt");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("diagram.png");
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
    expect(html).toContain("Delivery brief ready for review");
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
    expect(pending).toContain("Waiting to start delivery");
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

  it("refreshes active delivery and renders its successful transition", () => {
    const active: Conversation = {
      ...base,
      status: "promoted",
      promotion: {
        id: "promotion",
        briefId: "brief",
        state: "accepted",
        runStatus: "active",
        actorGithubUserId: 7,
        actorGithubLogin: "octocat",
        runId: "run-42",
        createdAt: 2,
        updatedAt: 2,
      },
    };
    const activeDetail = renderConversation(active, "octocat");
    const completeDetail = renderConversation(
      {
        ...active,
        promotion: { ...active.promotion!, runStatus: "succeeded" },
      },
      "octocat",
    );
    expect(activeDetail).toContain("Delivery started");
    expect(activeDetail).toContain('<meta http-equiv="refresh" content="2">');
    expect(completeDetail).toContain("Delivery complete");
    expect(completeDetail).not.toContain(
      '<meta http-equiv="refresh" content="2">',
    );

    const activeIndex = renderConversationIndex(
      [base.repository],
      [
        {
          id: base.id,
          repository: base.repository.name,
          status: "promoted",
          promotionState: "accepted",
          promotionRunStatus: "active",
          updatedAt: 1,
        },
      ],
      "octocat",
    );
    const completeIndex = renderConversationIndex(
      [base.repository],
      [
        {
          id: base.id,
          repository: base.repository.name,
          status: "promoted",
          promotionState: "accepted",
          promotionRunStatus: "succeeded",
          updatedAt: 1,
        },
      ],
      "octocat",
    );
    expect(activeIndex).toContain("Delivery started");
    expect(activeIndex).toContain('<meta http-equiv="refresh" content="2">');
    expect(completeIndex).toContain("Delivery complete");
    expect(completeIndex).not.toContain(
      '<meta http-equiv="refresh" content="2">',
    );
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
    expect(html).toContain("Needs attention");
    expect(html).toContain("could not complete the last reply");
    expect(html).toContain("Continue the conversation");
    expect(html).not.toContain("sensitive_upstream_detail");
  });
});
