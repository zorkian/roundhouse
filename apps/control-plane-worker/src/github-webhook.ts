// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

import type { ControlPlaneEnv } from "./environment.js";

export const githubNativeOperatorMigration = `
CREATE TABLE IF NOT EXISTS github_webhook_deliveries (
  delivery_id TEXT PRIMARY KEY, event_name TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL, installation_id TEXT NOT NULL,
  repository_full_name TEXT NOT NULL, sender_login TEXT,
  status TEXT NOT NULL CHECK (status IN ('received', 'completed', 'ignored', 'failed')),
  result_json TEXT, claim_id TEXT, claim_expires_at TEXT,
  received_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS github_webhook_deliveries_status
  ON github_webhook_deliveries(status, received_at);
CREATE TABLE IF NOT EXISTS github_issue_runs (
  issue_number INTEGER PRIMARY KEY, run_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS github_comment_outbox (
  comment_key TEXT PRIMARY KEY, issue_number INTEGER NOT NULL,
  repository_full_name TEXT NOT NULL DEFAULT 'zorkian/roundhouse',
  body TEXT NOT NULL, body_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent')),
  github_comment_id INTEGER, github_comment_url TEXT,
  claim_id TEXT, claim_expires_at TEXT, created_at TEXT NOT NULL, sent_at TEXT
);
CREATE INDEX IF NOT EXISTS github_comment_outbox_pending
  ON github_comment_outbox(status, created_at);
CREATE TABLE IF NOT EXISTS github_check_observations (
  pull_request_number INTEGER NOT NULL, head_sha TEXT NOT NULL,
  check_key TEXT NOT NULL, status TEXT NOT NULL, conclusion TEXT,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (pull_request_number, head_sha, check_key)
);
`;

const envelopeSchema = z.object({
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({ full_name: z.string() }),
  sender: z.object({ login: z.string() }).optional(),
});

const pingSchema = z.object({
  hook_id: z.number().int().positive(),
  hook: z.object({
    type: z.literal("App"),
    id: z.number().int().positive(),
    active: z.literal(true),
    app_id: z.number().int().positive(),
    config: z.object({
      content_type: z.literal("json"),
      insecure_ssl: z.union([z.literal("0"), z.literal(0)]),
      url: z.literal("https://roundhouse-dev.rm-rf.rip/v1/github/webhook"),
    }),
  }),
});

const issueCommentSchema = envelopeSchema.extend({
  action: z.string(),
  issue: z.object({
    number: z.number().int().positive(),
    pull_request: z.unknown().optional(),
  }),
  comment: z.object({
    id: z.number().int().positive(),
    body: z.string(),
    user: z.object({ login: z.string() }),
  }),
});

const checkSchema = envelopeSchema.extend({
  check_run: z
    .object({
      id: z.number().int().positive(),
      head_sha: z.string().regex(/^[a-f0-9]{40}$/),
      status: z.string(),
      conclusion: z.string().nullable().optional(),
      pull_requests: z.array(z.object({ number: z.number().int().positive() })),
    })
    .optional(),
  check_suite: z
    .object({
      id: z.number().int().positive(),
      head_sha: z.string().regex(/^[a-f0-9]{40}$/),
      status: z.string(),
      conclusion: z.string().nullable().optional(),
      pull_requests: z.array(z.object({ number: z.number().int().positive() })),
    })
    .optional(),
});

export type GitHubCommand =
  | { kind: "start" }
  | { kind: "status"; runId?: string }
  | {
      kind: "implement";
      planId: string;
      revision: number;
      planSha256: string;
    }
  | { kind: "cancel"; runId: string; revision: number }
  | { kind: "retry"; runId: string; revision: number }
  | {
      kind: "approve";
      runId: string;
      revision: number;
      baseCommit: string;
      patchSha256: string;
      evidenceSetSha256: string;
    };

const runId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const planId = /^plan_[a-f0-9]{40}$/;
const sha40 = /^[a-f0-9]{40}$/;
const sha64 = /^[a-f0-9]{64}$/;

