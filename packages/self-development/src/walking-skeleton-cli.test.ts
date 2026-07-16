// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  parseTimeoutMs,
  runWalkingSkeletonCli,
} from "./walking-skeleton-cli.js";

describe("runWalkingSkeletonCli", () => {
  it("rejects duplicate options", async () => {
    await expect(
      runWalkingSkeletonCli(["status", "--root", "first", "--root", "second"]),
    ).rejects.toThrow("Duplicate option: --root");
  });
});

describe("parseTimeoutMs", () => {
  it("uses the bounded default", () => {
    expect(parseTimeoutMs(undefined)).toBe(600_000);
  });

  it.each(["", "not-a-number", "0", "-1", "Infinity", "2147483648"])(
    "rejects invalid CLI value %j",
    (value) => {
      expect(() => parseTimeoutMs(value)).toThrow(
        "timeoutMs must be a positive supported integer",
      );
    },
  );
});
