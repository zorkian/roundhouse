// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  selfDevelopmentRunSchema,
  type JobStage,
  type SelfDevelopmentRun,
  type SelfDevelopmentRunState,
  type SelfDevelopmentTask,
} from "./task.js";
import type {
  AttemptFailure,
  JobClaim,
  JobStore,
  RunUpdates,
} from "./job-ports.js";
import { approvalMatches, type ExactApproval } from "./trusted-loop.js";

const claimable = new Set<SelfDevelopmentRunState>([
  "created",
  "workspace_ready",
  "implementing",
  "validating",
  "approved",
  "committed",
  "pushed",
]);
const recovery: Record<JobStage, SelfDevelopmentRunState> = {
  prepare: "created",
  implement: "workspace_ready",
  validate: "validating",
  commit: "approved",
  push: "committed",
  complete: "pushed",
};

export const d1JobStoreMigration = `
CREATE TABLE IF NOT EXISTS self_development_runs (
  run_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS self_development_runs_claimable
  ON self_development_runs(state, updated_at);
`;

type Mutation<T> = { run: SelfDevelopmentRun; result: T } | null;
type D1Result = { meta: { changes?: number } };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<D1Result>;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
};
export type D1DatabasePort = { prepare(query: string): D1Statement };

export class D1JobStore implements JobStore {
  constructor(private readonly db: D1DatabasePort) {}

