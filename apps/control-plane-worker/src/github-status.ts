// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

import type { ControlPlaneEnv } from "./environment.js";

export const githubReviewCheckMigration = `
CREATE TABLE IF NOT EXISTS github_review_check_outbox (
  repository_full_name TEXT NOT NULL,
  review_id TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  revision INTEGER NOT NULL,
  check_status TEXT NOT NULL CHECK (check_status IN ('in_progress', 'completed')),
  conclusion TEXT CHECK (
    conclusion IS NULL OR conclusion IN ('success', 'failure', 'neutral', 'action_required')
  ),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent')),
  check_run_id INTEGER,
  check_run_url TEXT,
  claim_id TEXT,
  claim_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  PRIMARY KEY (repository_full_name, review_id)
);
CREATE INDEX IF NOT EXISTS github_review_check_outbox_pending
  ON github_review_check_outbox(status, updated_at);
`;

const projectionSchema = z
  .object({
    repositoryFullName: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
    reviewId: z.string().regex(/^review_[a-f0-9]{40}$/),
    pullRequestNumber: z.number().int().positive(),
    headSha: z.string().regex(/^[a-f0-9]{40}$/),
    revision: z.number().int().positive(),
    status: z.enum(["in_progress", "completed"]),
    conclusion: z
      .enum(["success", "failure", "neutral", "action_required"])
      .nullable(),
    title: z.string().min(1).max(255),
    summary: z.string().min(1).max(65_535),
    detailsUrl: z
      .string()
      .regex(
        /^https:\/\/roundhouse-dev\.rm-rf\.rip\/reviews\/review_[a-f0-9]{40}$/,
      ),
  })
  .superRefine((value, context) => {
    if (
      (value.status === "in_progress" && value.conclusion !== null) ||
      (value.status === "completed" && value.conclusion === null)
    )
      context.addIssue({
        code: "custom",
        message: "GitHub Check status and conclusion do not match",
      });
  });

export type ReviewCheckProjection = z.infer<typeof projectionSchema>;

type Row = {
  repository_full_name: string;
  review_id: string;
  pull_request_number: number;
  head_sha: string;
  revision: number;
  check_status: "in_progress" | "completed";
  conclusion: ReviewCheckProjection["conclusion"];
  title: string;
  summary: string;
  details_url: string;
  status: "pending" | "sending" | "sent";
  check_run_id: number | null;
};

export async function enqueueReviewCheck(
  env: ControlPlaneEnv,
  input: ReviewCheckProjection,
): Promise<void> {
  const value = projectionSchema.parse(input);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_review_check_outbox(repository_full_name, review_id, pull_request_number, head_sha, revision, check_status, conclusion, title, summary, details_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
  )
    .bind(
      value.repositoryFullName,
      value.reviewId,
      value.pullRequestNumber,
      value.headSha,
      value.revision,
      value.status,
      value.conclusion,
      value.title,
      value.summary,
      value.detailsUrl,
      now,
      now,
    )
    .run();
  const current = await env.DB.prepare(
    "SELECT repository_full_name, review_id, pull_request_number, head_sha, revision, check_status, conclusion, title, summary, details_url, status, check_run_id FROM github_review_check_outbox WHERE repository_full_name = ? AND review_id = ?",
  )
    .bind(value.repositoryFullName, value.reviewId)
    .first<Row>();
  if (
    !current ||
    current.repository_full_name !== value.repositoryFullName ||
    current.pull_request_number !== value.pullRequestNumber ||
    current.head_sha !== value.headSha
  )
    throw new Error("GitHub review Check identity conflict");
  if (current.revision > value.revision) return;
  const unchanged =
    current.revision === value.revision &&
    current.check_status === value.status &&
    current.conclusion === value.conclusion &&
    current.title === value.title &&
    current.summary === value.summary &&
    current.details_url === value.detailsUrl;
  if (unchanged) return;
  await env.DB.prepare(
    "UPDATE github_review_check_outbox SET revision = ?, check_status = ?, conclusion = ?, title = ?, summary = ?, details_url = ?, status = 'pending', claim_id = NULL, claim_expires_at = NULL, updated_at = ? WHERE repository_full_name = ? AND review_id = ? AND revision <= ?",
  )
    .bind(
      value.revision,
      value.status,
      value.conclusion,
      value.title,
      value.summary,
      value.detailsUrl,
      now,
      value.repositoryFullName,
      value.reviewId,
      value.revision,
    )
    .run();
}

