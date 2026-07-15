// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ControlPlaneEnv } from "./environment.js";

export const githubCiMigration = `
CREATE TABLE IF NOT EXISTS github_ci_outcomes (
  repository_full_name TEXT NOT NULL, pull_request_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL, check_run_id INTEGER NOT NULL, app_id INTEGER,
  app_slug TEXT, actions_job_id INTEGER, check_name TEXT, details_url TEXT,
  status TEXT NOT NULL, conclusion TEXT, observed_at TEXT NOT NULL,
  PRIMARY KEY (repository_full_name, pull_request_number, head_sha, check_run_id)
);
CREATE TABLE IF NOT EXISTS github_ci_remediations (
  repository_full_name TEXT NOT NULL, pull_request_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL, check_run_id INTEGER NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN
    ('diagnosing', 'rerun_requested', 'remediation_started', 'manual_required', 'resolved')),
  attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 0 AND 1),
  classification TEXT, evidence_sha256 TEXT, evidence_excerpt TEXT,
  remediation_run_id TEXT, next_action TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (repository_full_name, pull_request_number, head_sha, check_run_id)
);
`;

export type CiObservation = {
  repositoryFullName: string;
  pullRequestNumber: number;
  headSha: string;
  checkRunId: number;
  appId?: number;
  appSlug?: string;
  actionsJobId?: number;
  name?: string;
  detailsUrl?: string;
  status: string;
  conclusion?: string;
};

export async function isRoundhouseReviewCheck(
  env: ControlPlaneEnv,
  value: CiObservation,
  configuredAppId?: number,
): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 AS found FROM github_review_check_outbox WHERE repository_full_name = ? AND pull_request_number = ? AND head_sha = ? AND check_run_id = ? LIMIT 1",
  )
    .bind(
      value.repositoryFullName,
      value.pullRequestNumber,
      value.headSha,
      value.checkRunId,
    )
    .first<{ found: number }>();
  return (
    row?.found === 1 &&
    (configuredAppId === undefined || value.appId === configuredAppId)
  );
}

export async function recordCiOutcome(
  env: ControlPlaneEnv,
  value: CiObservation,
): Promise<void> {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO github_ci_outcomes(repository_full_name, pull_request_number, head_sha, check_run_id, app_id, app_slug, actions_job_id, check_name, details_url, status, conclusion, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      value.repositoryFullName,
      value.pullRequestNumber,
      value.headSha,
      value.checkRunId,
      value.appId ?? null,
      value.appSlug ?? null,
      value.actionsJobId ?? null,
      value.name ?? null,
      value.detailsUrl ?? null,
      value.status,
      value.conclusion ?? null,
      new Date().toISOString(),
    )
    .run();
}

export async function reserveCiRecovery(
  env: ControlPlaneEnv,
  value: CiObservation,
): Promise<"reserved" | "duplicate" | "exhausted"> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO github_ci_remediations(repository_full_name, pull_request_number, head_sha, check_run_id, disposition, attempt_count, created_at, updated_at) SELECT ?, ?, ?, ?, 'diagnosing', 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM github_ci_remediations WHERE repository_full_name = ? AND pull_request_number = ? AND head_sha = ?)",
  )
    .bind(
      value.repositoryFullName,
      value.pullRequestNumber,
      value.headSha,
      value.checkRunId,
      now,
      now,
      value.repositoryFullName,
      value.pullRequestNumber,
      value.headSha,
    )
    .run();
  if ((result.meta.changes ?? 0) === 1) return "reserved";
  const duplicate = await env.DB.prepare(
    "SELECT 1 AS found FROM github_ci_remediations WHERE repository_full_name = ? AND pull_request_number = ? AND head_sha = ? AND check_run_id = ? LIMIT 1",
  )
    .bind(
      value.repositoryFullName,
      value.pullRequestNumber,
      value.headSha,
      value.checkRunId,
    )
    .first<{ found: number }>();
  if (duplicate?.found === 1) return "duplicate";
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_ci_remediations(repository_full_name, pull_request_number, head_sha, check_run_id, disposition, attempt_count, classification, next_action, created_at, updated_at) VALUES (?, ?, ?, ?, 'manual_required', 0, 'recovery_exhausted', 'Inspect the failing Check; the automatic recovery budget for this exact head is exhausted.', ?, ?)",
  )
    .bind(
      value.repositoryFullName,
      value.pullRequestNumber,
      value.headSha,
      value.checkRunId,
      now,
      now,
    )
    .run();
  return "exhausted";
}

export async function recordCiRecovery(
  env: ControlPlaneEnv,
  value: CiObservation,
  update: {
    disposition:
      | "rerun_requested"
      | "remediation_started"
      | "manual_required"
      | "resolved";
    classification: string;
    evidenceSha256?: string;
    evidenceExcerpt?: string;
    remediationRunId?: string;
    nextAction?: string;
  },
): Promise<void> {
  await env.DB.prepare(
    "UPDATE github_ci_remediations SET disposition = ?, classification = ?, evidence_sha256 = ?, evidence_excerpt = ?, remediation_run_id = ?, next_action = ?, updated_at = ? WHERE repository_full_name = ? AND pull_request_number = ? AND head_sha = ? AND check_run_id = ?",
  )
    .bind(
      update.disposition,
      update.classification,
      update.evidenceSha256 ?? null,
      update.evidenceExcerpt?.slice(0, 8192) ?? null,
      update.remediationRunId ?? null,
      update.nextAction ?? null,
      new Date().toISOString(),
      value.repositoryFullName,
      value.pullRequestNumber,
      value.headSha,
      value.checkRunId,
    )
    .run();
}

export async function resolveCiRecoveriesForHead(
  env: ControlPlaneEnv,
  value: CiObservation,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE github_ci_remediations SET disposition = 'resolved', classification = 'ci_passed', next_action = 'No action is needed.', updated_at = ? WHERE repository_full_name = ? AND pull_request_number = ? AND head_sha = ? AND disposition IN ('diagnosing', 'rerun_requested', 'manual_required')",
  )
    .bind(
      new Date().toISOString(),
      value.repositoryFullName,
      value.pullRequestNumber,
      value.headSha,
    )
    .run();
}

export function classifyCiFailure(logs: string): "transient" | "actionable" {
  return /(?:timed? out|connection reset|temporary failure|rate limit|runner (?:was )?lost|service unavailable)/i.test(
    logs,
  )
    ? "transient"
    : "actionable";
}

export async function exactHeadIsReady(
  env: ControlPlaneEnv,
  repositoryFullName: string,
  pullRequestNumber: number,
  headSha: string,
): Promise<boolean> {
  const review = await env.DB.prepare(
    "SELECT 1 AS found FROM github_review_check_outbox WHERE repository_full_name = ? AND pull_request_number = ? AND head_sha = ? AND check_status = 'completed' AND conclusion = 'success' AND status = 'sent' LIMIT 1",
  )
    .bind(repositoryFullName, pullRequestNumber, headSha)
    .first<{ found: number }>();
  if (review?.found !== 1) return false;
  const ci = await env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' AND conclusion IN ('success', 'neutral', 'skipped') THEN 1 ELSE 0 END) AS passing FROM github_ci_outcomes WHERE repository_full_name = ? AND pull_request_number = ? AND head_sha = ?",
  )
    .bind(repositoryFullName, pullRequestNumber, headSha)
    .first<{ total: number; passing: number }>();
  return Boolean(ci && ci.total > 0 && ci.total === ci.passing);
}
