// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  createRun,
  MemoryRunRepository,
  type Attempt,
  type RunSnapshot,
  type Wakeup,
} from "@roundhouse/core";
import { describe, expect, it, vi } from "vitest";
import { signCallback } from "./callback.js";
import { coordinate } from "./coordinator.js";
import {
  acceptGitHubCheckSuite,
  GitHubCiAutomation,
  type GitHubAutomationRepository,
} from "./github-ci.js";
import type { GitHubAutomationApi, GitHubEnv } from "./github.js";

const head = "b".repeat(40);
const mergeCommit = "c".repeat(40);
const env = {
  GITHUB_APP_ID: "development-app",
  GITHUB_APP_INSTALLATION_ID: "development-installation",
  GITHUB_START_COMMAND: "/roundhouse-dev start",
  ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY: "not-used-by-fake",
  ROUNDHOUSE_GITHUB_WEBHOOK_SECRET: "webhook-secret",
} satisfies GitHubEnv;

class AutomationRepository
  extends MemoryRunRepository
  implements GitHubAutomationRepository
{
  readonly deliveries = new Set<string>();

  async recordGitHubDelivery(
    _runId: string,
    deliveryId: string,
  ): Promise<boolean> {
    if (this.deliveries.has(deliveryId)) return false;
    this.deliveries.add(deliveryId);
    return true;
  }
}

async function setupCi(reviewStatus: "clean" | "changes_requested" = "clean") {
  const repository = new AutomationRepository();
  await repository.create(
    createRun({
      id: "run_zorkian_roundhouse_issue_42",
      repository: "zorkian/roundhouse",
      issueNumber: 42,
      baseCommit: "a".repeat(40),
      profileVersion: "v2",
    }),
  );
  for (const stage of ["reproduce", "plan", "implement", "review"] as const) {
    const run = await repository.get("run_zorkian_roundhouse_issue_42");
    if (!run) throw new Error("run_missing");
    await repository.transition(run.id, run.revision, {
      status: "active",
      stage,
      ...(stage === "review" ? { acceptedHead: head } : {}),
    });
  }
  const reviewRun = await repository.get("run_zorkian_roundhouse_issue_42");
  if (!reviewRun) throw new Error("run_missing");
  const review: Attempt = {
    id: `${reviewRun.id}_rev_${reviewRun.revision}`,
    runId: reviewRun.id,
    runRevision: reviewRun.revision,
    kind: "agent",
    stage: "review",
    role: "review",
    state: "created",
    deadlineAt: 1_000,
    baseCommit: reviewRun.baseCommit,
    expectedHead: head,
  };
  await repository.createAttempt(review);
  await repository.completeAttempt(review.id, review.runRevision, head, {
    review: { status: reviewStatus, summary: "Review result", findings: [] },
  });
  const ciRun = await repository.transition(reviewRun.id, reviewRun.revision, {
    status: "active",
    stage: "ci",
  });
  if (!ciRun) throw new Error("ci_run_missing");
  return { repository, run: ciRun };
}

function github(
  prHead = head,
  checkConclusion = "success",
  mergeable: boolean | null = true,
) {
  let draft = true;
  const get = vi.fn(async (path: string) => {
    if (path.includes("/pulls?state="))
      return [{ number: 73, html_url: "https://github.test/pull/73" }];
    if (path.endsWith("/pulls/73"))
      return {
        number: 73,
        html_url: "https://github.test/pull/73",
        node_id: "PR_node",
        draft,
        state: "open",
        merged: false,
        mergeable,
        merge_commit_sha: null,
        head: { sha: prHead },
      };
    if (path.includes("/check-runs?"))
      return {
        total_count: 1,
        check_runs: [
          {
            name: "Check",
            status: "completed",
            conclusion: checkConclusion,
            head_sha: head,
            html_url: "https://github.test/check/1",
          },
        ],
      };
    throw new Error(`unexpected_get:${path}`);
  });
  const graphql = vi.fn(async () => {
    draft = false;
    return {
      markPullRequestReadyForReview: { pullRequest: { isDraft: false } },
    };
  });
  const put = vi.fn(async () => ({ merged: true, sha: mergeCommit }));
  return {
    api: {
      get: get as GitHubAutomationApi["get"],
      post: vi.fn(async () => ({})) as GitHubAutomationApi["post"],
      put: put as GitHubAutomationApi["put"],
      graphql: graphql as GitHubAutomationApi["graphql"],
    },
    get,
    graphql,
    put,
  };
}

