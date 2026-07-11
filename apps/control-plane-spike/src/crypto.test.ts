// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { sha256, workflowInstanceId } from "./crypto.js";

describe("workflow identity and artifact hashing", () => {
  it("derives a stable, bounded workflow instance ID", async () => {
    const first = await workflowInstanceId("issue-123-attempt-1");
    expect(first).toBe(await workflowInstanceId("issue-123-attempt-1"));
    expect(first).toMatch(/^rh-[a-f0-9]{48}$/);
    expect(first.length).toBeLessThanOrEqual(100);
  });

  it("computes the expected SHA-256 digest", async () => {
    const digest = await sha256(new TextEncoder().encode("roundhouse"));
    expect(digest.hex).toBe(
      "f05fd6821ad5ed5f497190a8331b0a4b528bd63fe1851892d26c1957949b51a4",
    );
  });
});
