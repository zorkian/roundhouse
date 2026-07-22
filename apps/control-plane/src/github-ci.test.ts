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
      getText: vi.fn(async () => {
        throw new Error("unexpected_get_text");
      }) as GitHubAutomationApi["getText"],
      graphql: graphql as GitHubAutomationApi["graphql"],
    },
    get,
    graphql,
    put,
  };
}

const failedJobLog =
  "2026-02-09T12:00:00.0000000Z ##[group]Formatting (changed files only)\n" +
  "2026-02-09T12:00:01.0000000Z File t/customtext-module.t needs tidying\n" +
  "2026-02-09T12:00:02.0000000Z Process completed with exit code 1.\n";

function githubFailure({
  candidate = head,
  checkHead = candidate,
  workflowHead = candidate,
  jobHead = candidate,
  runAttempt = 1,
  jobAttempt = runAttempt,
  checkRunId = 11,
  checkSuiteId = 21,
  workflowRunId = 31,
  jobId = 41,
  detailsUrl,
  secondJobFailed = false,
  workflowRunFound = true,
  jobsMalformed = false,
  noFailedJobs = false,
  logError = false,
}: {
  readonly candidate?: string;
  readonly checkHead?: string;
  readonly workflowHead?: string;
  readonly jobHead?: string | null;
  readonly runAttempt?: number;
  readonly jobAttempt?: number | null;
  readonly checkRunId?: number;
  readonly checkSuiteId?: number;
  readonly workflowRunId?: number;
  readonly jobId?: number;
  readonly detailsUrl?: string | null;
  readonly secondJobFailed?: boolean;
  readonly workflowRunFound?: boolean;
  readonly jobsMalformed?: boolean;
  readonly noFailedJobs?: boolean;
  readonly logError?: boolean;
} = {}) {
  const jobUrl = `https://github.test/zorkian/roundhouse/actions/runs/${workflowRunId}/job/${jobId}`;
  const checkDetailsUrl = detailsUrl === undefined ? jobUrl : detailsUrl;
  const get = vi.fn(async (path: string) => {
    if (path.includes("/pulls?state="))
      return [{ number: 73, html_url: "https://github.test/pull/73" }];
    if (path.endsWith("/pulls/73"))
      return {
        number: 73,
        html_url: "https://github.test/pull/73",
        node_id: "PR_node",
        draft: false,
        state: "open",
        merged: false,
        mergeable: true,
        merge_commit_sha: null,
        head: { sha: candidate },
      };
    if (path.includes("/check-runs?"))
      return {
        total_count: 1,
        check_runs: [
          {
            id: checkRunId,
            name: "test",
            status: "completed",
            conclusion: "failure",
            head_sha: checkHead,
            html_url: `https://github.test/zorkian/roundhouse/runs/${jobId}`,
            ...(checkDetailsUrl === null
              ? {}
              : { details_url: checkDetailsUrl }),
            check_suite: { id: checkSuiteId },
          },
        ],
      };
    if (path.includes("/actions/runs?head_sha="))
      return {
        total_count: workflowRunFound ? 1 : 0,
        workflow_runs: workflowRunFound
          ? [
              {
                id: workflowRunId,
                name: "CI (fast)",
                head_sha: workflowHead,
                run_attempt: runAttempt,
                conclusion: "failure",
                html_url: `https://github.test/zorkian/roundhouse/actions/runs/${workflowRunId}`,
                check_suite_id: checkSuiteId,
              },
            ]
          : [],
      };
    if (
      path.includes(
        `/actions/runs/${workflowRunId}/attempts/${runAttempt}/jobs`,
      )
    )
      return jobsMalformed
        ? { total_count: 2 }
        : {
            total_count: 2,
            jobs: [
              {
                id: jobId,
                name: "test",
                status: "completed",
                conclusion: noFailedJobs ? "success" : "failure",
                ...(jobHead === null ? {} : { head_sha: jobHead }),
                ...(jobAttempt === null ? {} : { run_attempt: jobAttempt }),
                html_url: jobUrl,
                steps: [
                  { name: "Check out", conclusion: "success" },
                  {
                    name: "Formatting (changed files only)",
                    conclusion: "failure",
                  },
                ],
              },
              {
                id: jobId + 1,
                name: "build",
                status: "completed",
                conclusion: secondJobFailed ? "failure" : "success",
                head_sha: jobHead ?? candidate,
                run_attempt: runAttempt,
              },
            ],
          };
    throw new Error(`unexpected_get:${path}`);
  });
  const getText = vi.fn(async (path: string) => {
    if (
      logError ||
      path !== `/repos/zorkian/roundhouse/actions/jobs/${jobId}/logs`
    )
      throw new Error("github_get_404");
    return failedJobLog;
  });
  return {
    api: {
      get: get as GitHubAutomationApi["get"],
      post: vi.fn(async () => ({})) as GitHubAutomationApi["post"],
      put: vi.fn(async () => ({
        merged: true,
        sha: mergeCommit,
      })) as GitHubAutomationApi["put"],
      getText: getText as GitHubAutomationApi["getText"],
      graphql: vi.fn(async () => ({
        markPullRequestReadyForReview: { pullRequest: { isDraft: false } },
      })) as GitHubAutomationApi["graphql"],
    },
    get,
    getText,
  };
}

