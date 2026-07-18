// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  transitionRun,
  type Attempt,
  type Lease,
  type RunRepository,
  type RunSnapshot,
  type RunTransition,
  type Wakeup,
} from "@roundhouse/core";

interface Result<T> {
  results?: T[];
  meta: { changes?: number };
}
interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run<T = unknown>(): Promise<Result<T>>;
  all<T>(): Promise<Result<T>>;
}
export interface D1Like {
  prepare(sql: string): Statement;
}

type RunRow = { document_json: string };
type AttemptRow = {
  id: string;
  run_id: string;
  run_revision: number;
  kind: Attempt["kind"];
  stage: Attempt["stage"];
  role: string;
  state: Attempt["state"];
  deadline_at: number;
  base_commit: string;
  expected_head: string;
  accepted_head: string | null;
  result_json: string | null;
};

export class D1RunRepository implements RunRepository {
  constructor(
    private readonly db: D1Like,
    private readonly now = () => Date.now(),
  ) {}

  async create(run: RunSnapshot): Promise<void> {
    const time = this.now();
    const repositoryId = `repo_${run.repository}`;
    const workItemId = `work_${run.id}`;
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO repositories (id, github_id, profile_version, profile_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind(
        repositoryId,
        run.repository,
        run.profileVersion,
        JSON.stringify({ repository: run.repository }),
        time,
      )
      .run();
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO work_items (id, repository_id, issue_number, current_run_id) VALUES (?1, ?2, ?3, ?4)",
      )
      .bind(workItemId, repositoryId, run.issueNumber, run.id)
      .run();
    await this.db
      .prepare(
        "INSERT INTO runs (id, work_item_id, status, stage, revision, document_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
      )
      .bind(
        run.id,
        workItemId,
        run.status,
        run.stage,
        run.revision,
        JSON.stringify(run),
        time,
      )
      .run();
  }

  async get(runId: string): Promise<RunSnapshot | undefined> {
    const row = await this.db
      .prepare("SELECT document_json FROM runs WHERE id = ?1")
      .bind(runId)
      .first<RunRow>();
    return row ? (JSON.parse(row.document_json) as RunSnapshot) : undefined;
  }

  async transition(
    runId: string,
    expectedRevision: number,
    transition: RunTransition,
  ): Promise<RunSnapshot | undefined> {
    const current = await this.get(runId);
    if (!current || current.revision !== expectedRevision) return undefined;
    const next = transitionRun(current, expectedRevision, transition);
    const result = await this.db
      .prepare(
        "UPDATE runs SET status=?1, stage=?2, revision=?3, document_json=?4, updated_at=?5 WHERE id=?6 AND revision=?7",
      )
      .bind(
        next.status,
        next.stage,
        next.revision,
        JSON.stringify(next),
        this.now(),
        runId,
        expectedRevision,
      )
      .run();
    return (result.meta.changes ?? 0) === 1 ? next : undefined;
  }

  async claimLease(
    runId: string,
    expectedRevision: number,
    lease: Lease,
    now: number,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE runs SET lease_attempt_id=?1, lease_revision=?2, lease_expires_at=?3, updated_at=?4 WHERE id=?5 AND revision=?2 AND status='active' AND (lease_expires_at IS NULL OR lease_expires_at<=?4)",
      )
      .bind(lease.attemptId, expectedRevision, lease.expiresAt, now, runId)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async createAttempt(attempt: Attempt): Promise<"created" | "exists"> {
    const result = await this.db
      .prepare(
        "INSERT OR IGNORE INTO attempts (id,run_id,run_revision,kind,stage,role,state,deadline_at,base_commit,expected_head,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
      )
      .bind(
        attempt.id,
        attempt.runId,
        attempt.runRevision,
        attempt.kind,
        attempt.stage,
        attempt.role,
        attempt.state,
        attempt.deadlineAt,
        attempt.baseCommit,
        attempt.expectedHead,
        this.now(),
      )
      .run();
    return (result.meta.changes ?? 0) === 1 ? "created" : "exists";
  }

  async markDispatched(attemptId: string): Promise<void> {
    await this.db
      .prepare(
        "UPDATE attempts SET state='dispatched', updated_at=?1 WHERE id=?2 AND state='created'",
      )
      .bind(this.now(), attemptId)
      .run();
  }

  async completeAttempt(
    attemptId: string,
    expectedRevision: number,
    acceptedHead: string,
    result: Readonly<Record<string, unknown>>,
  ): Promise<"completed" | "duplicate" | "stale"> {
    const attempt = await this.getAttempt(attemptId);
    if (!attempt || attempt.runRevision !== expectedRevision) return "stale";
    if (attempt.state === "completed") return "duplicate";
    const updated = await this.db
      .prepare(
        "UPDATE attempts SET state='completed', accepted_head=?1, result_json=?2, updated_at=?3 WHERE id=?4 AND run_revision=?5 AND state!='completed' AND EXISTS (SELECT 1 FROM runs WHERE id=attempts.run_id AND revision=?5)",
      )
      .bind(
        acceptedHead,
        JSON.stringify(result),
        this.now(),
        attemptId,
        expectedRevision,
      )
      .run();
    if ((updated.meta.changes ?? 0) !== 1) return "stale";
    await this.db
      .prepare(
        "UPDATE runs SET lease_attempt_id=NULL, lease_revision=NULL, lease_expires_at=NULL WHERE id=?1 AND lease_attempt_id=?2 AND revision=?3",
      )
      .bind(attempt.runId, attemptId, expectedRevision)
      .run();
    return "completed";
  }

  async getAttempt(attemptId: string): Promise<Attempt | undefined> {
    const row = await this.db
      .prepare(
        "SELECT id,run_id,run_revision,kind,stage,role,state,deadline_at,base_commit,expected_head,accepted_head,result_json FROM attempts WHERE id=?1",
      )
      .bind(attemptId)
      .first<AttemptRow>();
    return row
      ? {
          id: row.id,
          runId: row.run_id,
          runRevision: row.run_revision,
          kind: row.kind,
          stage: row.stage,
          role: row.role,
          state: row.state,
          deadlineAt: row.deadline_at,
          baseCommit: row.base_commit,
          expectedHead: row.expected_head,
          ...(row.accepted_head ? { acceptedHead: row.accepted_head } : {}),
          ...(row.result_json
            ? { result: JSON.parse(row.result_json) as Record<string, unknown> }
            : {}),
        }
      : undefined;
  }

  async expiredLeases(now: number): Promise<readonly Wakeup[]> {
    const result = await this.db
      .prepare(
        "SELECT id,revision FROM runs WHERE status='active' AND lease_expires_at<=?1",
      )
      .bind(now)
      .all<{ id: string; revision: number }>();
    return (result.results ?? []).map((row) => ({
      runId: row.id,
      expectedRevision: row.revision,
    }));
  }
}
