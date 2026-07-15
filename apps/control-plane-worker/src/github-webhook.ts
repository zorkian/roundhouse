// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

import type { ControlPlaneEnv } from "./environment.js";
import { runtimeIdentity } from "./runtime-config.js";

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
      url: z.string().url(),
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

const pullRequestIssueCommentSchema = issueCommentSchema.extend({
  issue: z.object({
    number: z.number().int().positive(),
    pull_request: z.object({ url: z.string().url() }),
  }),
  comment: z.object({
    id: z.number().int().positive(),
    body: z.string(),
    html_url: z.string().url().optional(),
    user: z.object({ login: z.string() }),
  }),
});

const pullRequestReviewSchema = envelopeSchema.extend({
  action: z.string(),
  pull_request: z.object({
    number: z.number().int().positive(),
    head: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }),
  }),
  review: z.object({
    id: z.number().int().positive(),
    body: z.string().nullable(),
    html_url: z.string().url().optional(),
    user: z.object({ login: z.string() }),
  }),
});

const pullRequestReviewCommentSchema = envelopeSchema.extend({
  action: z.string(),
  pull_request: z.object({
    number: z.number().int().positive(),
    head: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }),
  }),
  comment: z.object({
    id: z.number().int().positive(),
    body: z.string(),
    html_url: z.string().url().optional(),
    user: z.object({ login: z.string() }),
  }),
});

const checkSchema = envelopeSchema.extend({
  check_run: z
    .object({
      id: z.number().int().positive(),
      app: z
        .object({
          id: z.number().int().positive(),
          slug: z.string().optional(),
        })
        .optional(),
      name: z.string().optional(),
      details_url: z.string().url().nullable().optional(),
      external_id: z.string().nullable().optional(),
      head_sha: z.string().regex(/^[a-f0-9]{40}$/),
      status: z.string(),
      conclusion: z.string().nullable().optional(),
      pull_requests: z.array(z.object({ number: z.number().int().positive() })),
    })
    .optional(),
  check_suite: z
    .object({
      id: z.number().int().positive(),
      app: z.object({ id: z.number().int().positive() }).optional(),
      head_sha: z.string().regex(/^[a-f0-9]{40}$/),
      status: z.string(),
      conclusion: z.string().nullable().optional(),
      pull_requests: z.array(z.object({ number: z.number().int().positive() })),
    })
    .optional(),
});