  private async writeCas(
    previous: SelfDevelopmentRun,
    run: SelfDevelopmentRun,
  ): Promise<boolean> {
    const next = selfDevelopmentRunSchema.parse({
      ...run,
      revision: previous.revision + 1,
    });
    const result = await this.db
      .prepare(
        "UPDATE self_development_runs SET revision = ?, state = ?, updated_at = ?, payload = ? WHERE run_id = ? AND revision = ?",
      )
      .bind(
        next.revision,
        next.state,
        next.updatedAt,
        JSON.stringify(next),
        next.runId,
        previous.revision,
      )
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  private async mutate<T>(
    runId: string,
    change: (run: SelfDevelopmentRun) => Mutation<T>,
  ): Promise<T | null> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await this.read(runId);
      const mutation = change(current);
      if (!mutation) return null;
      if (await this.writeCas(current, mutation.run)) return mutation.result;
    }
    throw new Error(`D1 compare-and-set contention exceeded for ${runId}`);
  }

  async submit(
    runId: string,
    task: SelfDevelopmentTask,
    now: Date,
  ): Promise<void> {
    const timestamp = now.toISOString();
    const run = selfDevelopmentRunSchema.parse({
      schemaVersion: 1,
      runId,
      revision: 1,
      task,
      state: "created",
      createdAt: timestamp,
      updatedAt: timestamp,
      attempts: [],
      events: [
        {
          sequence: 1,
          type: "run.created",
          state: "created",
          occurredAt: timestamp,
          detail: {},
        },
      ],
    });
    await this.db
      .prepare(
        "INSERT INTO self_development_runs(run_id, revision, state, updated_at, payload) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(runId, 1, run.state, timestamp, JSON.stringify(run))
      .run();
  }

  async read(runId: string): Promise<SelfDevelopmentRun> {
    const row = await this.db
      .prepare("SELECT payload FROM self_development_runs WHERE run_id = ?")
      .bind(runId)
      .first<{ payload: string }>();
    if (!row) throw new Error(`Run not found: ${runId}`);
    return selfDevelopmentRunSchema.parse(JSON.parse(row.payload));
  }

  async cancel(runId: string, now: Date): Promise<SelfDevelopmentRun> {
    const cancelled = await this.mutate(runId, (run) => {
      if (["cancelled", "completed", "failed"].includes(run.state)) return null;
      const attempts = run.attempts.map((attempt) =>
        attempt.status === "running"
          ? {
              ...attempt,
              status: "failed" as const,
              completedAt: now.toISOString(),
              retryable: false,
              classification: "cancelled",
              error: "Run was cancelled",
            }
          : attempt,
      );
      const { lease: _lease, ...rest } = run;
      const next = {
        ...rest,
        state: "cancelled" as const,
        updatedAt: now.toISOString(),
        attempts,
        events: [
          ...run.events,
          {
            sequence: run.events.length + 1,
            type: "run.cancelled",
            state: "cancelled" as const,
            occurredAt: now.toISOString(),
            detail: {},
          },
        ],
      };
      return {
        run: next,
        result: selfDevelopmentRunSchema.parse({
          ...next,
          revision: run.revision + 1,
        }),
      };
    });
    return cancelled ?? this.read(runId);
  }

  async approve(
    runId: string,
    approval: ExactApproval,
    expectedRevision: number,
    now: Date,
  ): Promise<SelfDevelopmentRun> {
    const approved = await this.mutate(runId, (run) => {
      if (run.revision !== expectedRevision)
        throw new Error("Approval revision does not match");
      if (run.state !== "awaiting_approval" || !run.implementation)
        throw new Error("Run is not awaiting an implementation approval");
      const evidence = run.evidence.map(
        ({ evidenceId, objectKey, sha256, size }) => ({
          evidenceId,
          objectKey,
          sha256,
          size,
        }),
      );
      if (
        !approvalMatches(approval, {
          runId,
          baseCommit: run.task.baseCommit,
          patchSha256: run.implementation.patchSha256,
          evidence,
        })
      )
        throw new Error("Approval binding does not match the run");
      const next = {
        ...run,
        state: "awaiting_approval" as const,
        approval,
        updatedAt: now.toISOString(),
        events: [
          ...run.events,
          {
            sequence: run.events.length + 1,
            type: "run.approved",
            state: "awaiting_approval" as const,
            occurredAt: now.toISOString(),
            detail: {
              approver: approval.approver,
              patchSha256: approval.patchSha256,
            },
          },
        ],
      };
      return {
        run: next,
        result: selfDevelopmentRunSchema.parse({
          ...next,
          revision: run.revision + 1,
        }),
      };
    });
    return approved!;
  }

  async recordPublication(
    runId: string,
    publication: NonNullable<SelfDevelopmentRun["publication"]>,
    expectedRevision: number,
    now: Date,
  ): Promise<SelfDevelopmentRun> {
    const recorded = await this.mutate(runId, (run) => {
      if (run.revision !== expectedRevision)
        throw new Error("Publication revision does not match");
      if (run.state !== "awaiting_approval" || !run.approval)
        throw new Error("Run does not have a valid approval");
      const next = {
        ...run,
        state: "completed" as const,
        publication,
        commit: publication.commit,
        updatedAt: now.toISOString(),
        events: [
          ...run.events,
          {
            sequence: run.events.length + 1,
            type: "publication.verified",
            state: "completed" as const,
            occurredAt: now.toISOString(),
            detail: {
              branch: publication.branch,
              commit: publication.commit,
            },
          },
        ],
      };
      return {
        run: next,
        result: selfDevelopmentRunSchema.parse({
          ...next,
          revision: run.revision + 1,
        }),
      };
    });
    return recorded!;
  }

  async claimNext(
    workerId: string,
    now: Date,
    leaseMs: number,
  ): Promise<JobClaim | null> {
    const rows = await this.db
      .prepare(
        "SELECT run_id FROM self_development_runs WHERE state IN ('created','workspace_ready','implementing','validating','approved','committed','pushed') ORDER BY updated_at LIMIT 20",
      )
      .all<{ run_id: string }>();
    for (const row of rows.results) {
      const claimed = await this.claim(row.run_id, workerId, now, leaseMs);
      if (claimed) return claimed;
    }
    return null;
  }

  async claim(
    runId: string,
    workerId: string,
    now: Date,
    leaseMs: number,
    expectedRevision?: number,
  ): Promise<JobClaim | null> {
    if (!workerId.trim()) throw new Error("Worker ID is required");
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0)
      throw new Error("Lease duration must be a positive integer");
    return this.mutate(runId, (run) => {
      if (
        (expectedRevision !== undefined && run.revision !== expectedRevision) ||
        !claimable.has(run.state) ||
        (run.lease && Date.parse(run.lease.expiresAt) > now.getTime())
      )
        return null;
      const token = crypto.randomUUID();
      const attempts = run.attempts.map((value) =>
        value.status === "running"
          ? {
              ...value,
              status: "failed" as const,
              completedAt: now.toISOString(),
              retryable: true,
              classification: "lease_expired",
              error: "Worker lease expired before the stage completed",
            }
          : value,
      );
      const next = {
        ...run,
        attempts,
        updatedAt: now.toISOString(),
        lease: {
          token,
          workerId,
          acquiredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        },
      };
      return {
        run: next,
        result: {
          run: selfDevelopmentRunSchema.parse({
            ...next,
            revision: run.revision + 1,
          }),
          token,
        },
      };
    });
  }

  private assertLease(
    run: SelfDevelopmentRun,
    token: string,
    now?: Date,
  ): void {
    if (!run.lease || run.lease.token !== token)
      throw new Error("Run lease does not match");
    if (now && Date.parse(run.lease.expiresAt) <= now.getTime())
      throw new Error("Run lease has expired");
  }

  async renew(
    runId: string,
    token: string,
    now: Date,
    leaseMs: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0)
      throw new Error("Lease duration must be a positive integer");
    await this.mutate(runId, (run) => {
      this.assertLease(run, token, now);
      return {
        run: {
          ...run,
          updatedAt: now.toISOString(),
          lease: {
            ...run.lease!,
            expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
          },
        },
        result: undefined,
      };
    });
  }

  async release(runId: string, token: string, now: Date): Promise<void> {
    await this.mutate(runId, (run) => {
      this.assertLease(run, token);
      const { lease: _lease, ...rest } = run;
      return {
        run: { ...rest, updatedAt: now.toISOString() } as SelfDevelopmentRun,
        result: undefined,
      };
    });
  }

  async startAttempt(
    runId: string,
    token: string,
    stage: JobStage,
    now: Date,
  ): Promise<SelfDevelopmentRun> {
    return (await this.mutate(runId, (run) => {
      this.assertLease(run, token, now);
      const number =
        run.attempts.filter((value) => value.stage === stage).length + 1;
      const next = {
        ...run,
        state: stage === "implement" ? ("implementing" as const) : run.state,
        updatedAt: now.toISOString(),
        attempts: [
          ...run.attempts,
          {
            attemptId: `${runId}-${stage}-${number}`,
            stage,
            number,
            status: "running" as const,
            startedAt: now.toISOString(),
          },
        ],
      };
      return {
        run: next,
        result: selfDevelopmentRunSchema.parse({
          ...next,
          revision: run.revision + 1,
        }),
      };
    }))!;
  }

  async completeAttempt(
    runId: string,
    token: string,
    stage: JobStage,
    state: SelfDevelopmentRunState,
    detail: Record<string, unknown>,
    updates: RunUpdates,
    now: Date,
  ): Promise<SelfDevelopmentRun> {
    return (await this.mutate(runId, (run) => {
      this.assertLease(run, token, now);
      const attempts = run.attempts.map((value, index) =>
        index === run.attempts.length - 1 &&
        value.stage === stage &&
        value.status === "running"
          ? {
              ...value,
              status: "succeeded" as const,
              completedAt: now.toISOString(),
            }
          : value,
      );
      const { evidence, ...otherUpdates } = updates;
      const next = {
        ...run,
        ...otherUpdates,
        evidence: evidence ? [...run.evidence, ...evidence] : run.evidence,
        state,
        updatedAt: now.toISOString(),
        attempts,
        events: [
          ...run.events,
          {
            sequence: run.events.length + 1,
            type: `${stage}.completed`,
            state,
            occurredAt: now.toISOString(),
            detail,
          },
        ],
      };
      return {
        run: next,
        result: selfDevelopmentRunSchema.parse({
          ...next,
          revision: run.revision + 1,
        }),
      };
    }))!;
  }

  async failAttempt(
    runId: string,
    token: string,
    stage: JobStage,
    failure: AttemptFailure,
    terminal: boolean,
    now: Date,
  ): Promise<SelfDevelopmentRun> {
    return (await this.mutate(runId, (run) => {
      this.assertLease(run, token, now);
      const state = terminal ? "failed" : recovery[stage];
      const { evidence, ...attemptFailure } = failure;
      const attempts = run.attempts.map((value, index) =>
        index === run.attempts.length - 1 &&
        value.stage === stage &&
        value.status === "running"
          ? {
              ...value,
              status: "failed" as const,
              completedAt: now.toISOString(),
              ...attemptFailure,
            }
          : value,
      );
      const next = {
        ...run,
        state,
        updatedAt: now.toISOString(),
        attempts,
        evidence: evidence ? [...run.evidence, ...evidence] : run.evidence,
        events: [
          ...run.events,
          {
            sequence: run.events.length + 1,
            type: `${stage}.failed`,
            state,
            occurredAt: now.toISOString(),
            detail: attemptFailure,
          },
        ],
      };
      return {
        run: next,
        result: selfDevelopmentRunSchema.parse({
          ...next,
          revision: run.revision + 1,
        }),
      };
    }))!;
  }
}
