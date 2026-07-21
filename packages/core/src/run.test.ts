// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { createRun, resumeRun, transitionRun } from "./run.js";

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
      currentHead: input.baseCommit,
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

describe("resumeRun", () => {
  const issue = {
    title: "Report",
    body: "Details",
    url: "https://github.com/zorkian/roundhouse/issues/246",
    actor: "reporter",
    clarifications: [{ actor: "citizen", body: "More context" }],
  };

  it("resumes a clarification wait at the same stage", () => {
    const waiting = transitionRun(createRun(input), 1, {
      status: "waiting",
      stage: "reproduce",
      waitingReason: "clarification",
    });
    expect(resumeRun(waiting, 2, issue)).toMatchObject({
      status: "active",
      stage: "reproduce",
      revision: 3,
      issue,
    });
    expect(resumeRun(waiting, 2, issue).waitingReason).toBeUndefined();
  });

  it("resumes a budget wait at the same stage", () => {
    const waiting = transitionRun(createRun(input), 1, {
      status: "waiting",
      stage: "implement",
      waitingReason: "budget",
    });
    expect(resumeRun(waiting, 2, issue)).toMatchObject({
      status: "active",
      stage: "implement",
      revision: 3,
      issue,
    });
    expect(resumeRun(waiting, 2, issue).waitingReason).toBeUndefined();
  });

  it("reopens a succeeded no-change qualification on the same run", () => {
    const concluded = transitionRun(createRun(input), 1, {
      status: "succeeded",
      stage: "qualify",
    });
    expect(resumeRun(concluded, 2, issue)).toMatchObject({
      status: "active",
      stage: "qualify",
      revision: 3,
      issue,
    });
  });

  it.each([
    [{ status: "succeeded", stage: "merge" }],
    [{ status: "failed", stage: "qualify" }],
    [{ status: "cancelled", stage: "qualify" }],
    [
      {
        status: "waiting",
        stage: "plan",
        waitingReason: "plan_approval",
      },
    ],
  ])("rejects an unrelated run state %o", (state) => {
    const run = transitionRun(
      createRun(input),
      1,
      state as Parameters<typeof transitionRun>[2],
    );
    expect(() => resumeRun(run, 2, issue)).toThrow("run_not_resumable");
  });

  it("rejects an active run and a stale revision", () => {
    expect(() => resumeRun(createRun(input), 1, issue)).toThrow(
      "run_not_resumable",
    );
    const concluded = transitionRun(createRun(input), 1, {
      status: "succeeded",
      stage: "qualify",
    });
    expect(() => resumeRun(concluded, 1, issue)).toThrow("stale_run_revision");
  });
});
