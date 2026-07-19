// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  immutableAttemptId,
  type Attempt,
  type RunRepository,
  type RunSnapshot,
  type Wakeup,
} from "@roundhouse/core";
import {
  enrolledRepository,
  findPullRequest,
  verifyGitHubWebhook,
  type GitHubAutomationApi,
  type GitHubEnv,
  type OpenPullRequest,
} from "./github.js";

export interface GitHubAutomationRepository extends RunRepository {
  recordGitHubDelivery(
    runId: string,
    deliveryId: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<boolean>;
}

interface CheckRun {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly head_sha: string;
  readonly html_url?: string | null;
  readonly details_url?: string | null;
}

interface PullRequest extends OpenPullRequest {
  readonly node_id: string;
  readonly draft: boolean;
  readonly state: string;
  readonly merged: boolean;
  readonly mergeable: boolean | null;
  readonly head: { readonly sha: string };
}

interface CheckSuitePayload {
  readonly action?: string;
  readonly repository?: { readonly full_name?: string };
  readonly check_suite?: {
    readonly head_branch?: string | null;
    readonly head_sha?: string;
  };
}

function exactAttempt(
  attempt: Attempt | undefined,
  stage: "review" | "ci",
  head: string,
  status: string,
): attempt is Attempt {
  const outcome = attempt?.result?.[stage] as
    Record<string, unknown> | undefined;
  return Boolean(
    attempt &&
    attempt.stage === stage &&
    attempt.expectedHead === head &&
    attempt.acceptedHead === head &&
    outcome?.status === status,
  );
}

async function pullRequest(
  github: GitHubAutomationApi,
  run: RunSnapshot,
  state: "open" | "all" = "open",
): Promise<PullRequest | undefined> {
  const found = await findPullRequest(github, run, state);
  if (!found) return undefined;
  return github.get<PullRequest>(
    `/repos/${run.repository}/pulls/${found.number}`,
  );
}

async function checkRuns(
  github: GitHubAutomationApi,
  run: RunSnapshot,
): Promise<readonly CheckRun[]> {
  const response = await github.get<{
    readonly total_count: number;
    readonly check_runs: readonly CheckRun[];
  }>(
    `/repos/${run.repository}/commits/${run.currentHead}/check-runs?filter=latest&per_page=100`,
  );
  return response.total_count > 0 ? response.check_runs : [];
}

function checksSucceeded(checks: readonly CheckRun[], head: string): boolean {
  return (
    checks.length > 0 &&
    checks.every(
      (check) =>
        check.head_sha === head &&
        check.status === "completed" &&
        (check.conclusion === "success" || check.conclusion === "skipped"),
    )
  );
}

function checksCompleted(checks: readonly CheckRun[], head: string): boolean {
  return (
    checks.length > 0 &&
    checks.every(
      (check) => check.head_sha === head && check.status === "completed",
    )
  );
}

function checkEvidence(checks: readonly CheckRun[]) {
  return checks.map((check) => ({
    name: check.name,
    status: check.status,
    conclusion: check.conclusion,
    url: check.html_url ?? check.details_url ?? undefined,
  }));
}

async function markReady(
  github: GitHubAutomationApi,
  pull: PullRequest,
): Promise<void> {
  if (!pull.draft) return;
  const result = await github.graphql<{
    readonly markPullRequestReadyForReview?: {
      readonly pullRequest?: { readonly isDraft: boolean };
    };
  }>(
    "mutation Ready($pullRequestId: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $pullRequestId}) { pullRequest { isDraft } } }",
    { pullRequestId: pull.node_id },
  );
  if (result.markPullRequestReadyForReview?.pullRequest?.isDraft !== false)
    throw new Error("github_pull_request_still_draft");
}

export class GitHubCiAutomation {
  constructor(
    private readonly repository: GitHubAutomationRepository,
    private readonly github: GitHubAutomationApi,
  ) {}

  async reconcileCi(
    run: RunSnapshot,
    now = Date.now(),
  ): Promise<"recorded" | "pending" | "stale"> {
    if (run.status !== "active" || run.stage !== "ci") return "stale";
    const review = await this.repository.latestCompletedAttempt(
      run.id,
      "review",
      run.revision,
    );
    if (!exactAttempt(review, "review", run.currentHead, "clean"))
      return "stale";
    let pull = await pullRequest(this.github, run);
    if (!pull || pull.state !== "open" || pull.head.sha !== run.currentHead)
      return "stale";
    if (pull.mergeable === false)
      return this.recordCi(
        run,
        pull,
        [
          {
            name: "Pull request base",
            status: "completed",
            conclusion: "failure",
            head_sha: run.currentHead,
          },
        ],
        "failure",
        now,
        "base_conflict",
      );
    let checks = await checkRuns(this.github, run);
    if (!checksCompleted(checks, run.currentHead)) return "pending";
    if (!checksSucceeded(checks, run.currentHead))
      return this.recordCi(run, pull, checks, "failure", now);

    await markReady(this.github, pull);
    pull = await pullRequest(this.github, run);
    checks = await checkRuns(this.github, run);
    const current = await this.repository.get(run.id);
    const currentReview = await this.repository.latestCompletedAttempt(
      run.id,
      "review",
      run.revision,
    );
    if (
      !current ||
      current.revision !== run.revision ||
      current.status !== "active" ||
      current.stage !== "ci" ||
      current.currentHead !== run.currentHead ||
      !exactAttempt(currentReview, "review", run.currentHead, "clean") ||
      !pull ||
      pull.state !== "open" ||
      pull.draft ||
      pull.head.sha !== run.currentHead
    )
      return "stale";
    if (!checksSucceeded(checks, run.currentHead)) return "pending";

    return this.recordCi(run, pull, checks, "success", now);
  }

