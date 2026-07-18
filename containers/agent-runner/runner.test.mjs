// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { runnerIdentity, runnerResponse } from "./runner.mjs";

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
});
