// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ControlPlaneEnv } from "./environment.js";

export type AutomaticMergeIdentity = {
  repositoryFullName: string;
  pullRequestNumber: number;
  runId: string;
  issueNumber: number;
  baseSha: string;
  headSha: string;
};

export type AutomaticMergeClaim = AutomaticMergeIdentity & {
  claimId: string;
  attemptCount: number;
};

export function automaticMergePolicy(input: {
  environment: "development" | "production";
  enabled: boolean;
  sourceEnvironment?: "development" | "production";
  risk: "low" | "medium" | "high";
  planMaterialized: boolean;
  runBoundToPlan: boolean;
  approvalMatches: boolean;
}): boolean {
  return (
    input.environment === "development" &&
    input.enabled &&
    input.sourceEnvironment === "development" &&
    input.risk === "low" &&
    input.planMaterialized &&
    input.runBoundToPlan &&
    input.approvalMatches
  );
}

export function automaticMergeApprovalMatches(
  planApprovedBy: unknown,
  runApprovedBy: unknown,
): boolean {
  return (
    typeof planApprovedBy === "string" &&
    planApprovedBy.length > 0 &&
    planApprovedBy === runApprovedBy
  );
}

type AutomaticMergeRow = {
  repository_full_name: string;
  pull_request_number: number;
  run_id: string;
  issue_number: number;
  base_sha: string;
  head_sha: string;
  status: "pending" | "merging" | "merged" | "blocked";
  attempt_count: number;
  claim_id: string | null;
  claim_expires_at: string | null;
  merge_commit_sha: string | null;
  failure_code: string | null;
  next_action: string | null;
  projection_completed_at: string | null;
};

function identity(row: AutomaticMergeRow): AutomaticMergeIdentity {
  return {
    repositoryFullName: row.repository_full_name,
    pullRequestNumber: row.pull_request_number,
    runId: row.run_id,
    issueNumber: row.issue_number,
    baseSha: row.base_sha,
    headSha: row.head_sha,
  };
}

async function read(
  env: ControlPlaneEnv,
  value: Pick<
    AutomaticMergeIdentity,
    "repositoryFullName" | "pullRequestNumber" | "headSha"
  >,
): Promise<AutomaticMergeRow | undefined> {
  return (
    (await env.DB.prepare(
      "SELECT repository_full_name, pull_request_number, run_id, issue_number, base_sha, head_sha, status, attempt_count, claim_id, claim_expires_at, merge_commit_sha, failure_code, next_action, projection_completed_at FROM github_automatic_merges WHERE repository_full_name = ? AND pull_request_number = ? AND head_sha = ?",
    )
      .bind(value.repositoryFullName, value.pullRequestNumber, value.headSha)
      .first<AutomaticMergeRow>()) ?? undefined
  );
}

export async function automaticMergeRecoveryStatus(
  env: ControlPlaneEnv,
  value: AutomaticMergeIdentity,
): Promise<"pending" | "merging" | "merged" | "blocked" | undefined> {
  const retained = await read(env, value);
  if (
    retained &&
    retained.run_id === value.runId &&
    retained.issue_number === value.issueNumber &&
    retained.base_sha === value.baseSha
  )
    return retained.status;
  return undefined;
}

export async function claimAutomaticMerge(
  env: ControlPlaneEnv,
  value: AutomaticMergeIdentity,
  now = new Date(),
): Promise<
  | { kind: "claimed"; claim: AutomaticMergeClaim }
  | { kind: "in_progress" | "blocked" }
  | { kind: "merged"; mergeCommitSha: string; projectionComplete: boolean }