function parseRevision(value: string | undefined): number | null {
  if (!/^[1-9][0-9]*$/.test(value ?? "")) return null;
  const parsed = Number.parseInt(value!, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseGitHubCommand(body: string): GitHubCommand | null {
  const line = body.trim().split(/\r?\n/, 1)[0]?.trim();
  if (!line?.startsWith("/rh")) return null;
  const parts = line.split(/\s+/);
  if (parts[0] !== "/rh") return null;
  if (parts[1] === "start" && parts.length === 2) return { kind: "start" };
  if (parts[1] === "status" && parts.length <= 3) {
    if (parts[2] && !runId.test(parts[2])) return null;
    return { kind: "status", runId: parts[2] };
  }
  const revision = parseRevision(parts[3]);
  if (
    parts[1] === "implement" &&
    parts.length === 5 &&
    planId.test(parts[2] ?? "") &&
    revision !== null &&
    sha64.test(parts[4] ?? "")
  )
    return {
      kind: "implement",
      planId: parts[2]!,
      revision,
      planSha256: parts[4]!,
    };
  if (
    ["cancel", "retry"].includes(parts[1] ?? "") &&
    parts.length === 4 &&
    runId.test(parts[2] ?? "") &&
    revision !== null
  )
    return {
      kind: parts[1] as "cancel" | "retry",
      runId: parts[2]!,
      revision,
    };
  if (
    parts[1] === "approve" &&
    parts.length === 7 &&
    runId.test(parts[2] ?? "") &&
    revision !== null &&
    sha40.test(parts[4] ?? "") &&
    sha64.test(parts[5] ?? "") &&
    sha64.test(parts[6] ?? "")
  )
    return {
      kind: "approve",
      runId: parts[2]!,
      revision,
      baseCommit: parts[4]!,
      patchSha256: parts[5]!,
      evidenceSetSha256: parts[6]!,
    };
  return null;
}

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const owned = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  owned.set(bytes);
  return hex(await crypto.subtle.digest("SHA-256", owned));
}

export async function verifyGitHubSignature(
  body: Uint8Array,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!/^sha256=[a-f0-9]{64}$/.test(signature ?? "")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const expected = new Uint8Array(
    (signature!.slice(7).match(/.{2}/g) ?? []).map((value) =>
      Number.parseInt(value, 16),
    ),
  );
  const owned = new Uint8Array(new ArrayBuffer(body.byteLength));
  owned.set(body);
  return crypto.subtle.verify("HMAC", key, expected, owned);
}

export type VerifiedWebhook = {
  deliveryId: string;
  eventName: string;
  payloadSha256: string;
  payload: z.infer<typeof envelopeSchema> & Record<string, unknown>;
};

export async function verifyWebhookRequest(
  request: Request,
  env: ControlPlaneEnv,
): Promise<VerifiedWebhook> {
  if (!env.ROUNDHOUSE_GITHUB_WEBHOOK_SECRET)
    throw new GitHubWebhookError(503, "webhook_not_configured");
  if (!env.GITHUB_INSTALLATION_ID)
    throw new GitHubWebhookError(503, "installation_not_configured");
  const deliveryId = request.headers.get("x-github-delivery") ?? "";
  const eventName = request.headers.get("x-github-event") ?? "";
  if (!/^[a-fA-F0-9-]{8,64}$/.test(deliveryId))
    throw new GitHubWebhookError(400, "invalid_delivery");
  if (!/^[a-z_]{2,40}$/.test(eventName))
    throw new GitHubWebhookError(400, "invalid_event");
  if (
    ![
      "issues",
      "issue_comment",
      "pull_request",
      "check_run",
      "check_suite",
      "ping",
    ].includes(eventName)
  )
    throw new GitHubWebhookError(400, "unsupported_event");
  const bytes = await readLimitedBody(request, 1024 * 1024);
  if (
    !(await verifyGitHubSignature(
      bytes,
      request.headers.get("x-hub-signature-256"),
      env.ROUNDHOUSE_GITHUB_WEBHOOK_SECRET,
    ))
  )
    throw new GitHubWebhookError(401, "invalid_signature");
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new GitHubWebhookError(400, "invalid_payload");
  }
  if (eventName === "ping") {
    if (!env.GITHUB_APP_ID)
      throw new GitHubWebhookError(503, "app_not_configured");
    const ping = pingSchema.parse(decoded);
    if (
      ping.hook_id !== ping.hook.id ||
      String(ping.hook.app_id) !== env.GITHUB_APP_ID
    )
      throw new GitHubWebhookError(403, "unenrolled_source");
    return {
      deliveryId,
      eventName,
      payloadSha256: await sha256(bytes),
      payload: {
        installation: { id: Number(env.GITHUB_INSTALLATION_ID) },
        repository: { full_name: "zorkian/roundhouse" },
      },
    };
  }
  const payload = envelopeSchema.passthrough().parse(decoded);
  if (
    String(payload.installation.id) !== env.GITHUB_INSTALLATION_ID ||
    payload.repository.full_name !== "zorkian/roundhouse"
  )
    throw new GitHubWebhookError(403, "unenrolled_source");
  return {
    deliveryId,
    eventName,
    payloadSha256: await sha256(bytes),
    payload,
  };
}

