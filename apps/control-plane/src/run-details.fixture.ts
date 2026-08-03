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

// Used for repeatable visual checks of a holistic review and its specialists.
export function reviewRunDetailsFixture(): RunDetails {
  const candidateHead = "c".repeat(40);
  return {
    run: {
      schemaVersion: 2,
      id: "run_review_fixture",
      repository: "zorkian/roundhouse",
      issueNumber: 507,
      baseCommit: "a".repeat(40),
      currentHead: candidateHead,
      candidateHead,
      reviewedHead: candidateHead,
      profileVersion: "test",
      status: "active",
      stage: "review",
      revision: 4,
      issue: {
        title: "Improve review-phase rendering",
        body: "",
        url: "https://github.com/zorkian/roundhouse/issues/507",
        actor: "zorkian",
      },
      profile: {
        sourcePath: ".roundhouse/profile.yaml",
        sourceCommit: "d".repeat(40),
        version: 1,
        hash: "e".repeat(64),
        paths: { allowed: ["**"], protected: [] },
        workflow: {
          sourcePath: ".roundhouse/workflow.yaml",
          sourceCommit: "d".repeat(40),
          version: 1,
          hash: "f".repeat(64),
          triggers: { "github.issue.started": "review" },
          nodes: {
            review: {
              executor: "review",
              role: "review",
              capabilities: [],
              outputs: ["review.status"],
              transitions: [{ terminal: "succeeded" }],
              review: {
                reviewers: [
                  {
                    id: "review-holistic",
                    label: "Holistic design review",
                    activation: "always",
                    selects: [
                      "review-security",
                      "review-data",
                      "review-performance",
                      "review-accessibility",
                    ],
                    mode: "blocking",
                    blockingSeverities: ["critical", "high"],
                  },
                  {
                    id: "review-security",
                    label: "Security review",
                    activation: "selected",
                    selectedBy: "review-holistic",
                    selects: [],
                    mode: "blocking",
                    blockingSeverities: ["critical", "high"],
                  },
                  {
                    id: "review-data",
                    label: "Data consistency review",
                    activation: "selected",
                    selectedBy: "review-holistic",
                    selects: [],
                    mode: "blocking",
                    blockingSeverities: ["critical", "high"],
                  },
                  {
                    id: "review-performance",
                    label: "Performance review",
                    activation: "selected",
                    selectedBy: "review-holistic",
                    selects: [],
                    mode: "advisory",
                    blockingSeverities: [],
                  },
                  {
                    id: "review-accessibility",
                    label: "Accessibility review",
                    activation: "selected",
                    selectedBy: "review-holistic",
                    selects: [],
                    mode: "advisory",
                    blockingSeverities: [],
                  },
                ],
              },
            },
          },
        },
      } as never,
    },
    createdAt: Date.UTC(2026, 0, 1, 12),
    updatedAt: Date.UTC(2026, 0, 1, 12, 3),
    attempts: [
      {
        id: "holistic",
        runId: "run_review_fixture",
        runRevision: 4,
        kind: "agent",
        nodeId: "review",
        executor: "review",
        stage: "review",
        role: "review-holistic",
        state: "completed",
        deadlineAt: Date.UTC(2026, 0, 1, 12, 10),
        baseCommit: "a".repeat(40),
        expectedHead: candidateHead,
        createdAt: Date.UTC(2026, 0, 1, 12),
        updatedAt: Date.UTC(2026, 0, 1, 12, 1),
        result: {
          review: {
            status: "changes_requested",
            summary:
              "## Overall review\n\nFound a **design concern**.\n\n<script>alert(1)</script> [bad link](javascript:alert(2)) ![diagram](https://example.test/diagram.png)",
            findings: [
              {
                severity: "high",
                title: "Missing review state",
                file: "apps/control-plane/src/run-details.ts",
                details: "Keep the **selection rationale** visible.",
              },
            ],
            selections: [
              {
                role: "review-security",
                applicable: true,
                rationale: "Review the changed **security boundary**.",
              },
              {
                role: "review-data",
                applicable: true,
                rationale:
                  "Check data consistency while the review is running.",
              },
              {
                role: "review-performance",
                applicable: false,
                rationale: "No performance-sensitive changes were found.",
              },
              {
                role: "review-accessibility",
                applicable: true,
                rationale: "Check the new review structure for accessibility.",
              },
            ],
          },
        },
      },
      {
        id: "security",
        runId: "run_review_fixture",
        runRevision: 4,
        kind: "agent",
        nodeId: "review",
        executor: "review",
        stage: "review",
        role: "review-security",
        state: "failed",
        deadlineAt: Date.UTC(2026, 0, 1, 12, 10),
        baseCommit: "a".repeat(40),
        expectedHead: candidateHead,
        createdAt: Date.UTC(2026, 0, 1, 12, 1),
        updatedAt: Date.UTC(2026, 0, 1, 12, 2),
        result: {
          review: {
            summary: "## Security\n\nUnable to complete the scan.",
            findings: [],
          },
        },
      },
      {
        id: "data",
        runId: "run_review_fixture",
        runRevision: 4,
        kind: "agent",
        nodeId: "review",
        executor: "review",
        stage: "review",
        role: "review-data",
        state: "dispatched",
        deadlineAt: Date.UTC(2026, 0, 1, 12, 10),
        baseCommit: "a".repeat(40),
        expectedHead: candidateHead,
        createdAt: Date.UTC(2026, 0, 1, 12, 2),
        updatedAt: Date.UTC(2026, 0, 1, 12, 3),
      },
    ],
    events: [
      {
        kind: "workflow_review_fanout",
        payload: {
          candidateHead,
          requiredReviewers: [
            "review-holistic",
            "review-security",
            "review-data",
            "review-accessibility",
          ],
        },
        createdAt: Date.UTC(2026, 0, 1, 12, 1),
      },
    ],
  };
}

export function renderReviewRunDetailsFixture(): string {
  return renderRunDetails(reviewRunDetailsFixture());
}
