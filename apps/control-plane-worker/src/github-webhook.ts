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
  result_json TEXT, received_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS github_webhook_deliveries_status
  ON github_webhook_deliveries(status, received_at);
CREATE TABLE IF NOT EXISTS github_issue_runs (
  issue_number INTEGER PRIMARY KEY, run_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS github_comment_outbox (
  comment_key TEXT PRIMARY KEY, issue_number INTEGER NOT NULL,
  body TEXT NOT NULL, body_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent')),
  github_comment_id INTEGER, github_comment_url TEXT,
  created_at TEXT NOT NULL, sent_at TEXT
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
const sha40 = /^[a-f0-9]{40}$/;
const sha64 = /^[a-f0-9]{64}$/;

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
  if (
    ["cancel", "retry"].includes(parts[1] ?? "") &&
    parts.length === 4 &&
    runId.test(parts[2] ?? "") &&
    /^[1-9][0-9]*$/.test(parts[3] ?? "")
  )
    return {
      kind: parts[1] as "cancel" | "retry",
      runId: parts[2]!,
      revision: Number(parts[3]),
    };
  if (
    parts[1] === "approve" &&
    parts.length === 7 &&
    runId.test(parts[2] ?? "") &&
    /^[1-9][0-9]*$/.test(parts[3] ?? "") &&
    sha40.test(parts[4] ?? "") &&
    sha64.test(parts[5] ?? "") &&
    sha64.test(parts[6] ?? "")
  )
    return {
      kind: "approve",
      runId: parts[2]!,
      revision: Number(parts[3]),
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
    ].includes(eventName)
  )
    throw new GitHubWebhookError(400, "unsupported_event");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > 1024 * 1024)
    throw new GitHubWebhookError(413, "payload_too_large");
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
): Promise<"new" | "replay"> {
  const now = new Date().toISOString();
  const inserted = await env.DB.prepare(
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
  if ((inserted.meta.changes ?? 0) === 1) return "new";
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
  if (row.status === "failed") {
    await env.DB.prepare(
      "UPDATE github_webhook_deliveries SET status = 'received', result_json = NULL, completed_at = NULL WHERE delivery_id = ? AND status = 'failed'",
    )
      .bind(value.deliveryId)
      .run();
    return "new";
  }
  return "replay";
}

export async function completeWebhookDelivery(
  env: ControlPlaneEnv,
  deliveryId: string,
  status: "completed" | "ignored" | "failed",
  result: unknown,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE github_webhook_deliveries SET status = ?, result_json = ?, completed_at = ? WHERE delivery_id = ?",
  )
    .bind(status, JSON.stringify(result), new Date().toISOString(), deliveryId)
    .run();
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
): Promise<void> {
  const bodySha256 = await sha256(body);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_comment_outbox(comment_key, issue_number, body, body_sha256, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
  )
    .bind(key, issueNumber, body, bodySha256, new Date().toISOString())
    .run();
  const row = await env.DB.prepare(
    "SELECT issue_number, body_sha256 FROM github_comment_outbox WHERE comment_key = ?",
  )
    .bind(key)
    .first<{ issue_number: number; body_sha256: string }>();
  if (
    !row ||
    row.issue_number !== issueNumber ||
    row.body_sha256 !== bodySha256
  )
    throw new GitHubWebhookError(409, "comment_intent_conflict");
}

export async function pendingComments(env: ControlPlaneEnv): Promise<
  Array<{
    key: string;
    issueNumber: number;
    body: string;
  }>
> {
  const rows = await env.DB.prepare(
    "SELECT comment_key, issue_number, body FROM github_comment_outbox WHERE status = 'pending' ORDER BY created_at ASC LIMIT 20",
  ).all<{ comment_key: string; issue_number: number; body: string }>();
  return rows.results.map((row) => ({
    key: row.comment_key,
    issueNumber: row.issue_number,
    body: row.body,
  }));
}

export async function markCommentSent(
  env: ControlPlaneEnv,
  key: string,
  result: { id: number; url: string },
): Promise<void> {
  await env.DB.prepare(
    "UPDATE github_comment_outbox SET status = 'sent', github_comment_id = ?, github_comment_url = ?, sent_at = ? WHERE comment_key = ? AND status = 'pending'",
  )
    .bind(result.id, result.url, new Date().toISOString(), key)
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
  const publications = await env.DB.prepare(
    "SELECT run_id, result_json FROM github_publications WHERE status = 'published' AND result_json IS NOT NULL",
  ).all<{ run_id: string; result_json: string }>();
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
    const binding = await env.DB.prepare(
      "SELECT issue_number FROM github_issue_runs WHERE run_id = ?",
    )
      .bind(row.run_id)
      .first<{ issue_number: number }>();
    if (!binding) continue;
    for (const observation of observations)
      if (
        observation.pullRequestNumber === publication.pullRequestNumber &&
        observation.headSha === publication.commit
      )
        result.push({
          runId: row.run_id,
          issueNumber: binding.issue_number,
          ...observation,
        });
  }
  return result;
}