export class GitHubWebhookError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function readLimitedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new GitHubWebhookError(413, "payload_too_large");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel("payload_too_large");
      throw new GitHubWebhookError(413, "payload_too_large");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function issueCommand(value: VerifiedWebhook): {
  issueNumber: number;
  actor: string;
  command: GitHubCommand;
} | null {
  if (value.eventName !== "issue_comment") return null;
  const payload = issueCommentSchema.parse(value.payload);
  if (payload.action !== "created" || payload.issue.pull_request) return null;
  const command = parseGitHubCommand(payload.comment.body);
  if (!command) return null;
  return {
    issueNumber: payload.issue.number,
    actor: payload.comment.user.login,
    command,
  };
}

export function checkObservation(value: VerifiedWebhook): Array<{
  pullRequestNumber: number;
  headSha: string;
  key: string;
  status: string;
  conclusion?: string;
}> {
  if (!["check_run", "check_suite"].includes(value.eventName)) return [];
  const payload = checkSchema.parse(value.payload);
  const check =
    value.eventName === "check_run" ? payload.check_run : payload.check_suite;
  if (!check) return [];
  return check.pull_requests.map((pull) => ({
    pullRequestNumber: pull.number,
    headSha: check.head_sha,
    key: `${value.eventName}:${check.id}`,
    status: check.status,
    conclusion: check.conclusion ?? undefined,
  }));
}

export async function reserveWebhookDelivery(
  env: ControlPlaneEnv,
  value: VerifiedWebhook,
): Promise<
  | { kind: "new"; claimId: string }
  | { kind: "replay" }
  | { kind: "in_progress" }
> {
  const nowValue = new Date();
  const now = nowValue.toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_webhook_deliveries(delivery_id, event_name, payload_sha256, installation_id, repository_full_name, sender_login, status, received_at) VALUES (?, ?, ?, ?, ?, ?, 'received', ?)",
  )
    .bind(
      value.deliveryId,
      value.eventName,
      value.payloadSha256,
      String(value.payload.installation.id),
      value.payload.repository.full_name,
      value.payload.sender?.login ?? null,
      now,
    )
    .run();
  const row = await env.DB.prepare(
    "SELECT event_name, payload_sha256, status FROM github_webhook_deliveries WHERE delivery_id = ?",
  )
    .bind(value.deliveryId)
    .first<{ event_name: string; payload_sha256: string; status: string }>();
  if (
    !row ||
    row.event_name !== value.eventName ||
    row.payload_sha256 !== value.payloadSha256
  )
    throw new GitHubWebhookError(409, "delivery_conflict");
  if (["completed", "ignored"].includes(row.status)) return { kind: "replay" };
  const claimId = crypto.randomUUID();
  const claimExpiresAt = new Date(nowValue.getTime() + 60_000).toISOString();
  const claimed = await env.DB.prepare(
    "UPDATE github_webhook_deliveries SET status = 'received', result_json = NULL, completed_at = NULL, claim_id = ?, claim_expires_at = ? WHERE delivery_id = ? AND (status = 'failed' OR claim_id IS NULL OR claim_expires_at <= ?)",
  )
    .bind(claimId, claimExpiresAt, value.deliveryId, now)
    .run();
  return (claimed.meta.changes ?? 0) === 1
    ? { kind: "new", claimId }
    : { kind: "in_progress" };
}

export async function completeWebhookDelivery(
  env: ControlPlaneEnv,
  deliveryId: string,
  claimId: string,
  status: "completed" | "ignored" | "failed",
  result: unknown,
): Promise<void> {
  const completed = await env.DB.prepare(
    "UPDATE github_webhook_deliveries SET status = ?, result_json = ?, claim_id = NULL, claim_expires_at = NULL, completed_at = ? WHERE delivery_id = ? AND status = 'received' AND claim_id = ?",
  )
    .bind(
      status,
      JSON.stringify(result),
      new Date().toISOString(),
      deliveryId,
      claimId,
    )
    .run();
  if ((completed.meta.changes ?? 0) !== 1)
    throw new GitHubWebhookError(409, "delivery_claim_lost");
}

