// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { AppliedProfile } from "@roundhouse/core";
import { describe, expect, it } from "vitest";
import {
  checkpointIdentityExpectation,
  checkpointIdentityRejection,
} from "./attempt-runtime.js";
import { CheckpointRejectedError } from "./callback.js";

describe("attempt runtime checkpoint identity", () => {
  it("uses an integration attempt's selected target instead of the run's original base", () => {
    const originalRunBase = "a".repeat(40);
    const selectedTargetBase = "b".repeat(40);
    const candidateHead = "c".repeat(40);
    const profile = {} as AppliedProfile;

    const expected = checkpointIdentityExpectation(
      {
        baseCommit: selectedTargetBase,
        expectedHead: candidateHead,
      },
      {
        id: "run_1",
        baseCommit: originalRunBase,
        profile,
      },
      "artifacts:development/run_1",
      false,
    );

    expect(expected).toMatchObject({
      repositoryId: "artifacts:development/run_1",
      repository: "run_1",
      baseCommit: selectedTargetBase,
      inputHead: candidateHead,
      ref: "refs/heads/roundhouse/run_1",
      profile,
      enforcePathPolicy: false,
    });
  });

  it("maps permanent identity failures to checkpoint rejections", () => {
    const rejected = checkpointIdentityRejection(
      new Error("protected_path_changed"),
    );
    expect(rejected).toBeInstanceOf(CheckpointRejectedError);
    expect(rejected?.status).toBe(422);
    expect(rejected?.detail).toBe(
      '{"error":"invalid_checkpoint","detail":"protected_path_changed"}',
    );
    expect(checkpointIdentityRejection(new Error("docker_timeout"))).toBe(
      undefined,
    );
    const existing = new CheckpointRejectedError(422, "already");
    expect(checkpointIdentityRejection(existing)).toBe(existing);
  });
});
