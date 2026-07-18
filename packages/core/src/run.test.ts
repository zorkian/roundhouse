// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { createRun, transitionRun } from "./run.js";

const input = {
  id: "run_01",
  repository: "zorkian/roundhouse",
  issueNumber: 246,
  baseCommit: "a".repeat(40),
  profileVersion: "v2-initial",
};

describe("V2 run contract", () => {
  it("creates the one initial qualification state", () => {
    expect(createRun(input)).toEqual({
      schemaVersion: 2,
      ...input,
      status: "active",
      stage: "qualify",
      revision: 1,
    });
  });

  it.each([
    [{ ...input, id: "bad" }, "invalid_run_id"],
    [{ ...input, repository: "roundhouse" }, "invalid_repository"],
    [{ ...input, issueNumber: 0 }, "invalid_issue_number"],
    [{ ...input, baseCommit: "main" }, "invalid_base_commit"],
    [{ ...input, profileVersion: "" }, "invalid_profile_version"],
  ])("rejects an invalid bound input", (candidate, reason) => {
    expect(() => createRun(candidate)).toThrow(reason);
  });

  it("increments one authoritative revision when waiting", () => {
    const run = createRun(input);
    expect(
      transitionRun(run, 1, {
        status: "waiting",
        stage: "qualify",
        waitingReason: "clarification",
      }),
    ).toMatchObject({
      revision: 2,
      status: "waiting",
      waitingReason: "clarification",
    });
  });

  it("rejects stale compare-and-swap transitions", () => {
    expect(() =>
      transitionRun(createRun(input), 2, {
        status: "active",
        stage: "reproduce",
      }),
    ).toThrow("stale_run_revision");
  });

  it("keeps waiting reason orthogonal to stage", () => {
    const run = createRun(input);
    expect(() =>
      transitionRun(run, 1, { status: "waiting", stage: "plan" }),
    ).toThrow("waiting_reason_required");
    expect(() =>
      transitionRun(run, 1, {
        status: "active",
        stage: "plan",
        waitingReason: "plan_approval",
      }),
    ).toThrow("waiting_reason_not_allowed");
  });

  it("never resumes a terminal run by accident", () => {
    const completed = transitionRun(createRun(input), 1, {
      status: "succeeded",
      stage: "merge",
    });
    expect(() =>
      transitionRun(completed, 2, { status: "active", stage: "qualify" }),
    ).toThrow("run_is_terminal");
  });
});