function actionsJobId(check: {
  external_id?: string | null;
  details_url?: string | null;
}): number | undefined {
  const candidate =
    check.external_id && /^[1-9][0-9]*$/.test(check.external_id)
      ? check.external_id
      : check.details_url?.match(/\/job\/([1-9][0-9]*)(?:[/?#]|$)/)?.[1];
  if (!candidate) return undefined;
  const value = Number(candidate);
  return Number.isSafeInteger(value) ? value : undefined;
}

export type GitHubCommand =
  | { kind: "start" }
  | {
      kind: "clarify";
      planId: string;
      revision: number;
      planSha256: string;
      answers: string;
    }
  | {
      kind: "replan";
      planId?: string;
      revision?: number;
      planSha256?: string;
    }
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

export type GitHubPullRequestFeedback = {
  repositoryFullName: string;
  pullRequestNumber: number;
  actor: string;
  sourceId: string;
  sourceUrl?: string;
  runId: string;
  revision: number;
  headCommit: string;
  feedback: string;
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

export function parseGitHubCommand(
  body: string,
  commandPrefixes: readonly string[] = ["/rh", "/roundhouse"],
): GitHubCommand | null {
  const [firstLine, ...remainingLines] = body.trim().split(/\r?\n/);
  const line = firstLine?.trim();
  if (!line) return null;
  const parts = line.split(/\s+/);
  if (!commandPrefixes.includes(parts[0] ?? "")) return null;
  if (parts[1] === "start" && parts.length === 2) return { kind: "start" };
  if (parts[1] === "status" && parts.length <= 3) {
    if (parts[2] && !runId.test(parts[2])) return null;
    return { kind: "status", runId: parts[2] };
  }
  const revision = parseRevision(parts[3]);
  if (
    parts[1] === "clarify" &&
    parts.length === 5 &&
    planId.test(parts[2] ?? "") &&
    revision !== null &&
    sha64.test(parts[4] ?? "")
  ) {
    const answers = remainingLines.join("\n").trim();
    if (answers.length < 1 || answers.length > 10_000) return null;
    return {
      kind: "clarify",
      planId: parts[2]!,
      revision,
      planSha256: parts[4]!,
      answers,
    };
  }
  if (
    parts[1] === "replan" &&
    parts.length === 5 &&
    planId.test(parts[2] ?? "") &&
    revision !== null &&
    sha64.test(parts[4] ?? "")
  )
    return {
      kind: "replan",
      planId: parts[2]!,
      revision,
      planSha256: parts[4]!,
    };
  if (parts[1] === "replan" && parts.length === 2) return { kind: "replan" };
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

function parsePullRequestFeedbackBody(
  body: string,
  commandPrefixes: readonly string[],
): Pick<
  GitHubPullRequestFeedback,
  "runId" | "revision" | "headCommit" | "feedback"
> | null {
  const [line, ...feedbackLines] = body.trim().split(/\r?\n/);
  const parts = line?.trim().split(/\s+/) ?? [];
  const revision = parseRevision(parts[3]);
  const feedback = feedbackLines.join("\n").trim();
  if (
    parts.length !== 5 ||
    !commandPrefixes.includes(parts[0] ?? "") ||
    parts[1] !== "revise" ||
    !runId.test(parts[2] ?? "") ||
    revision === null ||
    !sha40.test(parts[4] ?? "") ||
    feedback.length < 1 ||
    feedback.length > 10_000
  )
    return null;
  return {
    runId: parts[2]!,
    revision,
    headCommit: parts[4]!,
    feedback,
  };
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

export function isUnretainedWebhookEvent(value: VerifiedWebhook): boolean {
  return value.eventName === "push" || value.eventName === "workflow_run";
}

export async function verifyWebhookRequest(
  request: Request,
  env: ControlPlaneEnv,
): Promise<VerifiedWebhook> {
  const identity = runtimeIdentity(env);
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
      "pull_request_review",
      "pull_request_review_comment",
      "check_run",
      "check_suite",
      "push",
      "workflow_run",
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
      String(ping.hook.app_id) !== env.GITHUB_APP_ID ||
      ping.hook.config.url !== `${identity.origin}/v1/github/webhook`
    )
      throw new GitHubWebhookError(403, "unenrolled_source");
    return {
      deliveryId,
      eventName,
      payloadSha256: await sha256(bytes),
      payload: {
        installation: { id: Number(env.GITHUB_INSTALLATION_ID) },
        repository: { full_name: identity.repositoryFullName },
      },
    };
  }
  const payload = envelopeSchema.passthrough().parse(decoded);
  if (
    String(payload.installation.id) !== env.GITHUB_INSTALLATION_ID ||
    payload.repository.full_name !== identity.repositoryFullName
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

export function issueCommand(
  value: VerifiedWebhook,
  commandPrefixes: readonly string[] = ["/rh", "/roundhouse"],
): {
  repositoryFullName: string;
  issueNumber: number;
  actor: string;
  command: GitHubCommand;
} | null {
  if (value.eventName !== "issue_comment") return null;
  const payload = issueCommentSchema.parse(value.payload);
  if (payload.action !== "created" || payload.issue.pull_request) return null;
  const command = parseGitHubCommand(payload.comment.body, commandPrefixes);
  if (!command) return null;
  return {
    repositoryFullName: payload.repository.full_name,
    issueNumber: payload.issue.number,
    actor: payload.comment.user.login,
    command,
  };
}

export function pullRequestFeedback(
  value: VerifiedWebhook,
  commandPrefixes: readonly string[] = ["/rh", "/roundhouse"],
): GitHubPullRequestFeedback | null {
  if (value.eventName === "issue_comment") {
    const payload = pullRequestIssueCommentSchema.safeParse(value.payload);
    if (!payload.success || payload.data.action !== "created") return null;
    const command = parsePullRequestFeedbackBody(
      payload.data.comment.body,
      commandPrefixes,
    );
    if (!command) return null;
    return {
      repositoryFullName: payload.data.repository.full_name,
      pullRequestNumber: payload.data.issue.number,
      actor: payload.data.comment.user.login,
      sourceId: `issue_comment:${payload.data.comment.id}`,
      sourceUrl: payload.data.comment.html_url,
      ...command,
    };
  }
  if (value.eventName === "pull_request_review") {
    const payload = pullRequestReviewSchema.safeParse(value.payload);
    if (!payload.success || payload.data.action !== "submitted") return null;
    const command = parsePullRequestFeedbackBody(
      payload.data.review.body ?? "",
      commandPrefixes,
    );
    if (!command || command.headCommit !== payload.data.pull_request.head.sha)
      return null;
    return {
      repositoryFullName: payload.data.repository.full_name,
      pullRequestNumber: payload.data.pull_request.number,
      actor: payload.data.review.user.login,
      sourceId: `pull_request_review:${payload.data.review.id}`,
      sourceUrl: payload.data.review.html_url,
      ...command,
    };
  }
  if (value.eventName === "pull_request_review_comment") {
    const payload = pullRequestReviewCommentSchema.safeParse(value.payload);
    if (!payload.success || payload.data.action !== "created") return null;
    const command = parsePullRequestFeedbackBody(
      payload.data.comment.body,
      commandPrefixes,
    );
    if (!command || command.headCommit !== payload.data.pull_request.head.sha)
      return null;
    return {
      repositoryFullName: payload.data.repository.full_name,
      pullRequestNumber: payload.data.pull_request.number,
      actor: payload.data.comment.user.login,
      sourceId: `pull_request_review_comment:${payload.data.comment.id}`,
      sourceUrl: payload.data.comment.html_url,
      ...command,
    };
  }
  return null;
}

export function checkObservation(
  value: VerifiedWebhook,
  _roundhouseAppId?: number,
): Array<{
  pullRequestNumber: number;
  headSha: string;
  key: string;
  status: string;
  conclusion?: string;
  repositoryFullName: string;
  checkRunId: number;
  appId?: number;
  appSlug?: string;
  name?: string;
  detailsUrl?: string;
  actionsJobId?: number;
}> {
  // GitHub sends both suite and run completion events for the same result. The
  // completed check run is the single actionable unit; retaining the suite as
  // another observation would duplicate comments and remediation.
  if (value.eventName !== "check_run") return [];
  const payload = checkSchema.parse(value.payload);
  const check = payload.check_run;
  if (!check) return [];
  // Own-check exclusion requires the persisted check-run identity too, so the
  // durable coordinator performs it after parsing this immutable observation.
  return check.pull_requests.map((pull) => ({
    pullRequestNumber: pull.number,
    headSha: check.head_sha,
    key: `check_run:${check.id}`,
    status: check.status,
    conclusion: check.conclusion ?? undefined,
    repositoryFullName: payload.repository.full_name,
    checkRunId: check.id,
    appId: check.app?.id,
    appSlug: check.app?.slug,
    name: check.name,
    detailsUrl: check.details_url ?? undefined,
    actionsJobId: actionsJobId(check),
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
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1)
    throw new GitHubWebhookError(400, "invalid_issue_identity");
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
  const identity = runtimeIdentity(env);
  return enqueueMutableComment(
    env,
    repositoryFullName,
    issueNumber,
    `issue-status:${identity.commentNamespace}:${repositoryFullName}:${issueNumber}`,
    `<!-- roundhouse-${identity.commentNamespace}-status:${repositoryFullName}#${issueNumber} -->`,
    body,
  );
}

export async function enqueueProgressComment(
  env: ControlPlaneEnv,
  repositoryFullName: string,
  issueNumber: number,
  scope: string,
  body: string,
): Promise<void> {
  if (!/^[a-zA-Z0-9:_-]{1,200}$/.test(scope))
    throw new GitHubWebhookError(400, "invalid_comment_scope");
  const identity = runtimeIdentity(env);
  return enqueueMutableComment(
    env,
    repositoryFullName,
    issueNumber,
    `issue-progress:${identity.commentNamespace}:${repositoryFullName}:${issueNumber}:${scope}`,
    `<!-- roundhouse-${identity.commentNamespace}-progress:${repositoryFullName}#${issueNumber}:${scope} -->`,
    body,
  );
}

async function enqueueMutableComment(
  env: ControlPlaneEnv,
  repositoryFullName: string,
  issueNumber: number,
  key: string,
  marker: string,
  body: string,
): Promise<void> {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repositoryFullName))
    throw new GitHubWebhookError(400, "invalid_repository_identity");
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1)
    throw new GitHubWebhookError(400, "invalid_issue_identity");
  if (!body.startsWith(marker))
    throw new GitHubWebhookError(400, "invalid_status_marker");
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
  Array<
    {
      runId: string;
      issueNumber: number;
    } & ReturnType<typeof checkObservation>[number]
  >
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
  const result: Array<
    {
      runId: string;
      issueNumber: number;
    } & ReturnType<typeof checkObservation>[number]
  > = [];
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
