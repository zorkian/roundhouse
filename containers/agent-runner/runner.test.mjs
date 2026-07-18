// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  completionRequest,
  runnerIdentity,
  runnerResponse,
} from "./runner.mjs";

describe("V2 agent runner", () => {
  it("reports only its versioned runner identity", () => {
    expect(runnerResponse("GET", "/health")).toEqual({
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ ...runnerIdentity, ok: true }),
    });
  });

  it("rejects undeclared routes and mutating health requests", () => {
    expect(runnerResponse("POST", "/health")).toMatchObject({
      status: 405,
      headers: { allow: "GET" },
    });
    expect(runnerResponse("GET", "/v1/execute")).toMatchObject({
      status: 404,
      body: JSON.stringify({ error: "not_found" }),
    });
  });

  it("accepts an immutable assignment promptly and deduplicates replay", () => {
    const assignment = {
      id: "attempt_1",
      runId: "run_1",
      runRevision: 1,
      deadlineAt: Date.now() + 60_000,
      expectedHead: "a".repeat(40),
    };
    expect(runnerResponse("POST", "/assign", assignment)).toMatchObject({
      status: 202,
      body: JSON.stringify({
        accepted: true,
        attemptId: "attempt_1",
        duplicate: false,
      }),
    });
    expect(runnerResponse("POST", "/assign", assignment)).toMatchObject({
      status: 202,
      body: JSON.stringify({
        accepted: true,
        attemptId: "attempt_1",
        duplicate: true,
      }),
    });
  });

  it("builds an attempt-bound asynchronous completion callback", async () => {
    const assignment = {
      id: "attempt_callback",
      runId: "run_1",
      runRevision: 3,
      deadlineAt: Date.now() + 60_000,
      expectedHead: "a".repeat(40),
    };
    const request = completionRequest(
      assignment,
      "https://v2.invalid/attempts/callback",
      "attempt-secret",
    );
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/attempts/callback");
    await expect(request.json()).resolves.toMatchObject({
      attemptId: assignment.id,
      expectedRevision: 3,
      acceptedHead: assignment.expectedHead,
      result: { checkpoint: assignment.expectedHead },
      signature: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
});
