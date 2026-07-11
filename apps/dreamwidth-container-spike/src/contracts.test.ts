// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { instanceIdSchema, verifyRequestSchema } from "./contracts.js";

describe("Dreamwidth container spike contracts", () => {
  it("accepts bounded instance IDs and full commit SHAs", () => {
    expect(instanceIdSchema.parse("issue-3452-attempt-1")).toBe(
      "issue-3452-attempt-1",
    );
    expect(verifyRequestSchema.parse({ commit: "a".repeat(40) })).toEqual({
      commit: "a".repeat(40),
    });
  });

  it("rejects refs and malformed instance IDs", () => {
    expect(() => verifyRequestSchema.parse({ commit: "main" })).toThrow();
    expect(() => instanceIdSchema.parse("../shared")).toThrow();
  });
});
