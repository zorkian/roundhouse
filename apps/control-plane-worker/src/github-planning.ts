// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  qualifiedPlanSchema,
  rejectedQualificationSchema,
  type PlanningDecision,
  type QualifiedPlan,
} from "@roundhouse/self-development/cloudflare";

import type { ControlPlaneEnv } from "./environment.js";

export const githubPlanningMigration = `
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
`;

type PlanStatus = "proposed" | "rejected" | "approved" | "materialized";

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
  status: PlanStatus;
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
  return decoded.status === "proposed"
    ? qualifiedPlanSchema.parse(decoded)
    : rejectedQualificationSchema.parse(decoded);
}

function durable(row: PlanRow): DurableIssuePlan {
  return {
    plan: parseDecision(row.plan_json),
    revision: row.revision,
    status: row.status,
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

export async function readPlan(
  env: ControlPlaneEnv,
  planId: string,
): Promise<DurableIssuePlan | null> {
  const row = await planRow(env, "plan_id", planId);
  return row ? durable(row) : null;
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
): Promise<DurableIssuePlan> {
  const bytes = encoder.encode(JSON.stringify(decision));
  const evidenceSha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  const objectKey = `plans/${decision.planId}/plan.json`;
  if (env.EXECUTION_EVIDENCE) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const stored = await env.EXECUTION_EVIDENCE.put(objectKey, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        planId: decision.planId,
        planSha256: decision.planSha256,
      },
      sha256: digest,
    });
    if (!stored) {
      const existing = await env.EXECUTION_EVIDENCE.get(objectKey);
      if (!existing || (await existing.text()) !== JSON.stringify(decision))
        throw new Error("Immutable plan evidence conflict");
    }
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO github_issue_plans(plan_id, issue_number, revision, status, plan_sha256, plan_json, evidence_object_key, evidence_sha256, evidence_size, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      decision.planId,
      decision.issueNumber,
      decision.status,
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
    1,
    decision.status === "proposed" ? "plan.proposed" : "plan.rejected",
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
  if (row.status === "rejected") throw new Error("Rejected plan cannot run");
  if (row.status === "approved" || row.status === "materialized") {
    const plan = parseDecision(row.plan_json);
    if (
      row.approved_by !== input.actorId ||
      input.expectedRevision !== plan.revision
    )
      throw new Error("Existing plan approval actor does not match");
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
