// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  selfDevelopmentRunSchema,
  type SelfDevelopmentRun,
} from "@roundhouse/self-development/cloudflare";

import type { ControlPlaneEnv } from "./environment.js";

export const internalRecoveryActor = "roundhouse:scheduler";
export const cloudOperationsMigration = `
CREATE TABLE IF NOT EXISTS operator_mutations (
  idempotency_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
  action TEXT NOT NULL, run_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  response_json TEXT, created_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS operator_mutations_run ON operator_mutations(run_id, created_at);
CREATE TABLE IF NOT EXISTS operational_alerts (
  alert_key TEXT PRIMARY KEY, kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  run_id TEXT, detail_json TEXT NOT NULL, first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL, occurrences INTEGER NOT NULL DEFAULT 1, resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS operational_alerts_active ON operational_alerts(resolved_at, last_seen_at);
CREATE TABLE IF NOT EXISTS recovery_cycles (
  cycle_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL, repaired_submissions INTEGER NOT NULL,
  requeued_runs INTEGER NOT NULL, alerts_recorded INTEGER NOT NULL
);
`;

export class MutationConflictError extends Error {
  constructor() {
    super("Idempotency key is bound to a different operator mutation");
  }
}
export class MutationPendingError extends Error {
  constructor() {
    super("An operator mutation with this idempotency key is still pending");
  }
}

