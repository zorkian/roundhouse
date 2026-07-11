import { newId } from "@roundhouse/domain";

import type { ApprovalEvent, StartRunInput } from "./contracts.js";

export type RunRow = {
  id: string;
  workflow_instance_id: string;
  idempotency_key: string;
  subject: string;
  plan_revision: number;
  state: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export async function createRun(
  db: D1Database,
  input: StartRunInput,
  instanceId: string,
): Promise<{ run: RunRow; created: boolean }> {
  const id = newId("run");
  const eventId = newId("event");
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO runs
        (id, workflow_instance_id, idempotency_key, subject, plan_revision, state, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'starting', ?6, ?6)`,
    )
    .bind(
      id,
      instanceId,
      input.idempotencyKey,
      input.subject,
      input.planRevision,
      now,
    )
    .run();

  const created = result.meta.changes === 1;
  const run = await db
    .prepare("SELECT * FROM runs WHERE idempotency_key = ?1")
    .bind(input.idempotencyKey)
    .first<RunRow>();
  if (!run) throw new Error("Run insert did not produce a readable row");

  if (created) {
    await appendEvent(db, {
      id: eventId,
      runId: run.id,
      type: "run.created",
      actorType: "system",
      actorId: "control-plane-spike",
      occurredAt: now,
      payload: { subject: input.subject, planRevision: input.planRevision },
    });
  } else if (
    run.subject !== input.subject ||
    run.plan_revision !== input.planRevision
  ) {
    throw new IdempotencyConflictError();
  }

  return { run, created };
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used with a different request");
    this.name = "IdempotencyConflictError";
  }
}

export async function getRun(
  db: D1Database,
  runId: string,
): Promise<RunRow | null> {
  return db
    .prepare("SELECT * FROM runs WHERE id = ?1")
    .bind(runId)
    .first<RunRow>();
}

type EventInput = {
  id?: string;
  runId: string;
  type: string;
  actorType: "human" | "system";
  actorId: string;
  occurredAt?: string;
  payload: unknown;
};

export async function appendEvent(
  db: D1Database,
  event: EventInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO events
        (id, run_id, type, schema_version, actor_type, actor_id, occurred_at, payload_json)
       VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      event.id ?? newId("event"),
      event.runId,
      event.type,
      event.actorType,
      event.actorId,
      event.occurredAt ?? new Date().toISOString(),
      JSON.stringify(event.payload),
    )
    .run();
}

export async function recordApproval(
  db: D1Database,
  run: RunRow,
  input: ApprovalEvent,
): Promise<boolean> {
  const result = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO approvals (id, run_id, plan_revision, actor_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(
        input.approvalId,
        run.id,
        input.planRevision,
        input.actorId,
        input.occurredAt,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO events
          (id, run_id, type, schema_version, actor_type, actor_id, occurred_at, payload_json)
         VALUES (?1, ?2, 'plan.approved', 1, 'human', ?3, ?4, ?5)`,
      )
      .bind(
        newId("event"),
        run.id,
        input.actorId,
        input.occurredAt,
        JSON.stringify({
          approvalId: input.approvalId,
          planRevision: input.planRevision,
        }),
      ),
  ]);
  return result[0]?.meta.changes === 1;
}

export async function runDetail(
  db: D1Database,
  runId: string,
): Promise<Record<string, unknown> | null> {
  const run = await getRun(db, runId);
  if (!run) return null;
  const [events, artifacts] = await Promise.all([
    db
      .prepare(
        "SELECT * FROM events WHERE run_id = ?1 ORDER BY occurred_at, id",
      )
      .bind(runId)
      .all(),
    db
      .prepare(
        "SELECT * FROM artifacts WHERE run_id = ?1 ORDER BY created_at, id",
      )
      .bind(runId)
      .all(),
  ]);
  return { run, events: events.results, artifacts: artifacts.results };
}