> {
  const occurredAt = now.toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_automatic_merges(repository_full_name, pull_request_number, run_id, issue_number, base_sha, head_sha, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
  )
    .bind(
      value.repositoryFullName,
      value.pullRequestNumber,
      value.runId,
      value.issueNumber,
      value.baseSha,
      value.headSha,
      occurredAt,
      occurredAt,
    )
    .run();
  const retained = await read(env, value);
  if (
    !retained ||
    retained.run_id !== value.runId ||
    retained.issue_number !== value.issueNumber ||
    retained.base_sha !== value.baseSha
  )
    throw new Error("Automatic merge identity conflict");
  if (retained.status === "merged") {
    if (!/^[a-f0-9]{40}$/.test(retained.merge_commit_sha ?? ""))
      throw new Error("Automatic merge completion is invalid");
    return {
      kind: "merged",
      mergeCommitSha: retained.merge_commit_sha!,
      projectionComplete: retained.projection_completed_at !== null,
    };
  }
  if (retained.status === "blocked") return { kind: "blocked" };
  if (
    retained.status === "merging" &&
    retained.claim_expires_at &&
    Date.parse(retained.claim_expires_at) > now.getTime()
  )
    return { kind: "in_progress" };
  if (retained.attempt_count >= 3) {
    const blocked = await env.DB.prepare(
      "UPDATE github_automatic_merges SET status = 'blocked', claim_id = NULL, claim_expires_at = NULL, failure_code = COALESCE(failure_code, 'attempts_exhausted'), next_action = COALESCE(next_action, 'Inspect the pull request merge state, then request a new exact-head attempt if it is still safe.'), updated_at = ? WHERE repository_full_name = ? AND pull_request_number = ? AND head_sha = ? AND status != 'merged' AND attempt_count >= 3 AND (status != 'merging' OR claim_expires_at <= ?)",
    )
      .bind(
        occurredAt,
        value.repositoryFullName,
        value.pullRequestNumber,
        value.headSha,
        occurredAt,
      )
      .run();
    if ((blocked.meta.changes ?? 0) !== 1) {
      const current = await read(env, value);
      if (current?.status === "merged") {
        if (!/^[a-f0-9]{40}$/.test(current.merge_commit_sha ?? ""))
          throw new Error("Automatic merge completion is invalid");
        return {
          kind: "merged",
          mergeCommitSha: current.merge_commit_sha!,
          projectionComplete: current.projection_completed_at !== null,
        };
      }
      if (current?.status === "merging") return { kind: "in_progress" };
    }
    return { kind: "blocked" };
  }
  const claimId = crypto.randomUUID();
  const claimExpiresAt = new Date(now.getTime() + 2 * 60_000).toISOString();
  const claimed = await env.DB.prepare(
    "UPDATE github_automatic_merges SET status = 'merging', attempt_count = attempt_count + 1, claim_id = ?, claim_expires_at = ?, failure_code = NULL, next_action = NULL, updated_at = ? WHERE repository_full_name = ? AND pull_request_number = ? AND head_sha = ? AND attempt_count < 3 AND (status = 'pending' OR (status = 'merging' AND claim_expires_at <= ?))",
  )
    .bind(
      claimId,
      claimExpiresAt,
      occurredAt,
      value.repositoryFullName,
      value.pullRequestNumber,
      value.headSha,
      occurredAt,
    )
    .run();
  if ((claimed.meta.changes ?? 0) !== 1) {
    const winner = await read(env, value);
    if (winner?.status === "merged") {
      if (!/^[a-f0-9]{40}$/.test(winner.merge_commit_sha ?? ""))
        throw new Error("Automatic merge completion is invalid");
      return {
        kind: "merged",
        mergeCommitSha: winner.merge_commit_sha!,
        projectionComplete: winner.projection_completed_at !== null,
      };
    }
    if (winner?.status === "blocked") return { kind: "blocked" };
    return { kind: "in_progress" };
  }
  return {
    kind: "claimed",
    claim: {
      ...identity(retained),
      claimId,
      attemptCount: retained.attempt_count + 1,
    },
  };
}

export async function blockIneligibleAutomaticMerge(
  env: ControlPlaneEnv,
  value: AutomaticMergeIdentity,
  now = new Date(),
): Promise<void> {
  await env.DB.prepare(
    "UPDATE github_automatic_merges SET status = 'blocked', claim_id = NULL, claim_expires_at = NULL, failure_code = 'no_longer_eligible', next_action = 'The retained run is no longer eligible for automatic merge. Review the current pull request state before taking any further action.', updated_at = ?, completed_at = ? WHERE repository_full_name = ? AND pull_request_number = ? AND head_sha = ? AND run_id = ? AND base_sha = ? AND (status = 'pending' OR (status = 'merging' AND claim_expires_at <= ?))",
  )
    .bind(
      now.toISOString(),
      now.toISOString(),
      value.repositoryFullName,
      value.pullRequestNumber,
      value.headSha,
      value.runId,
      value.baseSha,
      now.toISOString(),
    )
    .run();
}

