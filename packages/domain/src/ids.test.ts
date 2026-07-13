// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { idSchema, isId, newId } from "./ids.js";

describe("IDs", () => {
  it("generates lexicographically ordered ULIDs", () => {
    const first = newId("run");
    const second = newId("run");

    expect(idSchema("run").parse(first)).toBe(first);
    expect(second > first).toBe(true);
  });

  it("identifies IDs of the requested kind", () => {
    const id = newId("run");

    expect(isId("run", id)).toBe(true);
    expect(isId("run", "not-an-id")).toBe(false);
    expect(isId("run", 42)).toBe(false);
  });
});
