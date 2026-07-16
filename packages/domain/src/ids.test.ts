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

  it("accepts lowercase ULIDs and returns their canonical representation", () => {
    const uppercase = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

    expect(idSchema("run").parse(uppercase.toLowerCase())).toBe(uppercase);
  });

  it.each(["01ARZ3NDEKTSV4RRFFQ69G5FAI", "01ARZ3NDEKTSV4RRFFQ69G5FAO"])(
    "rejects ULIDs containing ambiguous characters: %s",
    (value) => {
      expect(idSchema("run").safeParse(value).success).toBe(false);
    },
  );
});
