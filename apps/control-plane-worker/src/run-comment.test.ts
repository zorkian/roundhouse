// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { SelfDevelopmentRun } from "@roundhouse/self-development/cloudflare";
import { describe, expect, it } from "vitest";

import { runComment } from "./index.js";
import type { RuntimeIdentity } from "./runtime-config.js";

describe("GitHub run status projection", () => {
  it("shows actionable failure diagnostics and retained evidence", async () => {
    const attemptId = "run_failed-prepare-2";
    const run = {
      runId: "run_failed",
      revision: 10,
      state: "failed",
      task: { baseCommit: "a".repeat(40) },
      attempts: [
        {
          attemptId,
          stage: "prepare",
          number: 2,
          status: "failed",
          classification: "validation_failed",
          error: "format: prettier --check (exit 1)\nNeeds formatting",
        },
      ],
      evidence: [
        {
          evidenceId: `evidence_${attemptId}`,
          attemptId,
        },
      ],
    } as SelfDevelopmentRun;
    const identity = {
      origin: "https://roundhouse.rm-rf.rip",
      repositoryFullName: "zorkian/roundhouse",
    } as RuntimeIdentity;

    const comment = await runComment(run, identity);

    expect(comment).toContain("Needs formatting");
    expect(comment).toContain(
      `https://roundhouse.rm-rf.rip/v1/runs/run_failed/evidence/evidence_${attemptId}`,
    );
  });
});
