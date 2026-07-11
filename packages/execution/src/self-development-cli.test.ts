// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { parseSelfDevelopmentInvocation } from "./self-development-cli.js";

describe("self-development CLI", () => {
  it("parses a prepare command with conservative defaults", () => {
    expect(
      parseSelfDevelopmentInvocation([
        "prepare",
        "--run-id",
        "run_test",
        "--base",
        "a".repeat(40),
      ]),
    ).toMatchObject({
      command: "prepare",
      runId: "run_test",
      baseCommit: "a".repeat(40),
      level: "quick",
      profilePath: "profiles/roundhouse.v1.yaml",
      artifactRoot: ".roundhouse/artifacts",
    });
  });

  it("requires the exact base and patch hash for approval", () => {
    expect(
      parseSelfDevelopmentInvocation([
        "approve",
        "--run-id",
        "run_test",
        "--actor",
        "mark",
        "--base",
        "a".repeat(40),
        "--patch-sha256",
        "b".repeat(64),
      ]),
    ).toMatchObject({
      command: "approve",
      actorId: "mark",
      patchSha256: "b".repeat(64),
    });
  });

  it("rejects unknown and duplicate options", () => {
    expect(() =>
      parseSelfDevelopmentInvocation([
        "verify",
        "--run-id",
        "run_test",
        "--surprise",
        "value",
      ]),
    ).toThrow("Unknown option: --surprise");
    expect(() =>
      parseSelfDevelopmentInvocation([
        "verify",
        "--run-id",
        "run_test",
        "--run-id",
        "again",
      ]),
    ).toThrow("Duplicate option: --run-id");
  });

  it("requires a commit message for approved publication", () => {
    expect(
      parseSelfDevelopmentInvocation([
        "commit",
        "--run-id",
        "run_test",
        "--message",
        "Apply approved patch",
      ]),
    ).toMatchObject({
      command: "commit",
      runId: "run_test",
      message: "Apply approved patch",
    });
  });
});