export type ClaimedReviewCheck = ReviewCheckProjection & {
  claimId: string;
  checkRunId?: number;
};

export async function claimPendingReviewChecks(
  env: ControlPlaneEnv,
): Promise<ClaimedReviewCheck[]> {
  const nowValue = new Date();
  const now = nowValue.toISOString();
  const rows = await env.DB.prepare(
    "SELECT repository_full_name, review_id, pull_request_number, head_sha, revision, check_status, conclusion, title, summary, details_url, status, check_run_id FROM github_review_check_outbox WHERE status = 'pending' OR (status = 'sending' AND claim_expires_at <= ?) ORDER BY updated_at ASC LIMIT 20",
  )
    .bind(now)
    .all<Row>();
  const claimed: ClaimedReviewCheck[] = [];
  for (const row of rows.results) {
    const claimId = crypto.randomUUID();
    const expiresAt = new Date(nowValue.getTime() + 60_000).toISOString();
    const result = await env.DB.prepare(
      "UPDATE github_review_check_outbox SET status = 'sending', claim_id = ?, claim_expires_at = ? WHERE repository_full_name = ? AND review_id = ? AND revision = ? AND (status = 'pending' OR (status = 'sending' AND claim_expires_at <= ?))",
    )
      .bind(
        claimId,
        expiresAt,
        row.repository_full_name,
        row.review_id,
        row.revision,
        now,
      )
      .run();
    if ((result.meta.changes ?? 0) !== 1) continue;
    claimed.push({
      repositoryFullName: row.repository_full_name,
      reviewId: row.review_id,
      pullRequestNumber: row.pull_request_number,
      headSha: row.head_sha,
      revision: row.revision,
      status: row.check_status,
      conclusion: row.conclusion,
      title: row.title,
      summary: row.summary,
      detailsUrl: row.details_url,
      claimId,
      checkRunId: row.check_run_id ?? undefined,
    });
  }
  return claimed;
}

export async function markReviewCheckSent(
  env: ControlPlaneEnv,
  repositoryFullName: string,
  reviewId: string,
  revision: number,
  claimId: string,
  result: { id: number; url: string },
): Promise<void> {
  const now = new Date().toISOString();
  const sent = await env.DB.prepare(
    "UPDATE github_review_check_outbox SET status = 'sent', check_run_id = ?, check_run_url = ?, claim_id = NULL, claim_expires_at = NULL, sent_at = ?, updated_at = ? WHERE repository_full_name = ? AND review_id = ? AND revision = ? AND status = 'sending' AND claim_id = ?",
  )
    .bind(
      result.id,
      result.url,
      now,
      now,
      repositoryFullName,
      reviewId,
      revision,
      claimId,
    )
    .run();
  if ((sent.meta.changes ?? 0) !== 1)
    throw new Error("GitHub review Check claim was superseded");
}

export async function releaseReviewCheckClaim(
  env: ControlPlaneEnv,
  repositoryFullName: string,
  reviewId: string,
  revision: number,
  claimId: string,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE github_review_check_outbox SET status = 'pending', claim_id = NULL, claim_expires_at = NULL WHERE repository_full_name = ? AND review_id = ? AND revision = ? AND status = 'sending' AND claim_id = ?",
  )
    .bind(repositoryFullName, reviewId, revision, claimId)
    .run();
}
