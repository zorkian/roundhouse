// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  promotionIssueMarker,
  promotionStartMarker,
  renderDeliveryBrief,
} from "./conversation-engine.js";
import { D1ConversationRepository } from "./conversation-store.js";
import type { GitHubApi } from "./github.js";
import { uiGitHubPostForSessionHash, type UiAuthEnv } from "./ui-auth.js";

interface PromotionEnv extends UiAuthEnv {
  readonly GITHUB_START_COMMAND: string;
  readonly PUBLIC_ORIGIN: string;
}

interface GitHubIssue {
  readonly number?: number;
  readonly html_url?: string;
  readonly body?: string | null;
  readonly created_at?: string;
  readonly pull_request?: unknown;
}

interface GitHubComment {
  readonly body?: string | null;
}

interface PromotionDependencies {
  readonly postForSession?: typeof uiGitHubPostForSessionHash;
}

function repositoryPath(repository: string): string {
  const [owner, name] = repository.split("/", 2);
  if (!owner || !name) throw new Error("repository_name_invalid");
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

async function findIssue(
  github: GitHubApi,
  repository: string,
  actor: string,
  marker: string,
  createdAt: number,
): Promise<{ readonly number: number; readonly url: string } | undefined> {
  const base = repositoryPath(repository);
  for (let page = 1; page <= 10; page += 1) {
    const issues = await github.get<readonly GitHubIssue[]>(
      `${base}/issues?state=all&creator=${encodeURIComponent(actor)}&sort=created&direction=desc&per_page=100&page=${page}`,
    );
    for (const issue of issues) {
      if (
        issue.pull_request === undefined &&
        issue.body?.includes(marker) &&
        typeof issue.number === "number" &&
        typeof issue.html_url === "string"
      )
        return { number: issue.number, url: issue.html_url };
    }
    const oldest = issues.at(-1)?.created_at;
    if (
      issues.length < 100 ||
      (oldest && Date.parse(oldest) < createdAt - 60_000)
    )
      break;
  }
  return undefined;
}

async function startCommentExists(
  github: GitHubApi,
  repository: string,
  issueNumber: number,
  marker: string,
): Promise<boolean> {
  const base = repositoryPath(repository);
  for (let page = 1; page <= 10; page += 1) {
    const comments = await github.get<readonly GitHubComment[]>(
      `${base}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
    );
    if (comments.some((comment) => comment.body?.includes(marker))) return true;
    if (comments.length < 100) return false;
  }
  return false;
}

export async function executeConversationPromotion(
  repository: D1ConversationRepository,
  github: GitHubApi,
  env: PromotionEnv,
  promotionId: string,
  dependencies: PromotionDependencies = {},
): Promise<"completed" | "retry" | "ignored"> {
  const work = await repository.promotionForWork(promotionId);
  if (!work) return "ignored";
  if (
    ["accepted", "rejected", "awaiting_intake"].includes(work.promotion.state)
  )
    return "completed";
  if (!(await repository.claimPromotion(promotionId))) return "ignored";
  const { conversation, brief, promotion, uiSessionHash } = work;
  const postForSession =
    dependencies.postForSession ?? uiGitHubPostForSessionHash;
  try {
    const base = repositoryPath(conversation.repository.name);
    const issueMarker = promotionIssueMarker(conversation.id, brief.id);
    let issue =
      promotion.issueNumber && promotion.issueUrl
        ? { number: promotion.issueNumber, url: promotion.issueUrl }
        : await findIssue(
            github,
            conversation.repository.name,
            promotion.actorGithubLogin,
            issueMarker,
            promotion.createdAt,
          );
    if (!issue) {
      const created = await postForSession<{
        readonly number: number;
        readonly html_url: string;
      }>(uiSessionHash, promotion.actorGithubUserId, env, `${base}/issues`, {
        title: brief.title,
        body: renderDeliveryBrief(
          brief,
          conversation.id,
          new URL(
            `/conversations/${conversation.id}`,
            env.PUBLIC_ORIGIN,
          ).toString(),
        ),
      });
      issue = { number: created.number, url: created.html_url };
    }
    await repository.recordPromotionIssue(promotionId, issue.number, issue.url);
    const commentMarker = promotionStartMarker(conversation.id, brief.id);
    if (
      !(await startCommentExists(
        github,
        conversation.repository.name,
        issue.number,
        commentMarker,
      ))
    )
      await postForSession(
        uiSessionHash,
        promotion.actorGithubUserId,
        env,
        `${base}/issues/${issue.number}/comments`,
        { body: `${env.GITHUB_START_COMMAND}\n\n${commentMarker}` },
      );
    await repository.markPromotionAwaitingIntake(promotionId);
    return "completed";
  } catch (error) {
    await repository.retryPromotion(
      promotionId,
      error instanceof Error ? error.message : "promotion_failed",
    );
    return "retry";
  }
}
