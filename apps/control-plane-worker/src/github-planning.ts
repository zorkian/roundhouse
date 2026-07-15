// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  nonImplementationQualificationSchema,
  qualifiedPlanSchema,
  rejectedQualificationSchema,
  type PlanningDecision,
  type QualifiedPlan,
} from "@roundhouse/self-development/cloudflare";

import type { ControlPlaneEnv } from "./environment.js";

export const githubPlanningMigration = `
CREATE TABLE IF NOT EXISTS github_planning_jobs (
  job_id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  roundhouse_environment TEXT NOT NULL CHECK (roundhouse_environment IN ('development', 'production')),
  repository_full_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  command_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'retrying', 'completed', 'failed', 'timed_out')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claim_id TEXT,
  claim_expires_at TEXT,
  result_json TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS github_planning_jobs_status ON github_planning_jobs(status, updated_at);
CREATE TABLE IF NOT EXISTS github_planning_job_events (
  event_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE(job_id, sequence)
);
CREATE INDEX IF NOT EXISTS github_planning_job_events_job ON github_planning_job_events(job_id, sequence);
CREATE TABLE IF NOT EXISTS github_issue_plans (
  plan_id TEXT PRIMARY KEY,
  issue_number INTEGER NOT NULL UNIQUE,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'rejected', 'approved', 'materialized')),
  plan_sha256 TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  evidence_object_key TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL,
  evidence_size INTEGER NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  run_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS github_issue_plans_status ON github_issue_plans(status, updated_at);
CREATE TABLE IF NOT EXISTS github_plan_events (
  event_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE(plan_id, sequence)
);
CREATE INDEX IF NOT EXISTS github_plan_events_plan ON github_plan_events(plan_id, sequence);
CREATE INDEX IF NOT EXISTS self_development_runs_dashboard ON self_development_runs(updated_at DESC, state);
`;

export type PlanningJobCommand =
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
    };

export type DurablePlanningJob = {
  jobId: string;
  roundhouseEnvironment: "development" | "production";
  repositoryFullName: string;
  issueNumber: number;
  actorId: string;
  command: PlanningJobCommand;
  status:
    "queued" | "running" | "retrying" | "completed" | "failed" | "timed_out";
  attemptCount: number;
  failureReason?: string;
  generation: number;
  priorJobId?: string;
  priorFailureReason?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  events: Array<{ sequence: number; type: string; occurredAt: string }>;
};