export async function bindIssueRun(
  env: ControlPlaneEnv,
  issueNumber: number,
  runIdValue: string,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_issue_runs(issue_number, run_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
  )
    .bind(issueNumber, runIdValue, now, now)
    .run();
  const row = await env.DB.prepare(
    "SELECT run_id FROM github_issue_runs WHERE issue_number = ?",
  )
    .bind(issueNumber)
    .first<{ run_id: string }>();
  if (!row || row.run_id !== runIdValue)
    throw new GitHubWebhookError(409, "issue_already_bound");
}

export async function issueRun(
  env: ControlPlaneEnv,
  issueNumber: number,
): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT run_id FROM github_issue_runs WHERE issue_number = ?",
  )
    .bind(issueNumber)
    .first<{ run_id: string }>();
  return row?.run_id ?? null;
}

export async function enqueueComment(
  env: ControlPlaneEnv,
  key: string,
  issueNumber: number,
  body: string,
  repositoryFullName = "zorkian/roundhouse",
): Promise<void> {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repositoryFullName))
    throw new GitHubWebhookError(400, "invalid_repository_identity");
  const bodySha256 = await sha256(body);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_comment_outbox(comment_key, issue_number, repository_full_name, body, body_sha256, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
  )
    .bind(
      key,
      issueNumber,
      repositoryFullName,
      body,
      bodySha256,
      new Date().toISOString(),
    )
    .run();
  const row = await env.DB.prepare(
    "SELECT issue_number, repository_full_name, body_sha256 FROM github_comment_outbox WHERE comment_key = ?",
  )
    .bind(key)
    .first<{
      issue_number: number;
      repository_full_name: string;
      body_sha256: string;
    }>();
  if (
    !row ||
    row.issue_number !== issueNumber ||
    row.repository_full_name !== repositoryFullName ||
    row.body_sha256 !== bodySha256
  )
    throw new GitHubWebhookError(409, "comment_intent_conflict");
}

export async function enqueueStatusComment(
  env: ControlPlaneEnv,
  repositoryFullName: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repositoryFullName))
    throw new GitHubWebhookError(400, "invalid_repository_identity");
  const key = `issue-status:${repositoryFullName}:${issueNumber}`;
  const bodySha256 = await sha256(body);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_comment_outbox(comment_key, issue_number, repository_full_name, body, body_sha256, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
  )
    .bind(key, issueNumber, repositoryFullName, body, bodySha256, now)
    .run();
  const row = await env.DB.prepare(
    "SELECT issue_number, repository_full_name, body_sha256 FROM github_comment_outbox WHERE comment_key = ?",
  )
    .bind(key)
    .first<{
      issue_number: number;
      repository_full_name: string;
      body_sha256: string;
    }>();
  if (
    !row ||
    row.issue_number !== issueNumber ||
    row.repository_full_name !== repositoryFullName
  )
    throw new GitHubWebhookError(409, "comment_intent_conflict");
  if (row.body_sha256 === bodySha256) return;
  await env.DB.prepare(
    "UPDATE github_comment_outbox SET body = ?, body_sha256 = ?, status = 'pending', claim_id = NULL, claim_expires_at = NULL WHERE comment_key = ?",
  )
    .bind(body, bodySha256, key)
    .run();
}

export async function claimPendingComments(env: ControlPlaneEnv): Promise<
  Array<{
    key: string;
    repositoryFullName: string;
    issueNumber: number;
    body: string;
    claimId: string;
    githubCommentId?: number;
  }>
