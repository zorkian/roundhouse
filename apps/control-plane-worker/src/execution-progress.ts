// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

import type { ControlPlaneEnv } from "./environment.js";

export const executionProgressMigration = `
CREATE TABLE IF NOT EXISTS execution_attempt_phases (
  attempt_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  PRIMARY KEY (attempt_id, phase)
);
CREATE INDEX IF NOT EXISTS execution_attempt_phases_run
  ON execution_attempt_phases(run_id, started_at);
CREATE TABLE IF NOT EXISTS github_pull_request_lifecycle (
  repository_full_name TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'closed', 'merged')),
  merge_commit_sha TEXT,
  merged_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (repository_full_name, pull_request_number),
  UNIQUE (run_id)
);
CREATE INDEX IF NOT EXISTS github_pull_request_lifecycle_run
  ON github_pull_request_lifecycle(run_id);
`;

const phaseRecordSchema = z.object({
  runId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
  attemptId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/),
  phase: z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/),
  status: z.enum(["running", "completed", "failed"]),
  occurredAt: z.iso.datetime(),
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export async function recordExecutionPhase(
  env: ControlPlaneEnv,
  input: z.input<typeof phaseRecordSchema>,
): Promise<void> {
  const value = phaseRecordSchema.parse(input);
  const completedAt = value.status === "running" ? null : value.occurredAt;
  const recorded = await env.DB.prepare(
    `INSERT INTO execution_attempt_phases(attempt_id, run_id, phase, status, started_at, completed_at, updated_at, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(attempt_id, phase) DO UPDATE SET
       status = excluded.status,
       completed_at = excluded.completed_at,
       updated_at = excluded.updated_at,
       detail_json = excluded.detail_json
     WHERE execution_attempt_phases.run_id = excluded.run_id`,
  )
    .bind(
      value.attemptId,
      value.runId,
      value.phase,
      value.status,
      value.occurredAt,
      completedAt,
      value.occurredAt,
      JSON.stringify(value.detail),
    )
    .run();
  if ((recorded.meta.changes ?? 0) !== 1)
    throw new Error("Execution progress identity conflict");
}

export async function readExecutionProgress(
  env: ControlPlaneEnv,
  runId: string,
): Promise<
  Array<{
    attemptId: string;
    phase: string;
    status: "running" | "completed" | "failed";
    startedAt: string;
    completedAt?: string;
    updatedAt: string;
    detail: Record<string, unknown>;
  }>
> {
  const rows = await env.DB.prepare(
    "SELECT attempt_id, phase, status, started_at, completed_at, updated_at, detail_json FROM execution_attempt_phases WHERE run_id = ? ORDER BY started_at, phase",
  )
    .bind(runId)
    .all<{
      attempt_id: string;
      phase: string;
      status: "running" | "completed" | "failed";
      started_at: string;
      completed_at: string | null;
      updated_at: string;
      detail_json: string;
    }>();
  return rows.results.map((row) => ({
    attemptId: row.attempt_id,
    phase: row.phase,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    updatedAt: row.updated_at,
    detail: JSON.parse(row.detail_json) as Record<string, unknown>,
  }));
}