type PlanningJobRow = {
  job_id: string;
  roundhouse_environment: DurablePlanningJob["roundhouseEnvironment"];
  repository_full_name: string;
  issue_number: number;
  actor_id: string;
  command_json: string;
  status: DurablePlanningJob["status"];
  attempt_count: number;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

async function planningGenerationJobId(
  requestKey: string,
  generation: number,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${requestKey}:generation:${generation}`),
  );
  const value = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `planning_job_${value.slice(0, 40)}`;
}

async function planningJob(
  env: ControlPlaneEnv,
  jobId: string,
): Promise<DurablePlanningJob | undefined> {
  const row = await env.DB.prepare(
    "SELECT job_id, roundhouse_environment, repository_full_name, issue_number, actor_id, command_json, status, attempt_count, failure_reason, created_at, updated_at, completed_at FROM github_planning_jobs WHERE job_id = ?",
  )
    .bind(jobId)
    .first<PlanningJobRow>();
  if (!row) return undefined;
  const events = await env.DB.prepare(
    "SELECT sequence, event_type, detail_json, occurred_at FROM github_planning_job_events WHERE job_id = ? ORDER BY sequence",
  )
    .bind(jobId)
    .all<{
      sequence: number;
      event_type: string;
      detail_json: string;
      occurred_at: string;
    }>();
  const queued = events.results.find(
    (event) => event.event_type === "planning.queued",
  );
  const queuedDetail = queued
    ? (JSON.parse(queued.detail_json) as Record<string, unknown>)
    : {};
  const generation =
    typeof queuedDetail.generation === "number" &&
    Number.isSafeInteger(queuedDetail.generation) &&
    queuedDetail.generation > 0
      ? queuedDetail.generation
      : 1;
  return {
    jobId: row.job_id,
    roundhouseEnvironment: row.roundhouse_environment,
    repositoryFullName: row.repository_full_name,
    issueNumber: row.issue_number,
    actorId: row.actor_id,
    command: JSON.parse(row.command_json) as PlanningJobCommand,
    status: row.status,
    attemptCount: row.attempt_count,
    failureReason: row.failure_reason ?? undefined,
    generation,
    priorJobId:
      typeof queuedDetail.priorJobId === "string"
        ? queuedDetail.priorJobId
        : undefined,
    priorFailureReason:
      typeof queuedDetail.priorFailureReason === "string"
        ? queuedDetail.priorFailureReason
        : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    events: events.results.map((event) => ({
      sequence: event.sequence,
      type: event.event_type,
      occurredAt: event.occurred_at,
    })),
  };
}

export async function reservePlanningJob(
  env: ControlPlaneEnv,
  input: {
    requestKey: string;
    jobId: string;
    roundhouseEnvironment: DurablePlanningJob["roundhouseEnvironment"];
    repositoryFullName: string;
    issueNumber: number;
    actorId: string;
    command: PlanningJobCommand;
    now: Date;
  },
): Promise<{ job: DurablePlanningJob; created: boolean }> {
  const now = input.now.toISOString();
  const retained = await env.DB.prepare(
    "SELECT job_id, status FROM github_planning_jobs WHERE request_key = ?",
  )
    .bind(input.requestKey)
    .first<{ job_id: string; status: DurablePlanningJob["status"] }>();
  if (retained && !["failed", "timed_out"].includes(retained.status))
    return { job: (await planningJob(env, retained.job_id))!, created: false };
  const prior = retained ? await planningJob(env, retained.job_id) : undefined;
  const generation = prior ? prior.generation + 1 : 1;
  const jobId = prior
    ? await planningGenerationJobId(input.requestKey, generation)
    : input.jobId;
  const insert = env.DB.prepare(
    "INSERT OR IGNORE INTO github_planning_jobs(job_id, request_key, roundhouse_environment, repository_full_name, issue_number, actor_id, command_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)",
  ).bind(
    jobId,
    input.requestKey,
    input.roundhouseEnvironment,
    input.repositoryFullName,
    input.issueNumber,
    input.actorId,
    JSON.stringify(input.command),
    now,
    now,
  );
  const queuedDetail = JSON.stringify({
    generation,
    ...(prior
      ? {
          priorJobId: prior.jobId,
          priorFailureReason:
            prior.failureReason?.slice(0, 1_000) ?? "unspecified failure",
        }
      : {}),
  });
  const event = env.DB.prepare(
    "INSERT OR IGNORE INTO github_planning_job_events(event_id, job_id, sequence, event_type, detail_json, occurred_at) SELECT ?, ?, 1, 'planning.queued', ?, ? WHERE EXISTS (SELECT 1 FROM github_planning_jobs WHERE job_id = ? AND request_key = ?)",
  ).bind(`${jobId}:1`, jobId, queuedDetail, now, jobId, input.requestKey);
  const results = prior
    ? await env.DB.batch([
        env.DB.prepare(
          "UPDATE github_planning_jobs SET request_key = ? WHERE job_id = ? AND request_key = ? AND status IN ('failed', 'timed_out')",
        ).bind(
          `${input.requestKey}:generation:${prior.generation}`,
          prior.jobId,
          input.requestKey,
        ),
        insert,
        event,
      ])
    : await env.DB.batch([insert, event]);
  const inserted = results[prior ? 1 : 0]!;
  const row = await env.DB.prepare(
    "SELECT job_id FROM github_planning_jobs WHERE request_key = ?",
  )
    .bind(input.requestKey)
    .first<{ job_id: string }>();
  if (!row) throw new Error("Planning job reservation was not retained");
  return {
    job: (await planningJob(env, row.job_id))!,
    created: (inserted.meta.changes ?? 0) === 1,
  };
}

export async function claimPlanningJob(
  env: ControlPlaneEnv,
  jobId: string,
  binding: {
    roundhouseEnvironment: DurablePlanningJob["roundhouseEnvironment"];
    repositoryFullName: string;
  },
  now: Date,
  leaseMs: number,
): Promise<(DurablePlanningJob & { claimId: string }) | undefined> {
  const claimId = crypto.randomUUID();
  const at = now.toISOString();
  const expires = new Date(now.getTime() + leaseMs).toISOString();
  const claimed = await env.DB.prepare(
    "UPDATE github_planning_jobs SET status = 'running', attempt_count = attempt_count + 1, claim_id = ?, claim_expires_at = ?, updated_at = ? WHERE job_id = ? AND roundhouse_environment = ? AND repository_full_name = ? AND status IN ('queued', 'retrying', 'running') AND (claim_id IS NULL OR claim_expires_at <= ?)",
  )
    .bind(
      claimId,
      expires,
      at,
      jobId,
      binding.roundhouseEnvironment,
      binding.repositoryFullName,
      at,
    )
    .run();
  if ((claimed.meta.changes ?? 0) !== 1) return undefined;
  const job = (await planningJob(env, jobId))!;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_planning_job_events(event_id, job_id, sequence, event_type, detail_json, occurred_at) VALUES (?, ?, ?, 'planning.started', ?, ?)",
  )
    .bind(
      `${jobId}:${job.attemptCount * 2}`,
      jobId,
      job.attemptCount * 2,
      JSON.stringify({ attempt: job.attemptCount }),
      at,
    )
    .run();
  return { ...job, claimId };
}

export async function finishPlanningJob(
  env: ControlPlaneEnv,
  jobId: string,
  claimId: string,
  result: unknown,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  const updated = await env.DB.prepare(
    "UPDATE github_planning_jobs SET status = 'completed', result_json = ?, claim_id = NULL, claim_expires_at = NULL, updated_at = ?, completed_at = ? WHERE job_id = ? AND status = 'running' AND claim_id = ?",
  )
    .bind(JSON.stringify(result), at, at, jobId, claimId)
    .run();
  if ((updated.meta.changes ?? 0) !== 1)
    throw new Error("Planning job claim was lost");
  const job = (await planningJob(env, jobId))!;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_planning_job_events(event_id, job_id, sequence, event_type, detail_json, occurred_at) VALUES (?, ?, ?, 'planning.completed', '{}', ?)",
  )
    .bind(
      `${jobId}:${job.attemptCount * 2 + 1}`,
      jobId,
      job.attemptCount * 2 + 1,
      at,
    )
    .run();
}

export async function failPlanningJob(
  env: ControlPlaneEnv,
  jobId: string,
  claimId: string,
  reason: string,
  retry: boolean,
  timedOut: boolean,
  now: Date,
): Promise<DurablePlanningJob> {
  const at = now.toISOString();
  const status = timedOut ? "timed_out" : retry ? "retrying" : "failed";
  const updated = await env.DB.prepare(
    "UPDATE github_planning_jobs SET status = ?, failure_reason = ?, claim_id = NULL, claim_expires_at = NULL, updated_at = ?, completed_at = CASE WHEN ? = 'retrying' THEN NULL ELSE ? END WHERE job_id = ? AND status = 'running' AND claim_id = ?",
  )
    .bind(status, reason, at, status, at, jobId, claimId)
    .run();
  if ((updated.meta.changes ?? 0) !== 1)
    throw new Error("Planning job claim was lost");
  const job = (await planningJob(env, jobId))!;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_planning_job_events(event_id, job_id, sequence, event_type, detail_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      `${jobId}:${job.attemptCount * 2 + 1}`,
      jobId,
      job.attemptCount * 2 + 1,
      `planning.${status}`,
      JSON.stringify({ attempt: job.attemptCount, reason }),
      at,
    )
    .run();
  return (await planningJob(env, jobId))!;
}

export async function planningJobForIssue(
  env: ControlPlaneEnv,
  roundhouseEnvironment: DurablePlanningJob["roundhouseEnvironment"],
  repositoryFullName: string,
  issueNumber: number,
): Promise<DurablePlanningJob | undefined> {
  const row = await env.DB.prepare(
    "SELECT job_id FROM github_planning_jobs WHERE roundhouse_environment = ? AND repository_full_name = ? AND issue_number = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(roundhouseEnvironment, repositoryFullName, issueNumber)
    .first<{ job_id: string }>();
  return row ? planningJob(env, row.job_id) : undefined;
}

export async function recoverablePlanningJobs(
  env: ControlPlaneEnv,
  binding: {
    roundhouseEnvironment: DurablePlanningJob["roundhouseEnvironment"];
    repositoryFullName: string;
  },
  now: Date,
): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT job_id FROM github_planning_jobs WHERE roundhouse_environment = ? AND repository_full_name = ? AND (status IN ('queued', 'retrying') OR (status = 'running' AND claim_expires_at <= ?)) ORDER BY updated_at LIMIT 25",
  )
    .bind(
      binding.roundhouseEnvironment,
      binding.repositoryFullName,
      now.toISOString(),
    )
    .all<{ job_id: string }>();
  return rows.results.map((row) => row.job_id);
}

type PlanStatus = "proposed" | "rejected" | "approved" | "materialized";
type DurablePlanStatus =
  PlanStatus | "needs_clarification" | "already_satisfied" | "duplicate";

type PlanRow = {
  plan_id: string;
  issue_number: number;
  revision: number;
  status: PlanStatus;
  plan_sha256: string;
  plan_json: string;
  evidence_object_key: string;
  evidence_sha256: string;
  evidence_size: number;
  approved_by: string | null;
  approved_at: string | null;
  run_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DurableIssuePlan = {
  plan: PlanningDecision;
  revision: number;
  status: DurablePlanStatus;
  evidence: { objectKey: string; sha256: string; size: number };
  approvedBy?: string;
  approvedAt?: string;
  runId?: string;
};

const encoder = new TextEncoder();

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseDecision(value: string): PlanningDecision {
  const decoded = JSON.parse(value) as { status?: unknown };
  if (decoded.status === "proposed") return qualifiedPlanSchema.parse(decoded);
  if (decoded.status === "rejected")
    return rejectedQualificationSchema.parse(decoded);
  return nonImplementationQualificationSchema.parse(decoded);
}

function durable(row: PlanRow): DurableIssuePlan {
  const plan = parseDecision(row.plan_json);
  return {
    plan,
    revision: row.revision,
    status:
      plan.status === "needs_clarification" ||
      plan.status === "already_satisfied" ||
      plan.status === "duplicate"
        ? plan.status
        : row.status,
    evidence: {
      objectKey: row.evidence_object_key,
      sha256: row.evidence_sha256,
      size: row.evidence_size,
    },
    approvedBy: row.approved_by ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    runId: row.run_id ?? undefined,
  };
}

function storedStatus(decision: PlanningDecision): "proposed" | "rejected" {
  return decision.status === "proposed" ? "proposed" : "rejected";
}

async function planRow(
  env: ControlPlaneEnv,
  field: "plan_id" | "issue_number",
  value: string | number,
): Promise<PlanRow | null> {
  return env.DB.prepare(
    `SELECT plan_id, issue_number, revision, status, plan_sha256, plan_json, evidence_object_key, evidence_sha256, evidence_size, approved_by, approved_at, run_id, created_at, updated_at FROM github_issue_plans WHERE ${field} = ?`,
  )
    .bind(value)
    .first<PlanRow>();
}

export async function readIssuePlan(
  env: ControlPlaneEnv,
  issueNumber: number,
): Promise<DurableIssuePlan | null> {
  const row = await planRow(env, "issue_number", issueNumber);
  return row ? durable(row) : null;
}

export async function readPlanById(
  env: ControlPlaneEnv,
  planId: string,
): Promise<DurableIssuePlan | undefined> {
  const row = await planRow(env, "plan_id", planId);
  return row ? durable(row) : undefined;
}

async function recordEvent(
  env: ControlPlaneEnv,
  planId: string,
  sequence: number,
  eventType: string,
  actorId: string,
  detail: Record<string, unknown>,
  occurredAt: string,
): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_plan_events(event_id, plan_id, sequence, event_type, actor_id, detail_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      `${planId}:${sequence}`,
      planId,
      sequence,
      eventType,
      actorId,
      JSON.stringify(detail),
      occurredAt,
    )
    .run();
}

export async function recordPlanningDecision(
  env: ControlPlaneEnv,
  decision: PlanningDecision,
  actorId: string,
  revisionBinding?: {
    planId: string;
    revision: number;
    planSha256: string;
    allowSameIssueContent?: boolean;
  },
): Promise<DurableIssuePlan> {
  const bytes = encoder.encode(JSON.stringify(decision));
  const evidenceSha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  const objectKey = `plans/${decision.planId}/plan.json`;
  if (env.EXECUTION_EVIDENCE) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    let writeError: unknown;
    const stored = await env.EXECUTION_EVIDENCE.put(objectKey, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        planId: decision.planId,
        planSha256: decision.planSha256,
      },
      sha256: digest,
    }).catch((error: unknown) => {
      writeError = error;
      return null;
    });
    if (!stored) {
      const existing = await env.EXECUTION_EVIDENCE.get(objectKey);
      if (existing && (await existing.text()) === JSON.stringify(decision)) {
        // An exact concurrent immutable write is a successful replay.
      } else if (writeError && !existing) {
        throw writeError;
      } else {
        throw new Error("Immutable plan evidence conflict");
      }
    }
  }
  const prior = await planRow(env, "issue_number", decision.issueNumber);
  if (
    prior &&
    (prior.plan_id !== decision.planId ||
      prior.plan_sha256 !== decision.planSha256 ||
      prior.plan_json !== JSON.stringify(decision))
  ) {
    const previousDecision = parseDecision(prior.plan_json);
    const previousReplannable =
      (prior.status === "proposed" && previousDecision.status === "proposed") ||
      (prior.status === "rejected" &&
        ["rejected", "needs_clarification"].includes(previousDecision.status));
    if (
      !revisionBinding ||
      revisionBinding.planId !== prior.plan_id ||
      revisionBinding.revision !== prior.revision ||
      revisionBinding.planSha256 !== prior.plan_sha256 ||
      !previousReplannable ||
      (previousDecision.issueContentSha256 === decision.issueContentSha256 &&
        !revisionBinding.allowSameIssueContent)
    )
      throw new Error("Issue already has a different immutable plan");
    const revised = await env.DB.prepare(
      "UPDATE github_issue_plans SET plan_id = ?, revision = revision + 1, status = ?, plan_sha256 = ?, plan_json = ?, evidence_object_key = ?, evidence_sha256 = ?, evidence_size = ?, approved_by = NULL, approved_at = NULL, run_id = NULL, created_at = ?, updated_at = ? WHERE issue_number = ? AND plan_id = ? AND revision = ? AND status IN ('rejected', 'proposed')",
    )
      .bind(
        decision.planId,
        storedStatus(decision),
        decision.planSha256,
        JSON.stringify(decision),
        objectKey,
        evidenceSha256,
        bytes.byteLength,
        decision.createdAt,
        decision.createdAt,
        decision.issueNumber,
        prior.plan_id,
        prior.revision,
      )
      .run();
    if ((revised.meta.changes ?? 0) !== 1)
      throw new Error("Issue plan revision changed concurrently");
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_issue_plans(plan_id, issue_number, revision, status, plan_sha256, plan_json, evidence_object_key, evidence_sha256, evidence_size, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      decision.planId,
      decision.issueNumber,
      storedStatus(decision),
      decision.planSha256,
      JSON.stringify(decision),
      objectKey,
      evidenceSha256,
      bytes.byteLength,
      decision.createdAt,
      decision.createdAt,
    )
    .run();
  const row = await planRow(env, "issue_number", decision.issueNumber);
  if (
    !row ||
    row.plan_id !== decision.planId ||
    row.plan_sha256 !== decision.planSha256 ||
    row.plan_json !== JSON.stringify(decision) ||
    row.evidence_sha256 !== evidenceSha256
  )
    throw new Error("Issue already has a different immutable plan");
  await recordEvent(
    env,
    decision.planId,
    row.revision,
    `plan.${decision.status}`,
    actorId,
    { planSha256: decision.planSha256 },
    decision.createdAt,
  );
  return durable(row);
}

export async function approvePlan(
  env: ControlPlaneEnv,
  input: {
    planId: string;
    expectedRevision: number;
    planSha256: string;
    actorId: string;
    now: Date;
  },
): Promise<DurableIssuePlan> {
  const row = await planRow(env, "plan_id", input.planId);
  if (!row) throw new Error("Plan not found");
  if (row.plan_sha256 !== input.planSha256)
    throw new Error("Plan approval binding does not match");
  const decision = parseDecision(row.plan_json);
  if (decision.status !== "proposed")
    throw new Error("Qualification cannot run");
  if (row.status === "approved" || row.status === "materialized") {
    const plan = parseDecision(row.plan_json);
    if (row.approved_by !== input.actorId)
      throw new Error("Existing plan approval actor does not match");
    // Replay must preserve the immutable revision embedded in the original
    // approval command, even though the durable row has advanced since then.
    if (input.expectedRevision !== plan.revision)
      throw new Error("Plan approval binding does not match");
    return durable(row);
  }
  if (row.revision !== input.expectedRevision)
    throw new Error("Plan approval binding does not match");
  const approvedAt = input.now.toISOString();
  const updated = await env.DB.prepare(
    "UPDATE github_issue_plans SET status = 'approved', revision = revision + 1, approved_by = ?, approved_at = ?, updated_at = ? WHERE plan_id = ? AND revision = ? AND status = 'proposed' AND plan_sha256 = ?",
  )
    .bind(
      input.actorId,
      approvedAt,
      approvedAt,
      input.planId,
      input.expectedRevision,
      input.planSha256,
    )
    .run();
  if ((updated.meta.changes ?? 0) !== 1)
    throw new Error("Plan approval changed concurrently");
  await recordEvent(
    env,
    input.planId,
    input.expectedRevision + 1,
    "plan.approved",
    input.actorId,
    { planSha256: input.planSha256 },
    approvedAt,
  );
  return durable((await planRow(env, "plan_id", input.planId))!);
}

export async function materializePlan(
  env: ControlPlaneEnv,
  planId: string,
  runId: string,
  actorId: string,
  now: Date,
): Promise<DurableIssuePlan> {
  const row = await planRow(env, "plan_id", planId);
  if (!row) throw new Error("Plan not found");
  if (row.status === "materialized") {
    if (row.run_id !== runId) throw new Error("Plan run binding conflict");
    return durable(row);
  }
  if (row.status !== "approved") throw new Error("Plan is not approved");
  const occurredAt = now.toISOString();
  const updated = await env.DB.prepare(
    "UPDATE github_issue_plans SET status = 'materialized', revision = revision + 1, run_id = ?, updated_at = ? WHERE plan_id = ? AND revision = ? AND status = 'approved' AND run_id IS NULL",
  )
    .bind(runId, occurredAt, planId, row.revision)
    .run();
  if ((updated.meta.changes ?? 0) !== 1)
    throw new Error("Plan materialization changed concurrently");
  await recordEvent(
    env,
    planId,
    row.revision + 1,
    "plan.materialized",
    actorId,
    { runId },
    occurredAt,
  );
  return durable((await planRow(env, "plan_id", planId))!);
}

export async function listIssuePlans(
  env: ControlPlaneEnv,
  limit = 50,
): Promise<DurableIssuePlan[]> {
  const rows = await env.DB.prepare(
    "SELECT plan_id, issue_number, revision, status, plan_sha256, plan_json, evidence_object_key, evidence_sha256, evidence_size, approved_by, approved_at, run_id, created_at, updated_at FROM github_issue_plans ORDER BY updated_at DESC LIMIT ?",
  )
    .bind(Math.max(1, Math.min(limit, 100)))
    .all<PlanRow>();
  return rows.results.map(durable);
}

export function requireQualifiedPlan(value: DurableIssuePlan): QualifiedPlan {
  if (value.plan.status !== "proposed")
    throw new Error("Plan was rejected by repository policy");
  return value.plan;
}
