// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type {
  IssueSnapshot,
  RunSnapshot,
  RunStage,
  RunTransition,
} from "./run.js";

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
  readonly routing?: ModelRoute;
}

export const modelProtocols = [
  "openai-responses",
  "openai-completions",
  "anthropic-messages",
  "google-generative-ai",
] as const;

export type ModelProtocol = (typeof modelProtocols)[number];

export const modelThinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
] as const;

export interface ModelRoute {
  readonly provider: string;
  readonly model: string;
  readonly protocol: ModelProtocol;
  readonly thinkingLevel: (typeof modelThinkingLevels)[number];
  readonly rule: string;
}

export function isModelRoute(value: unknown): value is ModelRoute {
  if (!value || typeof value !== "object") return false;
  const route = value as Record<string, unknown>;
  return (
    typeof route.provider === "string" &&
    route.provider.length > 0 &&
    typeof route.model === "string" &&
    route.model.length > 0 &&
    modelProtocols.includes(route.protocol as ModelProtocol) &&
    modelThinkingLevels.includes(
      route.thinkingLevel as ModelRoute["thinkingLevel"],
    ) &&
    typeof route.rule === "string" &&
    route.rule.length > 0
  );
}

export function parseModelRoute(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isModelRoute(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export interface ModelUsage {
  readonly callId: string;
  readonly attemptId: string;
  readonly model: string;
  readonly provider?: string;
  readonly configuredModel?: string;
  readonly routingRule?: string;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly reasoningTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly costUsd?: number;
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
  readonly prompt: string;
}

export const reviewers = [
  {
    role: "review-holistic",
    label: "Holistic design review",
    provider: "openai",
    model: "openai/gpt-5.6-sol",
    blockingSeverities: ["critical", "high", "medium"],
    prompt:
      "Review the change holistically for design and correctness. Do not perform the specialist reviews. Select which of review-security and review-data should run, and give a rationale for each selection.",
  },
  {
    role: "review-security",
    label: "Security review",
    provider: "openai",
    model: "openai/gpt-5.6-sol",
    blockingSeverities: ["critical", "high", "medium"],
    prompt:
      "Perform a focused security review, including authorization, authentication, injection, secrets, trust boundaries, and unsafe input handling.",
  },
  {
    role: "review-data",
    label: "Data consistency review",
    provider: "openai",
    model: "openai/gpt-5.6-sol",
    blockingSeverities: ["critical", "high", "medium"],
    prompt:
      "Perform a focused review of data consistency, durability, transactions, schemas, migrations, and backward compatibility.",
  },
] as const satisfies readonly Reviewer[];

export type ReviewerRole = (typeof reviewers)[number]["role"];
export function reviewerForRole(role: string): Reviewer | undefined {
  return reviewers.find((reviewer) => reviewer.role === role);
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
  resumeClarification(
    runId: string,
    expectedRevision: number,
    issue: IssueSnapshot,
  ): Promise<RunSnapshot | undefined>;
  claimLease(
    runId: string,
    expectedRevision: number,
    lease: Lease,
    now: number,
  ): Promise<boolean>;
  releaseLease(
    runId: string,
    expectedRevision: number,
    attemptId: string,
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
  latestCompletedAttempt(
    runId: string,
    stage: RunStage,
    beforeRevision: number,
  ): Promise<Attempt | undefined>;
  attemptsForRevision(
    runId: string,
    revision: number,
  ): Promise<readonly Attempt[]>;
  expiredLeases(now: number): Promise<readonly Wakeup[]>;
}

export function immutableAttemptId(runId: string, revision: number): string {
  return `${runId}_rev_${revision}`;
}

export function reviewerAttemptId(
  runId: string,
  revision: number,
  role: ReviewerRole,
): string {
  return `${immutableAttemptId(runId, revision)}_${role}`;
}
