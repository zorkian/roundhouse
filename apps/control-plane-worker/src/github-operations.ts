// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  githubIssueSnapshotSchema,
  type GitHubIssueSnapshot,
  type GitHubPublicationResult,
} from "@roundhouse/self-development/cloudflare";

import type { ControlPlaneEnv } from "./environment.js";

const unclaimedAt = "1970-01-01T00:00:00.000Z";
const publicationLeaseMs = 60_000;

export class GitHubPublicationPendingError extends Error {
  constructor() {
    super("GitHub publication is already in progress");
  }
}

export const githubPocMigration = `
CREATE TABLE IF NOT EXISTS github_issue_snapshots (
  snapshot_id TEXT PRIMARY KEY, issue_number INTEGER NOT NULL,
  node_id TEXT NOT NULL, content_sha256 TEXT NOT NULL,
  snapshot_json TEXT NOT NULL, fetched_at TEXT NOT NULL,
  UNIQUE(issue_number, content_sha256)
);
CREATE INDEX IF NOT EXISTS github_issue_snapshots_issue ON github_issue_snapshots(issue_number, fetched_at);
CREATE TABLE IF NOT EXISTS github_publications (
  run_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planning', 'published')),
  result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS github_publications_status ON github_publications(status, updated_at);
`;

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function requestHash(value: unknown): Promise<string> {
  return bytesToHex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  );
}

export async function saveIssueSnapshot(
  env: ControlPlaneEnv,
  snapshot: {
    number: number;
    nodeId: string;
    contentSha256: string;
    fetchedAt: string;
  },
  json: string,
): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_issue_snapshots(snapshot_id, issue_number, node_id, content_sha256, snapshot_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      `issue_${snapshot.number}_${snapshot.contentSha256}`,
      snapshot.number,
      snapshot.nodeId,
      snapshot.contentSha256,
      json,
      snapshot.fetchedAt,
    )
    .run();
}

export async function readIssueSnapshot(
  env: ControlPlaneEnv,
  issueNumber: number,
  contentSha256: string,
): Promise<GitHubIssueSnapshot> {
  const row = await env.DB.prepare(
    "SELECT snapshot_json FROM github_issue_snapshots WHERE issue_number = ? AND content_sha256 = ?",
  )
    .bind(issueNumber, contentSha256)
    .first<{ snapshot_json: string }>();
  if (!row) throw new Error("Immutable issue snapshot not found");
  return githubIssueSnapshotSchema.parse(JSON.parse(row.snapshot_json));
}

export async function durableGitHubPublication(
  env: ControlPlaneEnv,
  runId: string,
  request: unknown,
  publish: () => Promise<GitHubPublicationResult>,
): Promise<GitHubPublicationResult> {
  const hash = await requestHash(request);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_publications(run_id, request_hash, status, created_at, updated_at) VALUES (?, ?, 'planning', ?, ?)",
  )
    .bind(runId, hash, now, unclaimedAt)
    .run();
  const row = await env.DB.prepare(
    "SELECT request_hash, status, result_json FROM github_publications WHERE run_id = ?",
  )
    .bind(runId)
    .first<{
      request_hash: string;
      status: "planning" | "published";
      result_json: string | null;
    }>();
  if (!row || row.request_hash !== hash)
    throw new Error("GitHub publication request conflicts with durable intent");
  if (row.status === "published" && row.result_json)
    return JSON.parse(row.result_json) as GitHubPublicationResult;
  const claimedAt = new Date().toISOString();
  const staleBefore = new Date(Date.now() - publicationLeaseMs).toISOString();
  const claimed = await env.DB.prepare(
    "UPDATE github_publications SET updated_at = ? WHERE run_id = ? AND request_hash = ? AND status = 'planning' AND updated_at <= ?",
  )
    .bind(claimedAt, runId, hash, staleBefore)
    .run();
  if ((claimed.meta.changes ?? 0) !== 1) {
    const completed = await env.DB.prepare(
      "SELECT status, result_json FROM github_publications WHERE run_id = ? AND request_hash = ?",
    )
      .bind(runId, hash)
      .first<{ status: string; result_json: string | null }>();
    if (completed?.status === "published" && completed.result_json)
      return JSON.parse(completed.result_json) as GitHubPublicationResult;
    throw new GitHubPublicationPendingError();
  }
  let result: GitHubPublicationResult;
  try {
    result = await publish();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE github_publications SET updated_at = ? WHERE run_id = ? AND request_hash = ? AND status = 'planning' AND updated_at = ?",
    )
      .bind(unclaimedAt, runId, hash, claimedAt)
      .run();
    throw error;
  }
  const updated = await env.DB.prepare(
    "UPDATE github_publications SET status = 'published', result_json = ?, updated_at = ? WHERE run_id = ? AND request_hash = ? AND status = 'planning' AND updated_at = ?",
  )
    .bind(
      JSON.stringify(result),
      new Date().toISOString(),
      runId,
      hash,
      claimedAt,
    )
    .run();
  if ((updated.meta.changes ?? 0) !== 1) {
    const raced = await env.DB.prepare(
      "SELECT result_json FROM github_publications WHERE run_id = ? AND request_hash = ? AND status = 'published'",
    )
      .bind(runId, hash)
      .first<{ result_json: string }>();
    if (!raced?.result_json)
      throw new Error("GitHub publication result could not become durable");
    return JSON.parse(raced.result_json) as GitHubPublicationResult;
  }
  return result;
}