describe("GitHub exact-head CI and merge", () => {
  it("records exact successful CI, marks the PR ready, and merges only after both gates", async () => {
    const { repository, run } = await setupCi();
    const api = github();
    const automation = new GitHubCiAutomation(repository, api.api);

    await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
    expect(api.graphql).toHaveBeenCalledWith(expect.any(String), {
      pullRequestId: "PR_node",
    });
    await expect(
      repository.getAttempt(`${run.id}_rev_6`),
    ).resolves.toMatchObject({
      kind: "external",
      stage: "ci",
      expectedHead: head,
      acceptedHead: head,
      result: { ci: { status: "success", head } },
    });

    await coordinate(
      repository,
      { submit: async () => undefined },
      { runId: run.id, expectedRevision: 6 },
      101,
    );
    const merging = await repository.get(run.id);
    expect(merging).toMatchObject({
      status: "active",
      stage: "merge",
      revision: 7,
      currentHead: head,
    });
    if (!merging) throw new Error("merge_run_missing");

    await expect(automation.merge(merging, 200)).resolves.toBe("recorded");
    expect(api.put).toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/pulls/73/merge",
      { sha: head, merge_method: "merge" },
    );
    await coordinate(
      repository,
      { submit: async () => undefined },
      { runId: run.id, expectedRevision: 7 },
      201,
    );
    await expect(repository.get(run.id)).resolves.toMatchObject({
      status: "succeeded",
      stage: "merge",
      revision: 8,
      currentHead: mergeCommit,
    });
  });

  it("does not accept CI for a different pull-request head", async () => {
    const { repository, run } = await setupCi();
    const api = github("d".repeat(40));
    await expect(
      new GitHubCiAutomation(repository, api.api).reconcileCi(run),
    ).resolves.toBe("stale");
    expect(api.graphql).not.toHaveBeenCalled();
    await expect(
      repository.getAttempt(`${run.id}_rev_6`),
    ).resolves.toBeUndefined();
  });

  it("records exact failed CI and returns the run to implementation", async () => {
    const { repository, run } = await setupCi();
    const api = github(head, "failure");
    const automation = new GitHubCiAutomation(repository, api.api);

    await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
    expect(api.graphql).not.toHaveBeenCalled();
    await expect(
      repository.getAttempt(`${run.id}_rev_6`),
    ).resolves.toMatchObject({
      kind: "external",
      stage: "ci",
      expectedHead: head,
      acceptedHead: head,
      result: {
        ci: {
          status: "failure",
          head,
          checks: [{ name: "Check", conclusion: "failure" }],
        },
      },
    });

    await coordinate(
      repository,
      { submit: async () => undefined },
      { runId: run.id, expectedRevision: 6 },
      101,
    );
    await expect(repository.get(run.id)).resolves.toMatchObject({
      status: "active",
      stage: "implement",
      revision: 7,
      currentHead: head,
    });
  });

  it("returns a conflicted exact head to implementation instead of waiting for checks", async () => {
    const { repository, run } = await setupCi();
    const api = github(head, "success", false);
    const automation = new GitHubCiAutomation(repository, api.api);

    await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
    await expect(
      repository.getAttempt(`${run.id}_rev_6`),
    ).resolves.toMatchObject({
      result: {
        ci: {
          status: "failure",
          reason: "base_conflict",
          head,
          checks: [
            {
              name: "Pull request base",
              conclusion: "failure",
            },
          ],
        },
      },
    });
  });

  it("does not accept successful CI without a clean exact-head review", async () => {
    const { repository, run } = await setupCi("changes_requested");
    const api = github();
    await expect(
      new GitHubCiAutomation(repository, api.api).reconcileCi(run),
    ).resolves.toBe("stale");
    expect(api.get).not.toHaveBeenCalled();
    expect(api.graphql).not.toHaveBeenCalled();
  });

  it("accepts a signed completed check suite only for the active exact head", async () => {
    const { repository, run } = await setupCi();
    const wakeups: Wakeup[] = [];
    const body = JSON.stringify({
      action: "completed",
      repository: { full_name: "zorkian/roundhouse" },
      check_suite: {
        head_branch: "roundhouse/issue-42",
        head_sha: head,
      },
    });
    const signature = await signCallback("webhook-secret", body);
    const request = () =>
      new Request("https://roundhouse.invalid/github/webhook", {
        method: "POST",
        headers: {
          "x-github-delivery": "check-delivery",
          "x-github-event": "check_suite",
          "x-hub-signature-256": `sha256=${signature}`,
        },
        body,
      });
    const enqueue = async (wakeup: Wakeup) => {
      wakeups.push(wakeup);
    };
    await expect(
      acceptGitHubCheckSuite(request(), env, repository, enqueue),
    ).resolves.toBe("accepted");
    await expect(
      acceptGitHubCheckSuite(request(), env, repository, enqueue),
    ).resolves.toBe("duplicate");
    expect(wakeups).toEqual([
      { runId: run.id, expectedRevision: run.revision },
    ]);
  });
});
