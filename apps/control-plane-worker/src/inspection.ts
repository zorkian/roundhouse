// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { SelfDevelopmentRun } from "@roundhouse/self-development/cloudflare";

export function inspectRun(run: SelfDevelopmentRun): Record<string, unknown> {
  return {
    schemaVersion: 1,
    runId: run.runId,
    taskId: run.task.taskId,
    state: run.state,
    revision: run.revision,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    commit: run.commit,
    attempts: run.attempts.map((attempt) => ({
      stage: attempt.stage,
      number: attempt.number,
      status: attempt.status,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      retryable: attempt.retryable,
      classification: attempt.classification,
    })),
    events: run.events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      state: event.state,
      occurredAt: event.occurredAt,
    })),
  };
}