async function hash(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function idempotentMutation<T>(
  env: ControlPlaneEnv,
  input: {
    key: string;
    action: string;
    runId: string;
    actorId: string;
    request: unknown;
    now: Date;
  },
  mutate: () => Promise<T>,
): Promise<{ value: T; replayed: boolean }> {
  const requestHash = await hash(input.request);
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO operator_mutations(idempotency_key, request_hash, action, run_id, actor_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
  )
    .bind(
      input.key,
      requestHash,
      input.action,
      input.runId,
      input.actorId,
      input.now.toISOString(),
    )
    .run();
  if ((inserted.meta.changes ?? 0) !== 1) {
    const row = await env.DB.prepare(
      "SELECT request_hash, action, run_id, actor_id, status, response_json FROM operator_mutations WHERE idempotency_key = ?",
    )
      .bind(input.key)
      .first<{
        request_hash: string;
        action: string;
        run_id: string;
        actor_id: string;
        status: string;
        response_json: string | null;
      }>();
    if (
      !row ||
      row.request_hash !== requestHash ||
      row.action !== input.action ||
      row.run_id !== input.runId ||
      row.actor_id !== input.actorId
    )
      throw new MutationConflictError();
    if (row.status !== "completed" || !row.response_json)
      throw new MutationPendingError();
    return { value: JSON.parse(row.response_json) as T, replayed: true };
  }
  let value: T;
  try {
    value = await mutate();
  } catch (error) {
    await env.DB.prepare(
      "DELETE FROM operator_mutations WHERE idempotency_key = ? AND status = 'pending'",
    )
      .bind(input.key)
      .run();
    throw error;
  }
  const completed = await env.DB.prepare(
    "UPDATE operator_mutations SET status = 'completed', response_json = ?, completed_at = ? WHERE idempotency_key = ? AND status = 'pending'",
  )
    .bind(JSON.stringify(value), new Date().toISOString(), input.key)
    .run();
  if ((completed.meta.changes ?? 0) !== 1)
    throw new Error("Operator mutation receipt could not be completed");
  return { value, replayed: false };
}

export async function recordAlert(
  env: ControlPlaneEnv,
  input: {
    key: string;
    kind: string;
    severity: "info" | "warning" | "error";
    runId?: string;
    detail: Record<string, unknown>;
    now: Date;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO operational_alerts(alert_key, kind, severity, run_id, detail_json, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(alert_key) DO UPDATE SET
       kind = excluded.kind,
       severity = excluded.severity,
       run_id = excluded.run_id,
       last_seen_at = excluded.last_seen_at,
       occurrences = operational_alerts.occurrences + 1,
       detail_json = excluded.detail_json,
       resolved_at = NULL`,
  )
    .bind(
      input.key,
      input.kind,
      input.severity,
      input.runId ?? null,
      JSON.stringify(input.detail),
      input.now.toISOString(),
      input.now.toISOString(),
    )
    .run();
}

const retryState = {
  prepare: "created",
  implement: "workspace_ready",
  validate: "validating",
  commit: "approved",
  push: "committed",
  complete: "pushed",
} as const;

export async function retryFailedRun(
  env: ControlPlaneEnv,
  runId: string,
  expectedRevision: number,
  now: Date,
): Promise<SelfDevelopmentRun> {
  const row = await env.DB.prepare(
    "SELECT revision, payload FROM self_development_runs WHERE run_id = ?",
  )
    .bind(runId)
    .first<{ revision: number; payload: string }>();
  if (!row) throw new Error(`Run not found: ${runId}`);
  const run = selfDevelopmentRunSchema.parse(JSON.parse(row.payload));
  const attempt = run.attempts.at(-1);
  if (
    run.revision !== expectedRevision ||
    run.state !== "failed" ||
    attempt?.status !== "failed" ||
    !attempt.retryable
  )
    throw new Error("Run is not eligible for retry at this revision");
  const state = retryState[attempt.stage];
  const next = selfDevelopmentRunSchema.parse({
    ...run,
    state,
    lease: undefined,
    updatedAt: now.toISOString(),
    revision: run.revision + 1,
    events: [
      ...run.events,
      {
        sequence: run.events.length + 1,
        type: "operator.retry_requested",
        state,
        occurredAt: now.toISOString(),
        detail: { failedAttemptId: attempt.attemptId },
      },
    ],
  });
  const updated = await env.DB.prepare(
    "UPDATE self_development_runs SET revision = ?, state = ?, updated_at = ?, payload = ? WHERE run_id = ? AND revision = ? AND state = 'failed'",
  )
    .bind(
      next.revision,
      next.state,
      next.updatedAt,
      JSON.stringify(next),
      runId,
      expectedRevision,
    )
    .run();
  if ((updated.meta.changes ?? 0) !== 1)
    throw new Error("Retry revision changed concurrently");
  return next;
}

export async function runRecoveryCycle(
  env: ControlPlaneEnv,
  now: Date,
): Promise<{
  cycleId: string;
  repairedSubmissions: number;
  requeuedRuns: number;
  alertsRecorded: number;
}> {
  let repairedSubmissions = 0;
  let requeuedRuns = 0;
  let alertsRecorded = 0;
  const pending = await env.DB.prepare(
    "SELECT idempotency_key, run_id, delivery_id FROM control_plane_submissions WHERE delivery_state = 'pending' LIMIT 50",
  ).all<{ idempotency_key: string; run_id: string; delivery_id: string }>();
  for (const row of pending.results) {
    const run = await env.DB.prepare(
      "SELECT revision FROM self_development_runs WHERE run_id = ?",
    )
      .bind(row.run_id)
      .first<{ revision: number }>();
    if (!run) {
      await recordAlert(env, {
        key: `submission_missing_run:${row.run_id}`,
        kind: "submission_missing_run",
        severity: "error",
        runId: row.run_id,
        detail: {},
        now,
      });
      alertsRecorded += 1;
      continue;
    }
    await env.RUN_QUEUE.send({
      schemaVersion: 1,
      runId: row.run_id,
      deliveryId: row.delivery_id,
      expectedRevision: run.revision,
    });
    await env.DB.prepare(
      "UPDATE control_plane_submissions SET delivery_state = 'sent', delivered_at = ? WHERE idempotency_key = ? AND delivery_state = 'pending'",
    )
      .bind(now.toISOString(), row.idempotency_key)
      .run();
    repairedSubmissions += 1;
  }
  const rows = await env.DB.prepare(
    "SELECT run_id, revision, payload FROM self_development_runs WHERE state NOT IN ('completed', 'cancelled', 'failed', 'awaiting_approval', 'awaiting_publication') LIMIT 100",
  ).all<{ run_id: string; revision: number; payload: string }>();
  for (const row of rows.results) {
    let run: SelfDevelopmentRun;
    try {
      run = selfDevelopmentRunSchema.parse(JSON.parse(row.payload));
    } catch {
      await recordAlert(env, {
        key: `malformed_run_payload:${row.run_id}`,
        kind: "malformed_run_payload",
        severity: "error",
        runId: row.run_id,
        detail: { revision: row.revision },
        now,
      });
      alertsRecorded += 1;
      continue;
    }
    if (run.lease && new Date(run.lease.expiresAt) > now) continue;
    const recoveryKind = run.lease
      ? "expired_lease_requeued"
      : "lease_less_run_requeued";
    await env.RUN_QUEUE.send({
      schemaVersion: 1,
      runId: run.runId,
      deliveryId: `recovery_${run.runId}_${run.revision}`,
      expectedRevision: run.revision,
    });
    await recordAlert(env, {
      key: `${recoveryKind}:${run.runId}:${run.revision}`,
      kind: recoveryKind,
      severity: "warning",
      runId: run.runId,
      detail: { revision: run.revision, hadLease: Boolean(run.lease) },
      now,
    });
    requeuedRuns += 1;
    alertsRecorded += 1;
  }
  const cycleId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO recovery_cycles(cycle_id, actor_id, started_at, completed_at, repaired_submissions, requeued_runs, alerts_recorded) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      cycleId,
      internalRecoveryActor,
      now.toISOString(),
      new Date().toISOString(),
      repairedSubmissions,
      requeuedRuns,
      alertsRecorded,
    )
    .run();
  return { cycleId, repairedSubmissions, requeuedRuns, alertsRecorded };
}

export async function retentionReport(env: ControlPlaneEnv) {
  const runs = await env.DB.prepare(
    "SELECT state, COUNT(*) AS count FROM self_development_runs GROUP BY state",
  ).all<{ state: string; count: number }>();
  const payloadSummary = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN json_valid(payload) THEN COALESCE(json_array_length(payload, '$.evidence'), 0) ELSE 0 END), 0) AS evidence_references,
       COALESCE(SUM(CASE WHEN json_valid(payload) THEN 0 ELSE 1 END), 0) AS malformed_payloads
     FROM self_development_runs`,
  ).first<{ evidence_references: number; malformed_payloads: number }>();
  const alerts = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM operational_alerts WHERE resolved_at IS NULL",
  ).first<{ count: number }>();
  return {
    schemaVersion: 1,
    dryRun: true,
    runCounts: Object.fromEntries(
      runs.results.map((row) => [row.state, row.count]),
    ),
    evidenceReferences: payloadSummary?.evidence_references ?? 0,
    malformedRunPayloads: payloadSummary?.malformed_payloads ?? 0,
    activeAlerts: alerts?.count ?? 0,
    deletions: [],
  };
}