> {
  const nowValue = new Date();
  const now = nowValue.toISOString();
  const rows = await env.DB.prepare(
    "SELECT comment_key, repository_full_name, issue_number, body, github_comment_id FROM github_comment_outbox WHERE status = 'pending' OR (status = 'sending' AND claim_expires_at <= ?) ORDER BY created_at ASC LIMIT 20",
  )
    .bind(now)
    .all<{
      comment_key: string;
      repository_full_name: string;
      issue_number: number;
      body: string;
      github_comment_id: number | null;
    }>();
  const claimed: Array<{
    key: string;
    repositoryFullName: string;
    issueNumber: number;
    body: string;
    claimId: string;
    githubCommentId?: number;
  }> = [];
  for (const row of rows.results) {
    const claimId = crypto.randomUUID();
    const claimExpiresAt = new Date(nowValue.getTime() + 60_000).toISOString();
    const result = await env.DB.prepare(
      "UPDATE github_comment_outbox SET status = 'sending', claim_id = ?, claim_expires_at = ? WHERE comment_key = ? AND (status = 'pending' OR (status = 'sending' AND claim_expires_at <= ?))",
    )
      .bind(claimId, claimExpiresAt, row.comment_key, now)
      .run();
    if ((result.meta.changes ?? 0) === 1)
      claimed.push({
        key: row.comment_key,
        repositoryFullName: row.repository_full_name,
        issueNumber: row.issue_number,
        body: row.body,
        claimId,
        githubCommentId: row.github_comment_id ?? undefined,
      });
  }
  return claimed;
}

export async function markCommentSent(
  env: ControlPlaneEnv,
  key: string,
  claimId: string,
  result: { id: number; url: string },
): Promise<void> {
  const sent = await env.DB.prepare(
    "UPDATE github_comment_outbox SET status = 'sent', github_comment_id = ?, github_comment_url = ?, claim_id = NULL, claim_expires_at = NULL, sent_at = ? WHERE comment_key = ? AND status = 'sending' AND claim_id = ?",
  )
    .bind(result.id, result.url, new Date().toISOString(), key, claimId)
    .run();
  if ((sent.meta.changes ?? 0) !== 1)
    throw new GitHubWebhookError(409, "comment_claim_lost");
}

export async function releaseCommentClaim(
  env: ControlPlaneEnv,
  key: string,
  claimId: string,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE github_comment_outbox SET status = 'pending', claim_id = NULL, claim_expires_at = NULL WHERE comment_key = ? AND status = 'sending' AND claim_id = ?",
  )
    .bind(key, claimId)
    .run();
}

export async function recordCheckObservations(
  env: ControlPlaneEnv,
  observations: ReturnType<typeof checkObservation>,
): Promise<void> {
  for (const value of observations)
    await env.DB.prepare(
      "INSERT OR REPLACE INTO github_check_observations(pull_request_number, head_sha, check_key, status, conclusion, observed_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        value.pullRequestNumber,
        value.headSha,
        value.key,
        value.status,
        value.conclusion ?? null,
        new Date().toISOString(),
      )
      .run();
}

export async function exactPublishedCheckTargets(
  env: ControlPlaneEnv,
  observations: ReturnType<typeof checkObservation>,
): Promise<
  Array<{
    runId: string;
    issueNumber: number;
    pullRequestNumber: number;
    headSha: string;
    key: string;
    status: string;
    conclusion?: string;
  }>
> {
  if (observations.length === 0) return [];
  const clauses = observations.map(
    () =>
      "(json_extract(publications.result_json, '$.pullRequestNumber') = ? AND json_extract(publications.result_json, '$.commit') = ?)",
  );
  const queryBindings = observations.flatMap((value) => [
    value.pullRequestNumber,
    value.headSha,
  ]);
  const publications = await env.DB.prepare(
    `SELECT publications.run_id, publications.result_json, issue_runs.issue_number FROM github_publications AS publications INNER JOIN github_issue_runs AS issue_runs ON issue_runs.run_id = publications.run_id WHERE publications.status = 'published' AND publications.result_json IS NOT NULL AND (${clauses.join(" OR ")})`,
  )
    .bind(...queryBindings)
    .all<{ run_id: string; result_json: string; issue_number: number }>();
  const result: Array<{
    runId: string;
    issueNumber: number;
    pullRequestNumber: number;
    headSha: string;
    key: string;
    status: string;
    conclusion?: string;
  }> = [];
  for (const row of publications.results) {
    let publication: { pullRequestNumber?: unknown; commit?: unknown };
    try {
      publication = JSON.parse(row.result_json) as typeof publication;
    } catch {
      continue;
    }
    if (
      typeof publication.pullRequestNumber !== "number" ||
      typeof publication.commit !== "string"
    )
      continue;
    for (const observation of observations)
      if (
        observation.pullRequestNumber === publication.pullRequestNumber &&
        observation.headSha === publication.commit
      )
        result.push({
          runId: row.run_id,
          issueNumber: row.issue_number,
          ...observation,
        });
  }
  return result;
}
