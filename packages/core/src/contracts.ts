// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { RunSnapshot, RunStage, RunTransition } from "./run.js";

export const attemptKinds = ["agent", "external"] as const;
export const attemptStates = [
  "created",
  "dispatched",
  "completed",
  "failed",
] as const;
export const approvalPurposes = ["plan", "final"] as const;
export const riskLevels = ["low", "medium", "high"] as const;
export const externalOperationKinds = ["queue", "github", "container"] as const;

export type AttemptKind = (typeof attemptKinds)[number];
export type AttemptState = (typeof attemptStates)[number];
export type ApprovalPurpose = (typeof approvalPurposes)[number];
export type RiskLevel = (typeof riskLevels)[number];
export type ExternalOperationKind = (typeof externalOperationKinds)[number];

export interface Lease {
  readonly attemptId: string;
  readonly runRevision: number;
  readonly expiresAt: number;
}

export interface Attempt {
  readonly id: string;
  readonly runId: string;
  readonly runRevision: number;
  readonly kind: AttemptKind;
  readonly stage: RunStage;
  readonly role: string;
  readonly state: AttemptState;
  readonly deadlineAt: number;
  readonly baseCommit: string;
  readonly expectedHead: string;
  readonly acceptedHead?: string;
  readonly result?: Readonly<Record<string, unknown>>;
}

export interface Approval {
  readonly id: string;
  readonly runId: string;
  readonly runRevision: number;
  readonly purpose: ApprovalPurpose;
  readonly actor: string;
  readonly decision: "approved" | "rejected";
  readonly boundHead?: string;
}

export interface Reviewer {
  readonly role: string;
  readonly label: string;
  readonly provider: string;
  readonly model: string;
  readonly blockingSeverities: readonly string[];
}

export interface RiskAssessment {
  readonly level: RiskLevel;
  readonly deterministicFloor: RiskLevel;
  readonly signals: readonly string[];
  readonly explanation: string;
}

export interface ExternalOperation {
  readonly id: string;
  readonly runId: string;
  readonly kind: ExternalOperationKind;
  readonly state: "pending" | "completed" | "ambiguous";
}

export interface Wakeup {
  readonly runId: string;
  readonly expectedRevision: number;
}

export interface RunRepository {
  create(run: RunSnapshot): Promise<void>;
  get(runId: string): Promise<RunSnapshot | undefined>;
  transition(
    runId: string,
    expectedRevision: number,
    transition: RunTransition,
  ): Promise<RunSnapshot | undefined>;
  claimLease(
    runId: string,
    expectedRevision: number,
    lease: Lease,
    now: number,
  ): Promise<boolean>;
  createAttempt(attempt: Attempt): Promise<"created" | "exists">;
  markDispatched(attemptId: string): Promise<void>;
  completeAttempt(
    attemptId: string,
    expectedRevision: number,
    acceptedHead: string,
    result: Readonly<Record<string, unknown>>,
  ): Promise<"completed" | "duplicate" | "stale">;
  getAttempt(attemptId: string): Promise<Attempt | undefined>;
  expiredLeases(now: number): Promise<readonly Wakeup[]>;
}

export function immutableAttemptId(runId: string, revision: number): string {
  return `${runId}_rev_${revision}`;
}
