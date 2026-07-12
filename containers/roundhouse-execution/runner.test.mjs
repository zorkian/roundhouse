// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  assertCompleteAgentOutput,
  changedPaths,
  command,
  secretStrings,
  validRepositoryPath,
  validRuntimeCredentialSize,
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

  it("keeps the credential field within the HTTP envelope", () => {
    expect(validRuntimeCredentialSize("x".repeat(24 * 1024))).toBe(true);
    expect(validRuntimeCredentialSize("x".repeat(24 * 1024 + 1))).toBe(false);
  });

  it("extracts credential values without treating metadata as secret", () => {
    expect(
      secretStrings({
        issuer: "https://auth.openai.com",
        client_id: "public-client-identifier",
        tokens: {
          access_token: "actual-access-token",
          refresh_token: "actual-refresh-token",
        },
      }),
    ).toEqual(["actual-access-token", "actual-refresh-token"]);
  });

  it("rejects control characters in repository paths", () => {
    expect(validRepositoryPath("docs/safe.md")).toBe(true);
    for (const path of [
      "docs/line\nbreak.md",
      "docs/tab\tname.md",
      "docs/./file.md",
      "docs//file.md",
      "docs/",
    ])
      expect(validRepositoryPath(path)).toBe(false);
  });

  it("parses NUL-delimited status paths without quoting ambiguity", () => {
    expect(changedPaths("?? docs/my file.md\0 M docs/café.md\0")).toEqual([
      "docs/my file.md",
      "docs/café.md",
    ]);
    expect(changedPaths("R  docs/old name.md\0docs/new name.md\0")).toEqual([
      "docs/old name.md",
      "docs/new name.md",
    ]);
    expect(changedPaths("C  docs/source.md\0docs/copy.md\0")).toEqual([
      "docs/copy.md",
    ]);
  });
});
