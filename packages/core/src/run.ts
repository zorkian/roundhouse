// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { AppliedProfile } from "./profile.js";

export const runSchemaVersion = 2 as const;

export const runStatuses = [
  "active",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export const runStages = [
  "qualify",
  "reproduce",
  "plan",
  "implement",
  "validate",
  "review",
  "integrate",
  "publish",
  "ci",
  "merge",
] as const;

export const waitingReasons = [
  "clarification",
  "plan_approval",
  "final_approval",
  "maintainer_judgment",
  "budget",
  "external_check",
  "maintainer_merge",
  "retry_exhausted",
  "profile_error",
  "checkpoint_rejected",
  "branch_changed",
  "execution_interrupted",
] as const;

export type RunStatus = (typeof runStatuses)[number];
export type RunStage = (typeof runStages)[number];
export type WaitingReason = (typeof waitingReasons)[number];
export type RunResumeSignal =
  | {
      readonly kind: "human";
      readonly reason: WaitingReason;
      readonly actor: string;
      readonly body: string;
      readonly url?: string;
    }
  | {
      readonly kind: "external";
      readonly adapter: string;
      readonly event: string;
      readonly actor: string;
      readonly payload: Readonly<Record<string, unknown>>;
    };

export interface RunSnapshot {
  readonly schemaVersion: typeof runSchemaVersion;
  readonly id: string;
  readonly repository: string;
  readonly githubRepositoryId?: number;
  readonly githubInstallationId?: number;
  readonly githubDefaultBranch?: string;
  readonly issueNumber: number;
  readonly baseCommit: string;
  readonly currentHead: string;
  readonly candidateHead?: string;
  readonly reviewedHead?: string;
  readonly targetBaseHead?: string;
  readonly integrationHead?: string;
  readonly profileVersion: string;
  readonly profile?: AppliedProfile;
  readonly profileError?: string;
  readonly workflowHash?: string;
  readonly currentNodeId?: string;
  readonly status: RunStatus;
  readonly stage: RunStage;
  readonly revision: number;
  readonly waitingReason?: WaitingReason;
  readonly resumeSignal?: RunResumeSignal;
  readonly issue?: IssueSnapshot;
}

export interface IssueSnapshot {
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly actor: string;
  readonly clarifications?: readonly IssueCommentSnapshot[];
}

export interface IssueCommentSnapshot {
  readonly actor: string;
  readonly body: string;
  readonly url?: string;
}

export interface CreateRunInput {
  readonly id: string;
  readonly repository: string;
  readonly githubRepositoryId?: number;
  readonly githubInstallationId?: number;
  readonly githubDefaultBranch?: string;
  readonly issueNumber: number;
  readonly baseCommit: string;
  readonly profileVersion: string;
  readonly profile?: AppliedProfile;
  readonly profileError?: string;
  readonly issue?: IssueSnapshot;
}

export interface RunTransition {
  readonly status: RunStatus;
  readonly stage: RunStage;
  readonly currentNodeId?: string;
  readonly waitingReason?: WaitingReason;
  readonly acceptedHead?: string;
  // Identity heads may be set to a commit or explicitly cleared with null
  // (for example, superseding an integration when the target base moves).
  readonly heads?: Partial<
    Record<
      "candidateHead" | "reviewedHead" | "targetBaseHead" | "integrationHead",
      string | null
    >
  >;
}

const terminalStatuses = new Set<RunStatus>([
  "succeeded",
  "failed",
  "cancelled",
]);

function assertCreateInput(input: CreateRunInput): void {
  if (!/^run_[a-z0-9][a-z0-9_-]{0,119}$/.test(input.id))
    throw new Error("invalid_run_id");
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository) ||
    input.repository.length > 200
  )
    throw new Error("invalid_repository");
  for (const value of [input.githubRepositoryId, input.githubInstallationId]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
      throw new Error("invalid_github_identity");
  }
  if (
    input.githubDefaultBranch !== undefined &&
    !/^[A-Za-z0-9._\/-]+$/.test(input.githubDefaultBranch)
  )
    throw new Error("invalid_github_default_branch");
  if (!Number.isInteger(input.issueNumber) || input.issueNumber < 1)
    throw new Error("invalid_issue_number");
  if (!/^[a-f0-9]{40}$/.test(input.baseCommit))
    throw new Error("invalid_base_commit");
  if (
    input.profileVersion.length < 1 ||
    input.profileVersion.length > 100 ||
    !/^[A-Za-z0-9._-]+$/.test(input.profileVersion)
  )
    throw new Error("invalid_profile_version");
}

