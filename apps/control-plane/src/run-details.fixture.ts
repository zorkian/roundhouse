// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { RunDetails } from "./d1-store.js";
import { renderRunDetails } from "./run-details.js";

// Used for repeatable visual checks of the run-details presentation.
export function completedRunDetailsFixture(): RunDetails {
  return {
    run: {
      schemaVersion: 2,
      id: "run_visual_fixture",
      repository: "zorkian/roundhouse",
      issueNumber: 486,
      baseCommit: "a".repeat(40),
      currentHead: "b".repeat(40),
      profileVersion: "test",
      status: "succeeded",
      stage: "merge",
      revision: 2,
      issue: {
        title:
          "Replace top-level run outcome JSON with a human-friendly summary",
        body: "",
        url: "https://github.com/zorkian/roundhouse/issues/486",
        actor: "zorkian",
      },
    },
    createdAt: Date.UTC(2026, 0, 1, 12),
    updatedAt: Date.UTC(2026, 0, 1, 12, 3),
    attempts: [
      {
        id: "implementation",
        runId: "run_visual_fixture",
        runRevision: 1,
        kind: "agent",
        stage: "implement",
        role: "implement",
        state: "completed",
        deadlineAt: Date.UTC(2026, 0, 1, 12, 10),
        baseCommit: "a".repeat(40),
        expectedHead: "a".repeat(40),
        acceptedHead: "b".repeat(40),
        createdAt: Date.UTC(2026, 0, 1, 12),
        updatedAt: Date.UTC(2026, 0, 1, 12, 2),
        result: {
          implementation: {
            summary:
              "Implemented the run-details summary and opened a pull request.",
            pullRequest: {
              number: 486,
              html_url: "https://github.com/zorkian/roundhouse/pull/486",
            },
          },
        },
      },
      {
        id: "merge",
        runId: "run_visual_fixture",
        runRevision: 2,
        kind: "external",
        stage: "merge",
        role: "github-merge",
        state: "completed",
        deadlineAt: Date.UTC(2026, 0, 1, 12, 10),
        baseCommit: "b".repeat(40),
        expectedHead: "b".repeat(40),
        acceptedHead: "b".repeat(40),
        createdAt: Date.UTC(2026, 0, 1, 12, 2),
        updatedAt: Date.UTC(2026, 0, 1, 12, 3),
        result: {
          merge: {
            summary: "Pull request merged successfully.",
            mergedAt: "2026-01-01T12:03:00.000Z",
          },
        },
      },
    ],
  };
}

export function renderCompletedRunDetailsFixture(): string {
  return renderRunDetails(completedRunDetailsFixture());
}
