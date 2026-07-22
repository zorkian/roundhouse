// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { Attempt, Lease, RunRepository, Wakeup } from "./contracts.js";
import type { AppliedProfile } from "./profile.js";
import type { IssueSnapshot, RunSnapshot, RunStage } from "./run.js";
import { resumeRun, transitionRun, type RunTransition } from "./run.js";

export class MemoryRunRepository implements RunRepository {
  readonly runs = new Map<string, RunSnapshot>();
  readonly attempts = new Map<string, Attempt>();
  readonly leases = new Map<string, Lease>();

  async create(run: RunSnapshot): Promise<void> {
    if (this.runs.has(run.id)) throw new Error("run_exists");
    this.runs.set(run.id, run);
  }

  async get(runId: string): Promise<RunSnapshot | undefined> {
    return this.runs.get(runId);
  }

  async transition(
    runId: string,
    expectedRevision: number,
    transition: RunTransition,
  ): Promise<RunSnapshot | undefined> {
    const run = this.runs.get(runId);
    if (!run || run.revision !== expectedRevision) return undefined;
    const next = transitionRun(run, expectedRevision, transition);
    this.runs.set(runId, next);
    this.leases.delete(runId);
    return next;
  }

  async resume(
    runId: string,
    expectedRevision: number,
    issue: IssueSnapshot,
    profile?: AppliedProfile,
  ): Promise<RunSnapshot | undefined> {
    const run = this.runs.get(runId);
    if (!run || run.revision !== expectedRevision) return undefined;
    const next = resumeRun(run, expectedRevision, issue, profile);
    this.runs.set(runId, next);
    this.leases.delete(runId);
    return next;
  }

  async claimLease(
    runId: string,
    expectedRevision: number,
    lease: Lease,
    now: number,
  ): Promise<boolean> {
    const run = this.runs.get(runId);
    const current = this.leases.get(runId);
    if (!run || run.revision !== expectedRevision || run.status !== "active")
      return false;
    if (current && current.expiresAt > now) return false;
    this.leases.set(runId, lease);
    return true;
  }

  async releaseLease(
    runId: string,
    expectedRevision: number,
    attemptId: string,
  ): Promise<boolean> {
    const lease = this.leases.get(runId);
    if (
      !lease ||
      lease.runRevision !== expectedRevision ||
      lease.attemptId !== attemptId
    )
      return false;
    this.leases.delete(runId);
    return true;
  }

  async createAttempt(attempt: Attempt): Promise<"created" | "exists"> {
    const existing = this.attempts.get(attempt.id);
    if (existing) {
      if (existing.state !== "completed")
        this.attempts.set(attempt.id, {
          ...existing,
          state: "created",
          deadlineAt: attempt.deadlineAt,
        });
      return "exists";
    }
    this.attempts.set(attempt.id, attempt);
    return "created";
  }

  async markDispatched(attemptId: string): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) throw new Error("attempt_not_found");
    if (attempt.state === "created")
      this.attempts.set(attemptId, { ...attempt, state: "dispatched" });
  }

  async completeAttempt(
    attemptId: string,
    expectedRevision: number,
    acceptedHead: string,
    result: Readonly<Record<string, unknown>>,
  ): Promise<"completed" | "duplicate" | "stale"> {
    const attempt = this.attempts.get(attemptId);
    const run = attempt && this.runs.get(attempt.runId);
    if (!attempt) return "stale";
    if (attempt.state === "completed") return "duplicate";
    if (attempt.state === "failed") return "stale";
    if (
      !run ||
      run.revision !== expectedRevision ||
      attempt.runRevision !== expectedRevision
    )
      return "stale";
    this.attempts.set(attemptId, {
      ...attempt,
      state: "completed",
      acceptedHead,
      result,
    });
    this.leases.delete(attempt.runId);
    return "completed";
  }

  async failAttempt(
    attemptId: string,
    expectedRevision: number,
    result: Readonly<Record<string, unknown>>,
  ): Promise<"failed" | "duplicate" | "stale"> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.runRevision !== expectedRevision) return "stale";
    if (attempt.state === "failed") return "duplicate";
    if (attempt.state === "completed") return "stale";
    this.attempts.set(attemptId, { ...attempt, state: "failed", result });
    return "failed";
  }

  async getAttempt(attemptId: string): Promise<Attempt | undefined> {
    return this.attempts.get(attemptId);
  }

  async latestCompletedAttempt(
    runId: string,
    stage: RunStage,
    beforeRevision: number,
  ): Promise<Attempt | undefined> {
    return [...this.attempts.values()]
      .filter(
        (attempt) =>
          attempt.runId === runId &&
          attempt.stage === stage &&
          attempt.state === "completed" &&
          attempt.runRevision < beforeRevision,
      )
      .sort((left, right) => right.runRevision - left.runRevision)[0];
  }

  async consumedCiEvidence(
    runId: string,
    evidenceKey: string,
    beforeRevision: number,
  ): Promise<boolean> {
    return [...this.attempts.values()].some((attempt) => {
      if (
        attempt.runId !== runId ||
        attempt.stage !== "ci" ||
        attempt.state !== "completed" ||
        attempt.runRevision >= beforeRevision
      )
        return false;
      const diagnostics = (
        attempt.result?.ci as Record<string, unknown> | undefined
      )?.diagnostics as Record<string, unknown> | undefined;
      return diagnostics?.evidenceKey === evidenceKey;
    });
  }

  async attemptsForRevision(runId: string, revision: number) {
    return [...this.attempts.values()].filter(
      (attempt) => attempt.runId === runId && attempt.runRevision === revision,
    );
  }

  async expiredLeases(now: number): Promise<readonly Wakeup[]> {
    return [...this.leases.entries()].flatMap(([runId, lease]) =>
      lease.expiresAt <= now &&
      new Set([
        "qualify",
        "reproduce",
        "plan",
        "implement",
        "review",
        "merge",
      ]).has(this.runs.get(runId)?.stage ?? "")
        ? [{ runId, expectedRevision: lease.runRevision }]
        : [],
    );
  }
}
