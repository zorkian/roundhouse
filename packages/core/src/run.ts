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
  "retry_exhausted",
  "profile_error",
] as const;

export type RunStatus = (typeof runStatuses)[number];
export type RunStage = (typeof runStages)[number];
export type WaitingReason = (typeof waitingReasons)[number];

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
  readonly profileVersion: string;
  readonly profile?: AppliedProfile;
  readonly profileError?: string;
  readonly status: RunStatus;
  readonly stage: RunStage;
  readonly revision: number;
  readonly waitingReason?: WaitingReason;
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
  readonly waitingReason?: WaitingReason;
  readonly acceptedHead?: string;
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
  return {
    schemaVersion: runSchemaVersion,
    ...input,
    currentHead: input.baseCommit,
    status: "active",
    stage: "qualify",
    revision: 1,
  };
}

function assertTransition(transition: RunTransition): void {
  if (transition.status === "waiting" && !transition.waitingReason)
    throw new Error("waiting_reason_required");
  if (transition.status !== "waiting" && transition.waitingReason)
    throw new Error("waiting_reason_not_allowed");
  if (
    transition.acceptedHead &&
    !/^[a-f0-9]{40}$/.test(transition.acceptedHead)
  )
    throw new Error("invalid_accepted_head");
}

export function transitionRun(
  run: RunSnapshot,
  expectedRevision: number,
  transition: RunTransition,
): RunSnapshot {
  if (run.revision !== expectedRevision) throw new Error("stale_run_revision");
  if (terminalStatuses.has(run.status)) throw new Error("run_is_terminal");
  assertTransition(transition);

  const { waitingReason: _waitingReason, ...current } = run;
  const { acceptedHead, ...nextTransition } = transition;
  return {
    ...current,
    ...nextTransition,
    currentHead: acceptedHead ?? current.currentHead,
    revision: run.revision + 1,
  };
}

export function resumeRun(
  run: RunSnapshot,
  expectedRevision: number,
  issue: IssueSnapshot,
  profile?: AppliedProfile,
): RunSnapshot {
  if (run.revision !== expectedRevision) throw new Error("stale_run_revision");
  const resumable =
    run.status === "waiting" ||
    (run.status === "succeeded" && run.stage === "qualify");
  if (!resumable) throw new Error("run_not_resumable");
  if (
    (!run.profile && !profile) ||
    (run.waitingReason === "profile_error" && !profile)
  )
    throw new Error("resume_profile_required");
  const { waitingReason: _waitingReason, ...current } = run;
  const resumed: RunSnapshot = {
    ...current,
    status: "active",
    stage: run.stage,
    revision: run.revision + 1,
    issue,
  };
  if (!profile) return resumed;
  const { profileError: _profileError, ...withValidProfile } = resumed;
  return {
    ...withValidProfile,
    profile,
    profileVersion: profile.hash,
  };
}
