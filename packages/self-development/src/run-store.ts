// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  selfDevelopmentRunSchema,
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
import type { JobStage } from "./task.js";

const transitions: Record<
  SelfDevelopmentRunState,
  readonly SelfDevelopmentRunState[]
> = {
  created: ["workspace_ready", "failed", "cancelled"],
  workspace_ready: ["implementing", "failed", "cancelled"],
  implementing: ["validating", "failed", "cancelled"],
  validating: ["awaiting_approval", "failed", "cancelled"],
  awaiting_approval: ["approved", "cancelled"],
  approved: ["committed", "cancelled"],
  committed: ["pushed", "failed"],
  pushed: ["completed", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

const claimableStates: SelfDevelopmentRunState[] = [
  "created",
  "workspace_ready",
  "implementing",
  "validating",
  "approved",
  "committed",
  "pushed",
];

const recoveryState: Record<JobStage, SelfDevelopmentRunState> = {
  prepare: "created",
  implement: "workspace_ready",
  validate: "validating",
  commit: "approved",
  push: "committed",
  complete: "pushed",
};
const staleMutexMs = 30_000;

export class FileRunStore implements JobStore {
  constructor(private readonly root: string) {}

  private path(runId: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(runId))
      throw new Error("Invalid run ID");
    return join(this.root, "runs", runId, "run.json");
  }

  private async write(run: SelfDevelopmentRun): Promise<void> {
    const path = this.path(run.runId);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  }

  private async locked<T>(
    runId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lock = join(dirname(this.path(runId)), ".mutex");
    await mkdir(dirname(lock), { recursive: true, mode: 0o700 });
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      )
        throw error;
      const lockStat = await stat(lock);
      if (Date.now() - lockStat.mtimeMs <= staleMutexMs)
        throw new Error(`Run is concurrently modified: ${runId}`);
      await rm(lock, { recursive: true, force: true });
      try {
        await mkdir(lock, { mode: 0o700 });
      } catch {
        throw new Error(`Run is concurrently modified: ${runId}`);
      }
    }
    try {
      return await operation();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }

  private async replace(run: SelfDevelopmentRun): Promise<SelfDevelopmentRun> {
    const updated = selfDevelopmentRunSchema.parse({
      ...run,
      revision: run.revision + 1,
    });
    await this.write(updated);
    return updated;
  }

  async create(
    runId: string,
    task: SelfDevelopmentTask,
    now = new Date().toISOString(),
  ): Promise<SelfDevelopmentRun> {
    const run = selfDevelopmentRunSchema.parse({
      schemaVersion: 1,
      runId,
      task,
      state: "created",
      createdAt: now,
      updatedAt: now,
      events: [
        {
          sequence: 1,
          type: "run.created",
          state: "created",
          occurredAt: now,
          detail: {},
        },
      ],
    });
    try {
      await readFile(this.path(runId), "utf8");
      throw new Error(`Run already exists: ${runId}`);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
    }
    await this.write(run);
    return run;
  }

  async submit(
    runId: string,
    task: SelfDevelopmentTask,
    now: Date,
  ): Promise<void> {
    await this.create(runId, task, now.toISOString());
  }

  async read(runId: string): Promise<SelfDevelopmentRun> {
    return selfDevelopmentRunSchema.parse(
      JSON.parse(await readFile(this.path(runId), "utf8")),
    );
  }

  async transition(
    runId: string,
    state: SelfDevelopmentRunState,
    type: string,
    detail: Record<string, unknown> = {},
    updates: RunUpdates = {},
    now = new Date().toISOString(),
  ): Promise<SelfDevelopmentRun> {
    return this.locked(runId, async () => {
      const current = await this.read(runId);
      if (!(transitions[current.state] ?? []).includes(state))
        throw new Error(`Invalid run transition: ${current.state} -> ${state}`);
      const run = selfDevelopmentRunSchema.parse({
        ...current,
        ...updates,
        revision: current.revision + 1,
        state,
        updatedAt: now,
        events: [
          ...current.events,
          {
            sequence: current.events.length + 1,
            type,
            state,
            occurredAt: now,
            detail,
          },
        ],
      });
      await this.write(run);
      return run;
    });
  }

  async claimNext(
    workerId: string,
    now: Date,
    leaseMs: number,
  ): Promise<JobClaim | null> {
    if (!workerId.trim()) throw new Error("Worker ID is required");
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0)
      throw new Error("Lease duration must be a positive integer");
    const runsRoot = join(this.root, "runs");
    let entries: string[];
    try {
      entries = (await readdir(runsRoot)).sort();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return null;
      throw error;
    }
    for (const runId of entries) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(runId)) continue;
      const claimed = await this.claim(runId, workerId, now, leaseMs);
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
    try {
      return await this.locked(runId, async () => {
        const run = await this.read(runId);
        if (expectedRevision !== undefined && run.revision !== expectedRevision)
          return null;
        if (!claimableStates.includes(run.state)) return null;
        if (run.lease && Date.parse(run.lease.expiresAt) > now.getTime())
          return null;
        const attempts = run.attempts.map((attempt) =>
          attempt.status === "running"
            ? {
                ...attempt,
                status: "failed" as const,
                completedAt: now.toISOString(),
                retryable: true,
                classification: "lease_expired",
                error: "Worker lease expired before the stage completed",
              }
            : attempt,
        );
        const token = randomUUID();
        const updated = await this.replace({
          ...run,
          attempts,
          updatedAt: now.toISOString(),
          lease: {
            token,
            workerId,
            acquiredAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
          },
        });
        return { run: updated, token };
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Run is concurrently modified:")
      )
        return null;
      throw error;
    }
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
    await this.locked(runId, async () => {
      const run = await this.read(runId);
      this.assertLease(run, token, now);
      await this.replace({
        ...run,
        updatedAt: now.toISOString(),
        lease: {
          ...run.lease!,
          expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        },
      });
    });
  }

  async release(runId: string, token: string, now: Date): Promise<void> {
    await this.locked(runId, async () => {
      const run = await this.read(runId);
      this.assertLease(run, token);
      const { lease: _lease, ...withoutLease } = run;
      await this.replace({
        ...(withoutLease as SelfDevelopmentRun),
        updatedAt: now.toISOString(),
      });
    });
  }

  async startAttempt(
    runId: string,
    token: string,
    stage: JobStage,
    now: Date,
  ): Promise<SelfDevelopmentRun> {
    return this.locked(runId, async () => {
      const run = await this.read(runId);
      this.assertLease(run, token, now);
      const number =
        run.attempts.filter((attempt) => attempt.stage === stage).length + 1;
      return this.replace({
        ...run,
        state: stage === "implement" ? "implementing" : run.state,
        updatedAt: now.toISOString(),
        attempts: [
          ...run.attempts,
          {
            attemptId: `${runId}-${stage}-${number}`,
            stage,
            number,
            status: "running",
            startedAt: now.toISOString(),
          },
        ],
      });
    });
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
    return this.locked(runId, async () => {
      const run = await this.read(runId);
      this.assertLease(run, token, now);
      const attempts = run.attempts.map((attempt, index) =>
        index === run.attempts.length - 1 &&
        attempt.stage === stage &&
        attempt.status === "running"
          ? {
              ...attempt,
              status: "succeeded" as const,
              completedAt: now.toISOString(),
            }
          : attempt,
      );
      return this.replace({
        ...run,
        ...updates,
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
      });
    });
  }

  async failAttempt(
    runId: string,
    token: string,
    stage: JobStage,
    failure: AttemptFailure,
    terminal: boolean,
    now: Date,
  ): Promise<SelfDevelopmentRun> {
    return this.locked(runId, async () => {
      const run = await this.read(runId);
      this.assertLease(run, token, now);
      const state = terminal ? "failed" : recoveryState[stage];
      const attempts = run.attempts.map((attempt, index) =>
        index === run.attempts.length - 1 &&
        attempt.stage === stage &&
        attempt.status === "running"
          ? {
              ...attempt,
              status: "failed" as const,
              completedAt: now.toISOString(),
              ...failure,
            }
          : attempt,
      );
      return this.replace({
        ...run,
        state,
        updatedAt: now.toISOString(),
        attempts,
        events: [
          ...run.events,
          {
            sequence: run.events.length + 1,
            type: `${stage}.failed`,
            state,
            occurredAt: now.toISOString(),
            detail: failure,
          },
        ],
      });
    });
  }
}
