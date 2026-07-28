// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  callbackPayload,
  signCallback,
  validAttemptCompletion,
  verifyCallback,
  type AttemptCompletion,
} from "./callback.js";
import {
  callbackForCompletion,
  observedBranchHead,
} from "./attempt-settlement.js";

describe("attempt settlement", () => {
  it("accepts only complete runner checkpoint records", () => {
    const completion: AttemptCompletion = {
      attemptId: "attempt_1",
      expectedRevision: 3,
      checkpoint: {
        repositoryId: "repository-id",
        repository: "run_1",
        baseCommit: "a".repeat(40),
        inputHead: "a".repeat(40),
        outputHead: "b".repeat(40),
        ref: "refs/heads/roundhouse/run_1",
        changedPaths: ["src/fix.ts"],
      },
      artifactTokenId: "token-id",
      result: { outcome: "ok" },
    };
    expect(validAttemptCompletion(completion)).toBe(true);
    expect(
      validAttemptCompletion({
        ...completion,
        checkpoint: { ...completion.checkpoint, outputHead: "not-a-commit" },
      }),
    ).toBe(false);
    expect(
      validAttemptCompletion({
        ...completion,
        checkpoint: { ...completion.checkpoint, changedPaths: [7] },
      }),
    ).toBe(false);
  });

  it("extracts the observed pull-request head from publication conflicts", () => {
    const head = "b".repeat(40);
    expect(observedBranchHead(`publish_branch_changed:${head}`)).toBe(head);
    expect(
      observedBranchHead(
        JSON.stringify({
          error: "publish_branch_changed",
          detail: `publish_branch_changed:${head}`,
        }),
      ),
    ).toBe(head);
    expect(observedBranchHead('{"error":"publish_branch_changed"}')).toBe(
      undefined,
    );
  });

  it("derives the final callback capability only at the trusted boundary", async () => {
    const completion: AttemptCompletion = {
      attemptId: "attempt_1",
      expectedRevision: 3,
      checkpoint: {
        repositoryId: "repository-id",
        repository: "run_1",
        baseCommit: "a".repeat(40),
        inputHead: "a".repeat(40),
        outputHead: "b".repeat(40),
        ref: "refs/heads/roundhouse/run_1",
        changedPaths: ["src/fix.ts"],
      },
      artifactTokenId: "token-id",
      result: { outcome: "ok" },
    };
    const callback = await callbackForCompletion(
      "control-plane-secret",
      completion,
    );
    const { signature, ...unsigned } = callback;

    expect(unsigned).toEqual(completion);
    expect(completion).not.toHaveProperty("signature");
    await expect(
      verifyCallback(
        await signCallback("control-plane-secret", completion.attemptId),
        callbackPayload(unsigned),
        signature,
      ),
    ).resolves.toBe(true);
  });
});
