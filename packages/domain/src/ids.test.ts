// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { idSchema, newId } from "./ids.js";

describe("IDs", () => {
  it("generates lexicographically ordered ULIDs", () => {
    const first = newId("run");
    const second = newId("run");

    expect(idSchema("run").parse(first)).toBe(first);
    expect(second > first).toBe(true);
  });
});
