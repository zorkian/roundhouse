// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { selfDevelopmentRunSchema } from "@roundhouse/self-development/cloudflare";
import { describe, expect, it } from "vitest";

import { inspectRun } from "./inspection.js";

describe("inspectRun execution evidence", () => {
  it("exposes immutable references without internal errors or credentials", () => {
    const timestamp = "2026-07-12T00:00:00.000Z";
    const run = selfDevelopmentRunSchema.parse({
      schemaVersion: 1,
      runId: "run_inspection_evidence",
      revision: 5,
      task: {
        schemaVersion: 1,
        taskId: "task_inspection_evidence",
        subject: "Inspect evidence",
        instructions: "Bounded inspection test",
        repositoryPath: "/private/workspace",
        baseCommit: "a".repeat(40),
        validationLevel: "quick",
        allowedPaths: ["docs/**"],
        publication: {
          remote: "origin",
          remoteUrl: "https://github.com/zorkian/roundhouse.git",
          branch: "roundhouse/not-published",
          expectedRemoteHead: null,
          commitMessage: "Not published",
          authorName: "Roundhouse Test",
          authorEmail: "roundhouse@example.invalid",
        },
      },
      state: "failed",
      createdAt: timestamp,
      updatedAt: timestamp,
      attempts: [
        {
          attemptId: "run_inspection_evidence-prepare-1",
          stage: "prepare",
          number: 1,
          status: "failed",
          startedAt: timestamp,
          completedAt: timestamp,
          retryable: false,
          classification: "validation_failed",
          error: "format: prettier --check (exit 1)\nNeeds formatting",
        },
      ],
      evidence: [
        {
          schemaVersion: 1,
          evidenceId: "evidence_run_inspection_evidence-prepare-1",
          attemptId: "run_inspection_evidence-prepare-1",
          objectKey:
            "runs/run_inspection_evidence/attempts/run_inspection_evidence-prepare-1/execution.json",
          sha256: "b".repeat(64),
          size: 720,
          mediaType: "application/json",
          createdAt: timestamp,
        },
      ],
      events: [
        {
          sequence: 1,
          type: "run.created",
          state: "created",
          occurredAt: timestamp,
          detail: {},
        },
      ],
    });

    const inspection = inspectRun(run) as {
      attempts: Array<{ attemptId: string }>;
    };
    const serialized = JSON.stringify(inspection);
    expect(serialized).toContain("Inspect evidence");
    expect(serialized).toContain("a".repeat(40));
    expect(serialized).toContain("evidence_run_inspection_evidence-prepare-1");
    expect(inspection.attempts[0]?.attemptId).toBe(
      "run_inspection_evidence-prepare-1",
    );
    expect(serialized).toContain("validation_failed");
    expect(serialized).toContain("Needs formatting");
    expect(serialized).not.toContain("/private/workspace");
    expect(serialized).not.toContain("roundhouse@example.invalid");
  });
});