export async function completeAutomaticMerge(
  env: ControlPlaneEnv,
  claim: AutomaticMergeClaim,
  mergeCommitSha: string,
  now = new Date(),
): Promise<void> {
  if (!/^[a-f0-9]{40}$/.test(mergeCommitSha))
    throw new Error("Automatic merge commit is invalid");
  const occurredAt = now.toISOString();
  const completed = await env.DB.prepare(
    "UPDATE github_automatic_merges SET status = 'merged', merge_commit_sha = ?, claim_id = NULL, claim_expires_at = NULL, failure_code = NULL, next_action = NULL, updated_at = ?, completed_at = ? WHERE repository_full_name = ? AND pull_request_number = ? AND head_sha = ? AND status = 'merging' AND claim_id = ?",
  )
    .bind(
      mergeCommitSha,
      occurredAt,
      occurredAt,
      claim.repositoryFullName,
      claim.pullRequestNumber,
      claim.headSha,
      claim.claimId,
    )
    .run();
  if ((completed.meta.changes ?? 0) !== 1)
    throw new Error("Automatic merge claim changed before completion");
}

export async function failAutomaticMerge(
  env: ControlPlaneEnv,
  claim: AutomaticMergeClaim,
  failure: { code: string; retryable: boolean; nextAction: string },
  now = new Date(),
): Promise<void> {
  const retryable = failure.retryable && claim.attemptCount < 3;
  const failed = await env.DB.prepare(
    "UPDATE github_automatic_merges SET status = ?, claim_id = NULL, claim_expires_at = NULL, failure_code = ?, next_action = ?, updated_at = ? WHERE repository_full_name = ? AND pull_request_number = ? AND head_sha = ? AND status = 'merging' AND claim_id = ?",
  )
    .bind(
      retryable ? "pending" : "blocked",
      failure.code.slice(0, 200),
      failure.nextAction.slice(0, 1000),
      now.toISOString(),
      claim.repositoryFullName,
      claim.pullRequestNumber,
      claim.headSha,
      claim.claimId,
    )
    .run();
  if ((failed.meta.changes ?? 0) !== 1)
    throw new Error("Automatic merge claim changed before failure recording");
}

export async function completeAutomaticMergeProjection(
  env: ControlPlaneEnv,
  value: AutomaticMergeIdentity,
  mergeCommitSha: string,
  now = new Date(),
): Promise<void> {
  const projected = await env.DB.prepare(
    "UPDATE github_automatic_merges SET projection_completed_at = ?, updated_at = ? WHERE repository_full_name = ? AND pull_request_number = ? AND head_sha = ? AND status = 'merged' AND merge_commit_sha = ? AND projection_completed_at IS NULL",
  )
    .bind(
      now.toISOString(),
      now.toISOString(),
      value.repositoryFullName,
      value.pullRequestNumber,
      value.headSha,
      mergeCommitSha,
    )
    .run();
  if ((projected.meta.changes ?? 0) === 1) return;
  const retained = await read(env, value);
  if (
    retained?.status === "merged" &&
    retained.merge_commit_sha === mergeCommitSha &&
    retained.projection_completed_at !== null
  )
    return;
  throw new Error("Automatic merge result changed before projection");
}

export async function recoverableAutomaticMerges(
  env: ControlPlaneEnv,
  now = new Date(),
): Promise<AutomaticMergeIdentity[]> {
  const rows = await env.DB.prepare(
    "SELECT repository_full_name, pull_request_number, run_id, issue_number, base_sha, head_sha, status, attempt_count, claim_id, claim_expires_at, merge_commit_sha, failure_code, next_action, projection_completed_at FROM github_automatic_merges WHERE status = 'pending' OR (status = 'merging' AND claim_expires_at <= ?) OR (status = 'merged' AND projection_completed_at IS NULL) ORDER BY updated_at LIMIT 100",
  )
    .bind(now.toISOString())
    .all<AutomaticMergeRow>();
  return rows.results.map(identity);
}