async function returnToCi(
  repository: AutomationRepository,
  runId: string,
  acceptedHead: string,
): Promise<RunSnapshot> {
  const implementing = await repository.get(runId);
  if (!implementing || implementing.stage !== "implement")
    throw new Error("implement_run_missing");
  const implement: Attempt = {
    id: `${runId}_rev_${implementing.revision}`,
    runId,
    runRevision: implementing.revision,
    kind: "agent",
    stage: "implement",
    role: "implement",
    state: "created",
    deadlineAt: 1_000,
    baseCommit: implementing.baseCommit,
    expectedHead: implementing.currentHead,
  };
  await repository.createAttempt(implement);
  await repository.completeAttempt(
    implement.id,
    implementing.revision,
    acceptedHead,
    {
      implementation: {
        summary: "Repair applied",
        pullRequestTitle: "Fix",
        pullRequestBody: "Body",
        validation: [],
      },
    },
  );
  const reviewing = await repository.transition(runId, implementing.revision, {
    status: "active",
    stage: "review",
    acceptedHead,
  });
  if (!reviewing) throw new Error("review_run_missing");
  const review: Attempt = {
    id: `${runId}_rev_${reviewing.revision}`,
    runId,
    runRevision: reviewing.revision,
    kind: "agent",
    stage: "review",
    role: "review-holistic",
    state: "created",
    deadlineAt: 1_000,
    baseCommit: reviewing.baseCommit,
    expectedHead: acceptedHead,
  };
  await repository.createAttempt(review);
  await repository.completeAttempt(
    review.id,
    reviewing.revision,
    acceptedHead,
    {
      review: {
        status: "clean",
        summary: "Clean",
        findings: [],
        selections: [
          { role: "review-security", applicable: false, rationale: "None" },
          { role: "review-data", applicable: false, rationale: "None" },
        ],
      },
    },
  );
  const ci = await repository.transition(runId, reviewing.revision, {
    status: "active",
    stage: "ci",
  });
  if (!ci) throw new Error("ci_run_missing");
  return ci;
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

  it("retrieves failed Actions diagnostics and returns the run to implementation with the evidence", async () => {
    const { repository, run } = await setupCi();
    const api = githubFailure();
    const automation = new GitHubCiAutomation(repository, api.api);

    await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
    expect(api.get).toHaveBeenCalledWith(
      `/repos/zorkian/roundhouse/actions/runs?head_sha=${head}&per_page=100`,
    );
    expect(api.get).toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/actions/runs/31/attempts/1/jobs?per_page=100",
    );
    expect(api.getText).toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/actions/jobs/41/logs",
    );
    const attempt = await repository.getAttempt(`${run.id}_rev_6`);
    expect(attempt).toMatchObject({
      kind: "external",
      stage: "ci",
      expectedHead: head,
      acceptedHead: head,
    });
    const ci = attempt?.result?.ci as Record<string, any>;
    expect(ci.status).toBe("failure");
    expect(ci.reason).toBeUndefined();
    expect(ci.head).toBe(head);
    expect(ci.checks).toEqual([
      {
        name: "test",
        status: "completed",
        conclusion: "failure",
        url: "https://github.test/zorkian/roundhouse/runs/41",
      },
    ]);
    expect(ci.diagnostics.notice).toContain("untrusted");
    expect(ci.diagnostics.untrusted).toBe(true);
    expect(ci.diagnostics.evidenceKey).toBe(`${head}:11:31:1`);
    expect(ci.diagnostics.failures).toEqual([
      {
        key: `${head}:11:31:1`,
        repository: "zorkian/roundhouse",
        candidateSha: head,
        checkRun: {
          id: 11,
          name: "test",
          conclusion: "failure",
          url: "https://github.test/zorkian/roundhouse/runs/41",
        },
        workflowRun: {
          id: 31,
          attempt: 1,
          name: "CI (fast)",
          conclusion: "failure",
          url: "https://github.test/zorkian/roundhouse/actions/runs/31",
        },
        jobs: [
          {
            id: 41,
            name: "test",
            conclusion: "failure",
            url: "https://github.test/zorkian/roundhouse/actions/runs/31/job/41",
            failedSteps: [
              {
                name: "Formatting (changed files only)",
                conclusion: "failure",
              },
            ],
            log: failedJobLog,
          },
        ],
      },
    ]);
    // The durable evidence holds the full retrieved log and no credential.
    expect(JSON.stringify(ci)).toContain(
      "File t/customtext-module.t needs tidying",
    );
    expect(JSON.stringify(ci)).toContain("Process completed with exit code 1.");
    expect(JSON.stringify(ci)).not.toContain("token");

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

    // The repair dispatcher reads the latest completed CI attempt as context.
    const repair = await repository.latestCompletedAttempt(run.id, "ci", 7);
    const repairCi = repair?.result?.ci as Record<string, any>;
    expect(repairCi.diagnostics.failures[0].jobs[0].failedSteps[0].name).toBe(
      "Formatting (changed files only)",
    );
    expect(repairCi.diagnostics.failures[0].jobs[0].log).toContain(
      "File t/customtext-module.t needs tidying",
    );
  });

  it("binds a failed check to only its own failed job when the workflow has several", async () => {
    const { repository, run } = await setupCi();
    const api = githubFailure({ secondJobFailed: true });
    const automation = new GitHubCiAutomation(repository, api.api);

    await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
    const ci = (await repository.getAttempt(`${run.id}_rev_6`))?.result
      ?.ci as Record<string, any>;
    expect(ci.reason).toBeUndefined();
    expect(ci.diagnostics.failures).toHaveLength(1);
    expect(ci.diagnostics.failures[0].jobs).toHaveLength(1);
    expect(ci.diagnostics.failures[0].jobs[0].id).toBe(41);
    expect(ci.diagnostics.failures[0].jobs[0].name).toBe("test");
    expect(api.getText).toHaveBeenCalledTimes(1);
    expect(api.getText).toHaveBeenCalledWith(
      "/repos/zorkian/roundhouse/actions/jobs/41/logs",
    );
  });

  it("reconciles the same failed check repeatedly at one revision without duplicating evidence", async () => {
    const { repository, run } = await setupCi();
    const api = githubFailure();
    const automation = new GitHubCiAutomation(repository, api.api);

    await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
    await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
    const attempts = await repository.attemptsForRevision(run.id, 6);
    expect(attempts).toHaveLength(1);
    const ci = attempts[0]?.result?.ci as Record<string, any>;
    expect(ci.reason).toBeUndefined();
    expect(ci.diagnostics.evidenceKey).toBe(`${head}:11:31:1`);
  });

  it("waits instead of paying a second repair for the same candidate and workflow attempt", async () => {
    const { repository, run } = await setupCi();
    const api = githubFailure();
    const automation = new GitHubCiAutomation(repository, api.api);

    await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
    await coordinate(
      repository,
      { submit: async () => undefined },
      { runId: run.id, expectedRevision: 6 },
      101,
    );
    // The repair cycle returns to CI on the unchanged candidate head, where
    // the same failed check and workflow attempt are still latest.
    const second = await returnToCi(repository, run.id, head);
    await expect(automation.reconcileCi(second, 200)).resolves.toBe("recorded");
    const ci = (await repository.getAttempt(`${run.id}_rev_9`))?.result
      ?.ci as Record<string, any>;
    expect(ci.status).toBe("failure");
    expect(ci.reason).toBe("evidence_consumed");
    expect(ci.diagnostics.evidenceKey).toBe(`${head}:11:31:1`);

    const submitted: Attempt[] = [];
    await coordinate(
      repository,
      {
        submit: async (attempt: Attempt) => {
          submitted.push(attempt);
        },
      },
      { runId: run.id, expectedRevision: 9 },
      201,
    );
    expect(submitted).toEqual([]);
    await expect(repository.get(run.id)).resolves.toMatchObject({
      status: "waiting",
      stage: "ci",
      waitingReason: "external_check",
      currentHead: head,
    });
  });

  it("dispatches one new repair when the same candidate gains a new workflow attempt", async () => {
    const { repository, run } = await setupCi();
    const first = githubFailure();
    const automation = new GitHubCiAutomation(repository, first.api);
    await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
    await coordinate(
      repository,
      { submit: async () => undefined },
      { runId: run.id, expectedRevision: 6 },
      101,
    );

    const second = await returnToCi(repository, run.id, head);
    const rerun = githubFailure({
      runAttempt: 2,
      checkRunId: 12,
      checkSuiteId: 22,
      workflowRunId: 31,
      jobId: 51,
    });
    await expect(
      new GitHubCiAutomation(repository, rerun.api).reconcileCi(second, 200),
    ).resolves.toBe("recorded");
    const ci = (await repository.getAttempt(`${run.id}_rev_9`))?.result
      ?.ci as Record<string, any>;
    expect(ci.reason).toBeUndefined();
    expect(ci.diagnostics.evidenceKey).toBe(`${head}:12:31:2`);
    expect(ci.diagnostics.failures[0].workflowRun.attempt).toBe(2);

    await coordinate(
      repository,
      { submit: async () => undefined },
      { runId: run.id, expectedRevision: 9 },
      201,
    );
    await expect(repository.get(run.id)).resolves.toMatchObject({
      status: "active",
      stage: "implement",
      revision: 10,
      currentHead: head,
    });
    const submitted: Attempt[] = [];
    await coordinate(
      repository,
      {
        submit: async (attempt: Attempt) => {
          submitted.push(attempt);
        },
      },
      { runId: run.id, expectedRevision: 10 },
      202,
    );
    expect(submitted).toHaveLength(1);
  });

  it("dispatches one new repair for a failed Actions run on a new candidate", async () => {
    const { repository, run } = await setupCi();
    const first = githubFailure();
    const automation = new GitHubCiAutomation(repository, first.api);
    await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
    await coordinate(
      repository,
      { submit: async () => undefined },
      { runId: run.id, expectedRevision: 6 },
      101,
    );

    const repaired = "d".repeat(40);
    const second = await returnToCi(repository, run.id, repaired);
    const next = githubFailure({ candidate: repaired });
    await expect(
      new GitHubCiAutomation(repository, next.api).reconcileCi(second, 200),
    ).resolves.toBe("recorded");
    const ci = (await repository.getAttempt(`${run.id}_rev_9`))?.result
      ?.ci as Record<string, any>;
    expect(ci.reason).toBeUndefined();
    expect(ci.head).toBe(repaired);
    expect(ci.diagnostics.evidenceKey).toBe(`${repaired}:11:31:1`);
    expect(ci.diagnostics.failures[0].candidateSha).toBe(repaired);

    await coordinate(
      repository,
      { submit: async () => undefined },
      { runId: run.id, expectedRevision: 9 },
      201,
    );
    await expect(repository.get(run.id)).resolves.toMatchObject({
      status: "active",
      stage: "implement",
      revision: 10,
      currentHead: repaired,
    });
  });

  it("waits with a truthful explanation when failed-job logs are inaccessible", async () => {
    const { repository, run } = await setupCi();
    const api = githubFailure({ logError: true });
    const automation = new GitHubCiAutomation(repository, api.api);

    await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
    const ci = (await repository.getAttempt(`${run.id}_rev_6`))?.result
      ?.ci as Record<string, any>;
    expect(ci.status).toBe("failure");
    expect(ci.reason).toBe("diagnostics_unavailable");
    expect(ci.diagnosticsError).toBe("github_get_404");
    expect(ci.diagnostics).toBeUndefined();

    const submitted: Attempt[] = [];
    await coordinate(
      repository,
      {
        submit: async (attempt: Attempt) => {
          submitted.push(attempt);
        },
      },
      { runId: run.id, expectedRevision: 6 },
      101,
    );
    expect(submitted).toEqual([]);
    await expect(repository.get(run.id)).resolves.toMatchObject({
      status: "waiting",
      stage: "ci",
      waitingReason: "external_check",
      revision: 7,
    });
  });

  it("waits when a failed check has no GitHub Actions workflow run", async () => {
    const { repository, run } = await setupCi();
    const api = githubFailure({ workflowRunFound: false });
    const automation = new GitHubCiAutomation(repository, api.api);

    await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
    const ci = (await repository.getAttempt(`${run.id}_rev_6`))?.result
      ?.ci as Record<string, any>;
    expect(ci.reason).toBe("diagnostics_unavailable");
    expect(ci.diagnosticsError).toContain(
      'failed check "test" has no GitHub Actions workflow run',
    );
    await coordinate(
      repository,
      { submit: async () => undefined },
      { runId: run.id, expectedRevision: 6 },
      101,
    );
    await expect(repository.get(run.id)).resolves.toMatchObject({
      status: "waiting",
      stage: "ci",
      waitingReason: "external_check",
    });
  });

  it.each([
    [
      "a workflow run that moved off the candidate head",
      { workflowHead: "e".repeat(40) },
      "no longer matches the candidate head",
    ],
    [
      "a failed job that moved off the candidate head",
      { jobHead: "e".repeat(40) },
      "is not bound to the exact candidate head",
    ],
    [
      "a failed job without candidate-head metadata",
      { jobHead: null },
      "is not bound to the exact candidate head",
    ],
    [
      "a failed job that belongs to a different workflow attempt",
      { jobAttempt: 2 },
      "is not bound to workflow attempt 1",
    ],
    [
      "a failed job without workflow-attempt metadata",
      { jobAttempt: null },
      "is not bound to workflow attempt 1",
    ],
    [
      "a failed check without a GitHub Actions job link",
      { detailsUrl: null },
      "does not link to its GitHub Actions job",
    ],
    [
      "a failed check whose Actions link names another workflow run",
      {
        detailsUrl:
          "https://github.test/zorkian/roundhouse/actions/runs/99/job/41",
      },
      "does not bind to its workflow run",
    ],
    [
      "a failed check whose Actions link names a job that did not fail",
      {
        detailsUrl:
          "https://github.test/zorkian/roundhouse/actions/runs/31/job/42",
      },
      "has no failed job matching its Actions link",
    ],
    ["malformed workflow jobs", { jobsMalformed: true }, "malformed"],
    [
      "a workflow attempt without failed jobs",
      { noFailedJobs: true },
      "has no failed jobs",
    ],
  ] as const)(
    "waits when diagnostics find %s",
    async (_label, options, explanation) => {
      const { repository, run } = await setupCi();
      const api = githubFailure(options);
      const automation = new GitHubCiAutomation(repository, api.api);

      await expect(automation.reconcileCi(run, 100)).resolves.toBe("recorded");
      const ci = (await repository.getAttempt(`${run.id}_rev_6`))?.result
        ?.ci as Record<string, any>;
      expect(ci.reason).toBe("diagnostics_unavailable");
      expect(ci.diagnosticsError).toContain(explanation);
      expect(ci.diagnostics).toBeUndefined();
      await coordinate(
        repository,
        { submit: async () => undefined },
        { runId: run.id, expectedRevision: 6 },
        101,
      );
      await expect(repository.get(run.id)).resolves.toMatchObject({
        status: "waiting",
        stage: "ci",
        waitingReason: "external_check",
      });
    },
  );

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
    const next = await repository.get(run.id);
    expect(next).toMatchObject({
      status: "active",
      stage: "integrate",
      revision: 8,
      currentHead: head,
    });
    expect(next?.targetBaseHead).toBeUndefined();
    expect(next?.integrationHead).toBeUndefined();
  });

  it("clears the superseded validated integration head when reintegrating", async () => {
    const { repository, run } = await setupCi();
    const integrateAttempt: Attempt = {
      id: `${run.id}_rev_${run.revision}_integrate`,
      runId: run.id,
      runRevision: run.revision,
      kind: "agent",
      stage: "integrate",
      role: "integrate",
      state: "created",
      deadlineAt: 1_000,
      baseCommit: run.baseCommit,
      expectedHead: head,
    };
    await repository.createAttempt(integrateAttempt);
    await repository.completeAttempt(
      integrateAttempt.id,
      integrateAttempt.runRevision,
      head,
      {
        integration: {
          status: "clean",
          candidateHead: head,
          baseHead: "e".repeat(40),
          head,
        },
      },
    );
    const integrated = await repository.transition(run.id, run.revision, {
      status: "active",
      stage: "ci",
      heads: {
        targetBaseHead: "e".repeat(40),
        integrationHead: head,
      },
    });
    if (!integrated) throw new Error("run_missing");
    const api = github(head, "success", true, [], {
      baseSha: "9".repeat(40),
    });
    await expect(
      new GitHubCiAutomation(repository, api.api).reconcileCi(integrated, 100),
    ).resolves.toBe("recorded");
    const next = await repository.get(run.id);
    expect(next).toMatchObject({ status: "active", stage: "integrate" });
    expect(next?.targetBaseHead).toBeUndefined();
    expect(next?.integrationHead).toBeUndefined();
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
    const next = await repository.get(run.id);
    expect(next).toMatchObject({
      status: "active",
      stage: "integrate",
      currentHead: integration,
      reviewedHead: head,
    });
    expect(next?.targetBaseHead).toBeUndefined();
    expect(next?.integrationHead).toBeUndefined();
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
