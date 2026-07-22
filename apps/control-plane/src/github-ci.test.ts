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

async function setupCi(
  reviewStatus: "clean" | "changes_requested" = "clean",
  withNonblockingSpecialist = false,
) {
  const repository = new AutomationRepository();
  await repository.create(
    createRun({
      id: "run_123_issue_42",
      repository: "zorkian/roundhouse",
      githubRepositoryId: 123,
      githubInstallationId: 456,
      issueNumber: 42,
      baseCommit: "a".repeat(40),
      profileVersion: "v2",
      profile: {
        sourcePath: ".roundhouse/profile.yaml",
        sourceCommit: "a".repeat(40),
        version: 1,
        hash: "b".repeat(64),
        paths: { allowed: ["**"], protected: [".github/workflows/**"] },
      },
    }),
  );
  for (const stage of ["reproduce", "plan", "implement", "review"] as const) {
    const run = await repository.get("run_123_issue_42");
    if (!run) throw new Error("run_missing");
    await repository.transition(run.id, run.revision, {
      status: "active",
      stage,
      ...(stage === "review" ? { acceptedHead: head } : {}),
    });
  }
  const reviewRun = await repository.get("run_123_issue_42");
  if (!reviewRun) throw new Error("run_missing");
  const review: Attempt = {
    id: `${reviewRun.id}_rev_${reviewRun.revision}`,
    runId: reviewRun.id,
    runRevision: reviewRun.revision,
    kind: "agent",
    stage: "review",
    role: "review-holistic",
    state: "created",
    deadlineAt: 1_000,
    baseCommit: reviewRun.baseCommit,
    expectedHead: head,
  };
  await repository.createAttempt(review);
  await repository.completeAttempt(review.id, review.runRevision, head, {
    review: {
      status: reviewStatus,
      summary: "Review result",
      findings:
        reviewStatus === "changes_requested"
          ? [
              {
                title: "Blocking issue",
                details: "Must be fixed",
                file: "src/example.ts",
                severity: "high",
              },
            ]
          : [],
      selections: [
        {
          role: "review-security",
          applicable: withNonblockingSpecialist,
          rationale: withNonblockingSpecialist ? "Security-sensitive" : "None",
        },
        { role: "review-data", applicable: false, rationale: "None" },
      ],
    },
  });
  if (withNonblockingSpecialist) {
    const specialist: Attempt = {
      ...review,
      id: `${review.id}_review-security`,
      role: "review-security",
      state: "created",
    };
    await repository.createAttempt(specialist);
    await repository.completeAttempt(
      specialist.id,
      specialist.runRevision,
      head,
      {
        review: {
          status: "changes_requested",
          summary: "Low-severity observation",
          findings: [
            {
              title: "Minor issue",
              details: "Does not block",
              file: "src/example.ts",
              severity: "low",
            },
          ],
        },
      },
    );
  }
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
  additionalChecks: readonly {
    readonly name: string;
    readonly status: string;
    readonly conclusion: string | null;
  }[] = [],
  options: { checkSha?: string; baseSha?: string } = {},
) {
  const checkSha = options.checkSha ?? head;
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
    if (path.includes("/git/ref/heads/"))
      return { object: { sha: options.baseSha ?? "e".repeat(40) } };
    if (path.includes("/check-runs?"))
      return {
        total_count: 1 + additionalChecks.length,
        check_runs: [
          {
            name: "Check",
            status: "completed",
            conclusion: checkConclusion,
            head_sha: checkSha,
            html_url: "https://github.test/check/1",
          },
          ...additionalChecks.map((check, index) => ({
            ...check,
            head_sha: checkSha,
            html_url: `https://github.test/check/${index + 2}`,
          })),
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
  it("accepts successful and skipped checks through the exact-head CI and merge gates", async () => {
    const { repository, run } = await setupCi();
    const api = github(head, "success", true, [
      {
        name: "Deploy development",
        status: "completed",
        conclusion: "skipped",
      },
    ]);
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

  it("waits while an exact-head check is incomplete", async () => {
    const { repository, run } = await setupCi();
    const api = github(head, "success", true, [
      {
        name: "Deploy development",
        status: "queued",
        conclusion: null,
      },
    ]);

    await expect(
      new GitHubCiAutomation(repository, api.api).reconcileCi(run),
    ).resolves.toBe("pending");
    expect(api.graphql).not.toHaveBeenCalled();
    await expect(
      repository.getAttempt(`${run.id}_rev_6`),
    ).resolves.toBeUndefined();
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

  it("returns a conflicted pull request to integration instead of implementation", async () => {
    const { repository, run } = await setupCi();
    const api = github(head, "success", false);
    const automation = new GitHubCiAutomation(repository, api.api);

    await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
    await expect(
      repository.getAttempt(`${run.id}_rev_6`),
    ).resolves.toBeUndefined();
    await expect(repository.get(run.id)).resolves.toMatchObject({
      status: "active",
      stage: "integrate",
      revision: 7,
      currentHead: head,
    });
  });

  it("returns the run to integration when the target branch moved", async () => {
    const { repository, run } = await setupCi();
    const moved = await repository.transition(run.id, run.revision, {
      status: "active",
      stage: "ci",
      heads: { targetBaseHead: "e".repeat(40) },
    });
    if (!moved) throw new Error("run_missing");
    const api = github(head, "success", true, [], {
      baseSha: "9".repeat(40),
    });
    await expect(
      new GitHubCiAutomation(repository, api.api).reconcileCi(moved, 100),
    ).resolves.toBe("recorded");
    expect(api.get).not.toHaveBeenCalledWith(
      expect.stringContaining("/check-runs?"),
    );
    await expect(repository.get(run.id)).resolves.toMatchObject({
      status: "active",
      stage: "integrate",
      revision: 8,
      currentHead: head,
      targetBaseHead: "e".repeat(40),
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

  it("uses the aggregate decision when a specialist has nonblocking findings", async () => {
    const { repository, run } = await setupCi("clean", true);
    const api = github();
    await expect(
      new GitHubCiAutomation(repository, api.api).reconcileCi(run),
    ).resolves.toBe("recorded");
  });

  const integration = "f".repeat(40);
  const targetBase = "e".repeat(40);
  async function setupIntegrated(
    integrateRole:
      "integrate" | "conflict-resolution" | "reviewed" = "integrate",
  ) {
    const { repository, run } = await setupCi();
    const integrateAttempt: Attempt = {
      id: `${run.id}_rev_${run.revision}_integrate`,
      runId: run.id,
      runRevision: run.revision,
      kind: "agent",
      stage: "integrate",
      role: integrateRole === "integrate" ? "integrate" : "conflict-resolution",
      state: "created",
      deadlineAt: 1_000,
      baseCommit: integrateRole === "integrate" ? run.baseCommit : targetBase,
      expectedHead: head,
    };
    await repository.createAttempt(integrateAttempt);
    await repository.completeAttempt(
      integrateAttempt.id,
      integrateAttempt.runRevision,
      integration,
      {
        integration: {
          status: "clean",
          candidateHead: head,
          baseHead: targetBase,
          head: integration,
        },
      },
    );
    let current = run;
    if (integrateRole === "reviewed") {
      const resolved = await repository.transition(run.id, run.revision, {
        status: "active",
        stage: "integrate",
        acceptedHead: integration,
        heads: { targetBaseHead: targetBase, integrationHead: integration },
      });
      if (!resolved) throw new Error("run_missing");
      current = resolved;
      const deltaReview: Attempt = {
        ...integrateAttempt,
        id: `${current.id}_rev_${current.revision}_review`,
        runRevision: current.revision,
        role: "review-integration",
        expectedHead: integration,
      };
      await repository.createAttempt(deltaReview);
      await repository.completeAttempt(
        deltaReview.id,
        deltaReview.runRevision,
        integration,
        { review: { status: "clean", findings: [] } },
      );
    }
    const next = await repository.transition(current.id, current.revision, {
      status: "active",
      stage: "ci",
      acceptedHead: integration,
      heads: {
        candidateHead: head,
        reviewedHead: head,
        targetBaseHead: targetBase,
        integrationHead: integration,
      },
    });
    if (!next) throw new Error("run_missing");
    return { repository, run: next };
  }

  it("runs CI and merge against the validated integration head", async () => {
    const { repository, run } = await setupIntegrated();
    const api = github(integration, "success", true, [], {
      checkSha: integration,
      baseSha: targetBase,
    });
    const automation = new GitHubCiAutomation(repository, api.api);

    await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
    await expect(
      repository.getAttempt(`${run.id}_rev_7`),
    ).resolves.toMatchObject({
      stage: "ci",
      expectedHead: integration,
      acceptedHead: integration,
      result: {
        ci: { status: "success", head: integration, baseHead: targetBase },
      },
    });

    await coordinate(
      repository,
      { submit: async () => undefined },
      { runId: run.id, expectedRevision: 7 },
      101,
    );
    const merging = await repository.get(run.id);
    expect(merging).toMatchObject({
      status: "active",
      stage: "merge",
      currentHead: integration,
      reviewedHead: head,
      targetBaseHead: targetBase,
      integrationHead: integration,
    });
    if (!merging) throw new Error("merge_run_missing");
    await expect(automation.merge(merging, 200)).resolves.toBe("recorded");
    expect(api.put).toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/pulls/73/merge",
      { sha: integration, merge_method: "merge" },
    );
  });

  it("requires an integration-delta review for conflict-resolved integrations", async () => {
    const { repository, run } = await setupIntegrated("conflict-resolution");
    const api = github(integration, "success", true, [], {
      checkSha: integration,
      baseSha: targetBase,
    });
    const automation = new GitHubCiAutomation(repository, api.api);
    await expect(automation.reconcileCi(run, 100)).resolves.toBe("stale");
    expect(api.put).not.toHaveBeenCalled();
  });

  it("runs CI and merge for a conflict-resolved integration after its delta review", async () => {
    const { repository, run } = await setupIntegrated("reviewed");
    const api = github(integration, "success", true, [], {
      checkSha: integration,
      baseSha: targetBase,
    });
    const automation = new GitHubCiAutomation(repository, api.api);
    await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
    const merged = await repository.transition(run.id, run.revision, {
      status: "active",
      stage: "merge",
    });
    if (!merged) throw new Error("merge_run_missing");
    await expect(automation.merge(merged, 200)).resolves.toBe("recorded");
    expect(api.put).toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/pulls/73/merge",
      { sha: integration, merge_method: "merge" },
    );
  });

  it("returns the run to integration when the target branch moves before merge", async () => {
    const { repository, run } = await setupIntegrated();
    const ci: Attempt = {
      id: `${run.id}_rev_7`,
      runId: run.id,
      runRevision: run.revision,
      kind: "external",
      stage: "ci",
      role: "github-checks",
      state: "created",
      deadlineAt: 1_000,
      baseCommit: run.baseCommit,
      expectedHead: integration,
    };
    await repository.createAttempt(ci);
    await repository.completeAttempt(ci.id, ci.runRevision, integration, {
      ci: { status: "success", head: integration, baseHead: targetBase },
    });
    const merging = await repository.transition(run.id, run.revision, {
      status: "active",
      stage: "merge",
    });
    if (!merging) throw new Error("merge_run_missing");
    const api = github(integration, "success", true, [], {
      checkSha: integration,
      baseSha: "9".repeat(40),
    });
    const automation = new GitHubCiAutomation(repository, api.api);
    await expect(automation.merge(merging, 200)).resolves.toBe("recorded");
    expect(api.put).not.toHaveBeenCalled();
    await expect(repository.get(run.id)).resolves.toMatchObject({
      status: "active",
      stage: "integrate",
      currentHead: integration,
      reviewedHead: head,
      targetBaseHead: targetBase,
      integrationHead: integration,
    });
  });

  it("rejects merge when the pull-request head is not the integration head", async () => {
    const { repository, run } = await setupIntegrated();
    const api = github(head, "success", true, [], {
      checkSha: integration,
      baseSha: targetBase,
    });
    const automation = new GitHubCiAutomation(repository, api.api);
    await expect(automation.reconcileCi(run, 100)).resolves.toBe("stale");
  });

  it("rejects merge when CI does not bind the recorded base head", async () => {
    const { repository, run } = await setupIntegrated();
    const ci: Attempt = {
      id: `${run.id}_rev_7`,
      runId: run.id,
      runRevision: run.revision,
      kind: "external",
      stage: "ci",
      role: "github-checks",
      state: "created",
      deadlineAt: 1_000,
      baseCommit: run.baseCommit,
      expectedHead: integration,
    };
    await repository.createAttempt(ci);
    await repository.completeAttempt(ci.id, ci.runRevision, integration, {
      ci: { status: "success", head: integration, baseHead: "0".repeat(40) },
    });
    const merging = await repository.transition(run.id, run.revision, {
      status: "active",
      stage: "merge",
    });
    if (!merging) throw new Error("merge_run_missing");
    const api = github(integration, "success", true, [], {
      checkSha: integration,
      baseSha: targetBase,
    });
    await expect(
      new GitHubCiAutomation(repository, api.api).merge(merging, 200),
    ).resolves.toBe("stale");
    expect(api.put).not.toHaveBeenCalled();
  });

  it("rejects merge when the current head is not the validated integration head", async () => {
    const { repository, run } = await setupCi();
    const drifted = await repository.transition(run.id, run.revision, {
      status: "active",
      stage: "merge",
      acceptedHead: head,
      heads: { integrationHead: integration },
    });
    if (!drifted) throw new Error("run_missing");
    const api = github();
    await expect(
      new GitHubCiAutomation(repository, api.api).merge(drifted, 200),
    ).resolves.toBe("stale");
    expect(api.put).not.toHaveBeenCalled();
  });

  it("accepts a signed completed check suite only for the active exact head", async () => {
    const { repository, run } = await setupCi();
    const wakeups: Wakeup[] = [];
    const body = JSON.stringify({
      action: "completed",
      repository: { id: 123, full_name: "zorkian/roundhouse" },
      installation: { id: 456 },
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