  private async recordCi(
    run: RunSnapshot,
    pull: PullRequest,
    checks: readonly CheckRun[],
    status: "success" | "failure",
    now: number,
    reason?: "base_conflict",
  ): Promise<"recorded" | "stale"> {
    const attempt: Attempt = {
      id: immutableAttemptId(run.id, run.revision),
      runId: run.id,
      runRevision: run.revision,
      kind: "external",
      stage: "ci",
      role: "github-checks",
      state: "created",
      deadlineAt: now,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
    };
    await this.repository.createAttempt(attempt);
    const outcome = await this.repository.completeAttempt(
      attempt.id,
      run.revision,
      run.currentHead,
      {
        ci: {
          status,
          ...(reason ? { reason } : {}),
          head: run.currentHead,
          pullRequest: { number: pull.number, html_url: pull.html_url },
          checks: checkEvidence(checks),
        },
      },
    );
    return outcome === "stale" ? "stale" : "recorded";
  }

  async merge(
    run: RunSnapshot,
    now = Date.now(),
    leaseMilliseconds = 30 * 60_000,
  ): Promise<"recorded" | "pending" | "stale"> {
    if (run.status !== "active" || run.stage !== "merge") return "stale";
    const attemptId = immutableAttemptId(run.id, run.revision);
    const previous = await this.repository.getAttempt(attemptId);
    if (previous?.state === "completed") return "recorded";
    const [review, ci, pull, checks] = await Promise.all([
      this.repository.latestCompletedAttempt(run.id, "review", run.revision),
      this.repository.latestCompletedAttempt(run.id, "ci", run.revision),
      pullRequest(this.github, run, "all"),
      checkRuns(this.github, run),
    ]);
    if (
      !exactAttempt(review, "review", run.currentHead, "clean") ||
      !exactAttempt(ci, "ci", run.currentHead, "success") ||
      !pull ||
      pull.head.sha !== run.currentHead
    )
      return "stale";
    if (
      !pull.merged &&
      (pull.draft || !checksSucceeded(checks, run.currentHead))
    )
      return "pending";

    const claimed = await this.repository.claimLease(
      run.id,
      run.revision,
      {
        attemptId,
        runRevision: run.revision,
        expiresAt: now + leaseMilliseconds,
      },
      now,
    );
    if (!claimed) return "pending";
    const attempt: Attempt = {
      id: attemptId,
      runId: run.id,
      runRevision: run.revision,
      kind: "external",
      stage: "merge",
      role: "github-merge",
      state: "created",
      deadlineAt: now + leaseMilliseconds,
      baseCommit: run.baseCommit,
      expectedHead: run.currentHead,
    };
    await this.repository.createAttempt(attempt);
    await this.repository.markDispatched(attempt.id);

    const result = pull.merged
      ? { merged: true, sha: pull.merge_commit_sha }
      : await this.github.put<{
          readonly merged: boolean;
          readonly sha?: string;
        }>(`/repos/${run.repository}/pulls/${pull.number}/merge`, {
          sha: run.currentHead,
          merge_method: "merge",
        });
    if (!result.merged || !result.sha || !/^[a-f0-9]{40}$/.test(result.sha))
      throw new Error("github_pull_request_not_merged");
    const outcome = await this.repository.completeAttempt(
      attempt.id,
      run.revision,
      result.sha,
      {
        merge: {
          status: "merged",
          head: run.currentHead,
          mergeCommit: result.sha,
          pullRequest: { number: pull.number, html_url: pull.html_url },
        },
      },
    );
    return outcome === "stale" ? "stale" : "recorded";
  }
}

function runIdFromBranch(
  branch: string | null | undefined,
): string | undefined {
  const match = /^roundhouse\/issue-(\d+)$/.exec(branch ?? "");
  return match ? `run_zorkian_roundhouse_issue_${match[1]}` : undefined;
}

export async function acceptGitHubCheckSuite(
  request: Request,
  env: GitHubEnv,
  repository: GitHubAutomationRepository,
  enqueue: (wakeup: Wakeup) => Promise<void>,
): Promise<"accepted" | "duplicate" | "ignored" | "unauthorized"> {
  const deliveryId = request.headers.get("x-github-delivery");
  const event = request.headers.get("x-github-event");
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!deliveryId || event !== "check_suite") return "ignored";
  const raw = await request.text();
  if (
    !(await verifyGitHubWebhook(
      raw,
      signature,
      env.ROUNDHOUSE_GITHUB_WEBHOOK_SECRET,
    ))
  )
    return "unauthorized";
  const payload = JSON.parse(raw) as CheckSuitePayload;
  if (
    payload.action !== "completed" ||
    payload.repository?.full_name !== enrolledRepository.repository
  )
    return "ignored";
  const id = runIdFromBranch(payload.check_suite?.head_branch);
  const run = id ? await repository.get(id) : undefined;
  if (
    !id ||
    !run ||
    run.status !== "active" ||
    run.stage !== "ci" ||
    payload.check_suite?.head_sha !== run.currentHead
  )
    return "ignored";
  const fresh = await repository.recordGitHubDelivery(id, deliveryId, {
    event,
    issueNumber: run.issueNumber,
    head: run.currentHead,
  });
  if (!fresh) return "duplicate";
  await enqueue({ runId: run.id, expectedRevision: run.revision });
  return "accepted";
}
