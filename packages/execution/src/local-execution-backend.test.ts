// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { LocalExecutionBackend } from "./local-execution-backend.js";

describe("LocalExecutionBackend", () => {
  it("captures command results without a shell", async () => {
    const result = await new LocalExecutionBackend().run(
      { command: process.execPath, args: ["-e", "process.stdout.write('ok')"] },
      process.cwd(),
      { timeoutMs: 5_000, maxOutputBytes: 1_024 },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(result.timedOut).toBe(false);
  });

  it("bounds captured output", async () => {
    const result = await new LocalExecutionBackend().run(
      {
        command: process.execPath,
        args: ["-e", "process.stdout.write('abcdef')"],
      },
      process.cwd(),
      { timeoutMs: 5_000, maxOutputBytes: 3 },
    );

    expect(result.stdout).toBe("abc");
    expect(result.outputTruncated).toBe(true);
  });
});
