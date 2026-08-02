// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
  promotionIssueMarker,
  promotionStartMarker,
} from "./conversation-engine.js";
import { executeConversationPromotion } from "./conversation-promotion.js";
import type {
  ConversationPromotion,
  D1ConversationRepository,
} from "./conversation-store.js";
import type { GitHubApi } from "./github.js";
import type { UiAuthEnv } from "./ui-auth.js";

const conversationId = "b1f486ff-7744-49f9-ab78-f74e8409fc2b";
const briefId = "47cff616-eaaa-46fd-870f-dd5cf3c674d8";
const promotionId = "6ba87f27-a392-4057-8b75-4e140a39dfa8";

function promotionFixture(overrides: Partial<ConversationPromotion> = {}) {
  const promotion: ConversationPromotion = {
    id: promotionId,
    briefId,
    state: "requested" as const,
    actorGithubUserId: 7,
    actorGithubLogin: "octocat",
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
  return {
    promotion,
    uiSessionHash: "session-hash",
    conversation: {
      id: conversationId,
      repository: {
        id: "repo_123",
        githubId: "123",
        name: "octo/project",
        installationId: 99,
      },
      creatorGithubUserId: 7,
      creatorGithubLogin: "octocat",
      status: "open" as const,
      sourceCommit: "a".repeat(40),
      profileHash: "b".repeat(64),
      context: {
        model: { id: "openai/gpt-5.6-sol", reasoning: "high" as const },
        defaultBranch: "main",
      },
      promotion,
      links: [],
      messages: [],
      createdAt: 100,
      updatedAt: 100,
    },
    brief: {
      id: briefId,
      revision: 1,
      state: "approved" as const,
      title: "Build the approved flow",
      outcome: "Implement the conversation handoff.",
      acceptanceCriteria: ["Normal intake creates the run"],
      constraints: ["No agent writes"],
      evidence: ["The user approved the brief"],
      uncertainties: [],
      sourceCommit: "a".repeat(40),
      createdAt: 100,
      updatedAt: 100,
    },
  };
}

const env = {
  GITHUB_START_COMMAND: "/roundhouse-dev start",
  PUBLIC_ORIGIN: "https://roundhouse.example",
} as UiAuthEnv & { GITHUB_START_COMMAND: string; PUBLIC_ORIGIN: string };

describe("conversation promotion", () => {
  it("reconciles an issue created before its D1 checkpoint and never creates it twice", async () => {
    const work = promotionFixture();
    let persistedIssue:
      | { number: number; html_url: string; body: string; created_at: string }
      | undefined;
    let failIssueCheckpoint = true;
    const repository = {
      promotionForWork: vi.fn(async () => work),
      claimPromotion: vi.fn(async () => true),
      recordPromotionIssue: vi.fn(async () => {
        if (failIssueCheckpoint) {
          failIssueCheckpoint = false;
          throw new Error("injected_d1_failure");
        }
      }),
      markPromotionAwaitingIntake: vi.fn(async () => undefined),
      retryPromotion: vi.fn(async () => undefined),
      rejectPromotion: vi.fn(async () => undefined),
    } as unknown as D1ConversationRepository;
    const github = {
      get: vi.fn(async (path: string) => {
        if (path.includes("/issues?state=all"))
          return [
            {
              number: 41,
              html_url: "https://github.test/octo/project/pull/41",
              body: promotionIssueMarker(conversationId, briefId),
              created_at: new Date(100).toISOString(),
              pull_request: {},
            },
            ...(persistedIssue ? [persistedIssue] : []),
          ];
        if (path.includes("/comments?")) return [];
        throw new Error(`unexpected_get:${path}`);
      }),
      post: vi.fn(),
    } as unknown as GitHubApi;
    const postedPaths: string[] = [];
    const postForSession = async <T>(
      _sessionHash: string,
      _userId: number,
      _env: UiAuthEnv,
      path: string,
      body: unknown,
    ): Promise<T> => {
      postedPaths.push(path);
      if (path.endsWith("/issues")) {
        persistedIssue = {
          number: 42,
          html_url: "https://github.test/octo/project/issues/42",
          body: String((body as { body: string }).body),
          created_at: new Date(100).toISOString(),
        };
        return persistedIssue as T;
      }
      return {} as T;
    };

    await expect(
      executeConversationPromotion(repository, github, env, promotionId, {
        postForSession,
      }),
    ).resolves.toBe("retry");
    expect(persistedIssue?.body).toContain(
      promotionIssueMarker(conversationId, briefId),
    );
    await expect(
      executeConversationPromotion(repository, github, env, promotionId, {
        postForSession,
      }),
    ).resolves.toBe("completed");
    expect(postedPaths.filter((path) => path.endsWith("/issues"))).toHaveLength(
      1,
    );
    expect(
      postedPaths.filter((path) => path.endsWith("/comments")),
    ).toHaveLength(1);
    expect(repository.recordPromotionIssue).toHaveBeenCalledTimes(2);
    expect(repository.markPromotionAwaitingIntake).toHaveBeenCalledOnce();
  });

  it("reconciles a start comment written before its D1 checkpoint", async () => {
    const work = promotionFixture({
      state: "issue_created",
      issueNumber: 42,
      issueUrl: "https://github.test/octo/project/issues/42",
    });
    let comment: string | undefined;
    let failCheckpoint = true;
    const repository = {
      promotionForWork: vi.fn(async () => work),
      claimPromotion: vi.fn(async () => true),
      recordPromotionIssue: vi.fn(async () => undefined),
      markPromotionAwaitingIntake: vi.fn(async () => {
        if (failCheckpoint) {
          failCheckpoint = false;
          throw new Error("injected_d1_failure");
        }
      }),
      retryPromotion: vi.fn(async () => undefined),
    } as unknown as D1ConversationRepository;
    const github = {
      get: vi.fn(async (path: string) =>
        path.includes("/comments?") && comment ? [{ body: comment }] : [],
      ),
      post: vi.fn(),
    } as unknown as GitHubApi;
    const postForSession = async <T>(
      _sessionHash: string,
      _userId: number,
      _env: UiAuthEnv,
      path: string,
      body: unknown,
    ): Promise<T> => {
      if (!path.endsWith("/comments")) throw new Error("unexpected_write");
      comment = String((body as { body: string }).body);
      return {} as T;
    };
    await expect(
      executeConversationPromotion(repository, github, env, promotionId, {
        postForSession,
      }),
    ).resolves.toBe("retry");
    expect(comment).toContain(promotionStartMarker(conversationId, briefId));
    await expect(
      executeConversationPromotion(repository, github, env, promotionId, {
        postForSession,
      }),
    ).resolves.toBe("completed");
    expect(github.get).toHaveBeenCalledTimes(2);
    expect(repository.markPromotionAwaitingIntake).toHaveBeenCalledTimes(2);
  });
});
