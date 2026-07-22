// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { createRun, resumeRun, transitionRun, waitingReasons } from "./run.js";

const input = {
  id: "run_01",
  repository: "zorkian/roundhouse",
  issueNumber: 246,
  baseCommit: "a".repeat(40),
  profileVersion: "v2-initial",
  profile: {
    sourcePath: ".roundhouse/profile.yaml",
    sourceCommit: "a".repeat(40),
    version: 1,
    hash: "v2-initial",
    paths: { allowed: ["**"], protected: [] },
  },
} as const;

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
  const { profile: _profile, ...profilelessInput } = input;
  const issue = {
    title: "Report",
    body: "Details",
    url: "https://github.com/zorkian/roundhouse/issues/246",
    actor: "reporter",
    clarifications: [{ actor: "citizen", body: "More context" }],
  };

  it.each(waitingReasons)("resumes a %s wait at the same stage", (reason) => {
    const run = createRun(
      reason === "profile_error"
        ? {
            ...profilelessInput,
            profileError: "Repository profile is missing or invalid",
          }
        : input,
    );
    const waiting = transitionRun(run, 1, {
      status: "waiting",
      stage: "reproduce",
      waitingReason: reason,
    });
    const refreshedProfile =
      reason === "profile_error"
        ? {
            ...input.profile,
            sourceCommit: "b".repeat(40),
            hash: "v2-refreshed",
          }
        : undefined;
    expect(resumeRun(waiting, 2, issue, refreshedProfile)).toMatchObject({
      status: "active",
      stage: "reproduce",
      revision: 3,
      issue,
    });
    expect(
      resumeRun(waiting, 2, issue, refreshedProfile).waitingReason,
    ).toBeUndefined();
  });

  it("requires a refreshed profile for profile-error and profile-less runs", () => {
    const profileError = transitionRun(
      createRun({
        ...profilelessInput,
        profileError: "Repository profile is missing or invalid",
      }),
      1,
      {
        status: "waiting",
        stage: "qualify",
        waitingReason: "profile_error",
      },
    );
    expect(() => resumeRun(profileError, 2, issue)).toThrow(
      "resume_profile_required",
    );
    const legacy = transitionRun(createRun(profilelessInput), 1, {
      status: "waiting",
      stage: "implement",
      waitingReason: "maintainer_judgment",
    });
    expect(() => resumeRun(legacy, 2, issue)).toThrow(
      "resume_profile_required",
    );
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
