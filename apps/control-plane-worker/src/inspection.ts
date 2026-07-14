// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { SelfDevelopmentRun } from "@roundhouse/self-development/cloudflare";

export function inspectRun(run: SelfDevelopmentRun): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runId: run.runId,
    taskId: run.task.taskId,
    subject: run.task.subject,
    baseCommit: run.task.baseCommit,
    planning: run.task.planning,
    source: run.task.source,
    state: run.state,
    revision: run.revision,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    commit: run.commit,
    implementation: run.implementation,
    approval: run.approval
      ? {
          runId: run.approval.runId,
          baseCommit: run.approval.baseCommit,
          patchSha256: run.approval.patchSha256,
          evidence: run.approval.evidence,
          approver: run.approval.approver,
          approvedAt: run.approval.approvedAt,
        }
      : undefined,
    publication: run.publication,
    attempts: run.attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      stage: attempt.stage,
      number: attempt.number,
      status: attempt.status,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      retryable: attempt.retryable,
      classification: attempt.classification,
      error:
        attempt.classification === "validation_failed"
          ? attempt.error
          : undefined,
    })),
    evidence: run.evidence.map((item) => ({
      evidenceId: item.evidenceId,
      attemptId: item.attemptId,
      objectKey: item.objectKey,
      sha256: item.sha256,
      size: item.size,
      mediaType: item.mediaType,
      approvalEligible: item.approvalEligible !== false,
      createdAt: item.createdAt,
    })),
    events: run.events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      state: event.state,
      occurredAt: event.occurredAt,
    })),
  };
}