export function createRun(input: CreateRunInput): RunSnapshot {
  assertCreateInput(input);
  const workflow = input.profile?.workflow;
  return {
    schemaVersion: runSchemaVersion,
    ...input,
    currentHead: input.baseCommit,
    status: "active",
    stage: "qualify",
    ...(workflow
      ? {
          workflowHash: workflow.hash,
          currentNodeId: workflow.triggers["github.issue.started"],
        }
      : {}),
    revision: 1,
  };
}

function assertTransition(transition: RunTransition): void {
  if (
    transition.currentNodeId !== undefined &&
    !/^[a-z][a-z0-9-]{0,63}$/.test(transition.currentNodeId)
  )
    throw new Error("invalid_current_node_id");
  if (transition.status === "waiting" && !transition.waitingReason)
    throw new Error("waiting_reason_required");
  if (transition.status !== "waiting" && transition.waitingReason)
    throw new Error("waiting_reason_not_allowed");
  if (
    transition.acceptedHead &&
    !/^[a-f0-9]{40}$/.test(transition.acceptedHead)
  )
    throw new Error("invalid_accepted_head");
  for (const value of Object.values(transition.heads ?? {}))
    if (value !== null && !/^[a-f0-9]{40}$/.test(value))
      throw new Error("invalid_identity_head");
}

export function transitionRun(
  run: RunSnapshot,
  expectedRevision: number,
  transition: RunTransition,
): RunSnapshot {
  if (run.revision !== expectedRevision) throw new Error("stale_run_revision");
  if (terminalStatuses.has(run.status)) throw new Error("run_is_terminal");
  assertTransition(transition);

  const {
    waitingReason: _waitingReason,
    resumeSignal: _resumeSignal,
    ...current
  } = run;
  const { acceptedHead, heads, ...nextTransition } = transition;
  const next: RunSnapshot = {
    ...current,
    ...nextTransition,
    currentHead: acceptedHead ?? current.currentHead,
    revision: run.revision + 1,
  };
  const mutable = next as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(heads ?? {})) {
    if (value === null) delete mutable[key];
    else mutable[key] = value;
  }
  return next;
}

export function resumeRun(
  run: RunSnapshot,
  expectedRevision: number,
  issue: IssueSnapshot,
  profile?: AppliedProfile,
  continuationHead?: string,
  signal?: RunResumeSignal,
): RunSnapshot {
  if (run.revision !== expectedRevision) throw new Error("stale_run_revision");
  const completedWork =
    run.status === "succeeded" &&
    (run.stage === "merge" || run.stage === "implement");
  const resumable =
    run.status === "waiting" ||
    run.status === "cancelled" ||
    (run.status === "succeeded" &&
      (run.stage === "qualify" ||
        run.stage === "merge" ||
        run.stage === "implement"));
  if (!resumable) throw new Error("run_not_resumable");
  if (completedWork && !continuationHead)
    throw new Error("resume_head_required");
  if (
    (!run.profile && !profile) ||
    (run.waitingReason === "profile_error" && !profile)
  )
    throw new Error("resume_profile_required");
  const activeProfile = profile ?? run.profile;
  if (
    run.currentNodeId &&
    activeProfile?.workflow &&
    !activeProfile.workflow.nodes[run.currentNodeId]
  )
    throw new Error("resume_workflow_node_missing");
  const {
    waitingReason: _waitingReason,
    resumeSignal: _resumeSignal,
    candidateHead,
    reviewedHead,
    targetBaseHead,
    integrationHead,
    ...withoutContinuationHeads
  } = run;
  const current = completedWork
    ? withoutContinuationHeads
    : {
        ...withoutContinuationHeads,
        ...(candidateHead ? { candidateHead } : {}),
        ...(reviewedHead ? { reviewedHead } : {}),
        ...(targetBaseHead ? { targetBaseHead } : {}),
        ...(integrationHead ? { integrationHead } : {}),
      };
  const resumed: RunSnapshot = {
    ...current,
    ...(completedWork && continuationHead
      ? { baseCommit: continuationHead, currentHead: continuationHead }
      : {}),
    status: "active",
    stage: completedWork ? "implement" : run.stage,
    ...(completedWork && run.profile?.workflow
      ? {
          currentNodeId: "implement",
          workflowHash: run.profile.workflow.hash,
        }
      : {}),
    ...(!completedWork && activeProfile?.workflow
      ? { workflowHash: activeProfile.workflow.hash }
      : {}),
    revision: run.revision + 1,
    issue,
    ...(signal ? { resumeSignal: signal } : {}),
  };
  if (!profile) return resumed;
  const { profileError: _profileError, ...withValidProfile } = resumed;
  return {
    ...withValidProfile,
    profile,
    profileVersion: profile.hash,
  };
}
