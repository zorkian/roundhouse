// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { assertCompleteAgentOutput, command } from "./runner.mjs";

describe("execution runner command", () => {
  it("rejects promptly when spawning the executable fails", async () => {
    const started = Date.now();
    await expect(
      command("/roundhouse-missing-executable", [], { timeoutMs: 10_000 }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("trusted agent output boundary", () => {
  it("rejects timeout and truncation before event parsing", () => {
    expect(() =>
      assertCompleteAgentOutput({ timedOut: true, outputTruncated: false }),
    ).toThrow("agent_timeout");
    expect(() =>
      assertCompleteAgentOutput({ timedOut: false, outputTruncated: true }),
    ).toThrow("agent_output_truncated");
    expect(() =>
      assertCompleteAgentOutput({ timedOut: false, outputTruncated: false }),
    ).not.toThrow();
  });
});
