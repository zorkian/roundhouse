// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { AppliedProfile } from "@roundhouse/core";
import { describe, expect, it } from "vitest";
import { checkpointIdentityExpectation } from "./attempt-runtime.js";

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
});
