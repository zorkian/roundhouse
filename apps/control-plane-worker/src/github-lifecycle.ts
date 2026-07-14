// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { D1JobStore } from "@roundhouse/self-development/cloudflare";
import { z } from "zod";

import type { ControlPlaneEnv } from "./environment.js";
import type { VerifiedWebhook } from "./github-webhook.js";

const pullRequestLifecycleSchema = z.object({
  action: z.enum(["opened", "reopened", "closed"]),
  repository: z.object({ full_name: z.string() }),
  pull_request: z.object({
    number: z.number().int().positive(),
    html_url: z.string().url(),
    state: z.enum(["open", "closed"]),
    merged: z.boolean(),
    merged_at: z.string().nullable(),
    merge_commit_sha: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    head: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }),
  }),
});

export type PullRequestLifecycle = {
  repositoryFullName: string;
  pullRequestNumber: number;
  runId: string;
  issueNumber: number;
  headSha: string;
  state: "open" | "closed" | "merged";
  mergeCommitSha?: string;
  mergedAt?: string;
  updatedAt: string;
};

export async function recordPullRequestLifecycle(
  env: ControlPlaneEnv,
  webhook: VerifiedWebhook,
): Promise<PullRequestLifecycle | null> {
  if (webhook.eventName !== "pull_request") return null;
  const parsed = pullRequestLifecycleSchema.safeParse(webhook.payload);
  if (!parsed.success) return null;
  const value = parsed.data;
  const row = await env.DB.prepare(
    "SELECT run_id FROM self_development_runs WHERE json_extract(payload, '$.publication.pullRequestUrl') = ? LIMIT 1",
  )
    .bind(value.pull_request.html_url)
    .first<{ run_id: string }>();
  if (!row) return null;
  const run = await new D1JobStore(env.DB).read(row.run_id);
  if (
    run.publication?.pullRequestUrl !== value.pull_request.html_url ||
    run.publication.commit !== value.pull_request.head.sha ||
    run.task.source?.kind !== "github_issue"
  )
    throw new Error("Pull-request lifecycle does not match published run");
  const state = value.pull_request.merged ? "merged" : value.pull_request.state;
  const updatedAt = new Date().toISOString();
  const recorded = await env.DB.prepare(
    `INSERT INTO github_pull_request_lifecycle(repository_full_name, pull_request_number, run_id, head_sha, state, merge_commit_sha, merged_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(repository_full_name, pull_request_number) DO UPDATE SET
       state = excluded.state,
       merge_commit_sha = excluded.merge_commit_sha,
       merged_at = excluded.merged_at,
       updated_at = excluded.updated_at
     WHERE github_pull_request_lifecycle.run_id = excluded.run_id
       AND github_pull_request_lifecycle.head_sha = excluded.head_sha`,
  )
    .bind(
      value.repository.full_name,
      value.pull_request.number,
      run.runId,
      value.pull_request.head.sha,
      state,
      value.pull_request.merge_commit_sha,
      value.pull_request.merged_at,
      updatedAt,
    )
    .run();
  if ((recorded.meta.changes ?? 0) !== 1)
    throw new Error("Pull-request lifecycle identity conflict");
  return {
    repositoryFullName: value.repository.full_name,
    pullRequestNumber: value.pull_request.number,
    runId: run.runId,
    issueNumber: run.task.source.issueNumber,
    headSha: value.pull_request.head.sha,
    state,
    mergeCommitSha: value.pull_request.merge_commit_sha ?? undefined,
    mergedAt: value.pull_request.merged_at ?? undefined,
    updatedAt,
  };
}

export async function readPullRequestLifecycle(
  env: ControlPlaneEnv,
  runId: string,
): Promise<Omit<PullRequestLifecycle, "issueNumber"> | undefined> {
  const row = await env.DB.prepare(
    "SELECT repository_full_name, pull_request_number, run_id, head_sha, state, merge_commit_sha, merged_at, updated_at FROM github_pull_request_lifecycle WHERE run_id = ?",
  )
    .bind(runId)
    .first<{
      repository_full_name: string;
      pull_request_number: number;
      run_id: string;
      head_sha: string;
      state: "open" | "closed" | "merged";
      merge_commit_sha: string | null;
      merged_at: string | null;
      updated_at: string;
    }>();
  return row
    ? {
        repositoryFullName: row.repository_full_name,
        pullRequestNumber: row.pull_request_number,
        runId: row.run_id,
        headSha: row.head_sha,
        state: row.state,
        mergeCommitSha: row.merge_commit_sha ?? undefined,
        mergedAt: row.merged_at ?? undefined,
        updatedAt: row.updated_at,
      }
    : undefined;
}
