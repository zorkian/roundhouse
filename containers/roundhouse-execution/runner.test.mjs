// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  assertCompleteAgentOutput,
  changedPaths,
  command,
  validRepositoryPath,
  withoutRuntimeCredential,
} from "./runner.mjs";

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

  it("clears credential-derived runtime state", () => {
    expect(
      withoutRuntimeCredential({
        credentialInstalled: true,
        secrets: ["sensitive"],
        request: { runId: "run_test" },
      }),
    ).toEqual({
      credentialInstalled: false,
      secrets: [],
      request: { runId: "run_test" },
    });
  });

  it("rejects control characters in repository paths", () => {
    expect(validRepositoryPath("docs/safe.md")).toBe(true);
    for (const path of ["docs/line\nbreak.md", "docs/tab\tname.md"])
      expect(validRepositoryPath(path)).toBe(false);
  });

  it("parses NUL-delimited status paths without quoting ambiguity", () => {
    expect(changedPaths("?? docs/my file.md\0 M docs/café.md\0")).toEqual([
      "docs/my file.md",
      "docs/café.md",
    ]);
    expect(changedPaths("R  docs/new name.md\0docs/old name.md\0")).toEqual([
      "docs/new name.md",
    ]);
  });
});
