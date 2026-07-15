// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  isCheckoutRequestAllowed,
  modelRequestAuditAccepted,
} from "./execution-egress.js";
import { withContainerControlTimeout } from "./execution-control.js";
import { AttemptSingleFlight } from "./attempt-single-flight.js";

describe("execution Container checkout egress", () => {
  it("rejects non-HTTPS requests even for an allowed hostname", async () => {
    expect(
      isCheckoutRequestAllowed(
        new Request("http://github.com/zorkian/roundhouse.git"),
      ),
    ).toBe(false);
    expect(
      isCheckoutRequestAllowed(
        new Request("https://github.com/zorkian/roundhouse.git"),
      ),
    ).toBe(true);
  });
});

describe("execution Container model egress", () => {
  it("fails closed when the durable request cap rejects an audit row", () => {
    expect(modelRequestAuditAccepted(1)).toBe(true);
    expect(modelRequestAuditAccepted(0)).toBe(false);
    expect(modelRequestAuditAccepted(undefined)).toBe(false);
  });

  it("bounds a stalled Container control operation", async () => {
    await expect(
      withContainerControlTimeout(
        "allowlist revocation",
        () => new Promise(() => undefined),
        5,
      ),
    ).rejects.toThrow("Container allowlist revocation timed out");
  });
});

describe("execution Container attempt single-flight", () => {
  it("shares one in-flight and retained result for the same attempt", async () => {
    const attempts = new AttemptSingleFlight<string>();
    let starts = 0;
    let release!: (value: string) => void;
    const result = new Promise<string>((resolve) => {
      release = resolve;
    });
    const action = () => {
      starts += 1;
      return result;
    };

    const first = attempts.run("review-attempt-1", action);
    const replay = attempts.run("review-attempt-1", action);
    release("reviewed");

    await expect(Promise.all([first, replay])).resolves.toEqual([
      "reviewed",
      "reviewed",
    ]);
    await expect(attempts.run("review-attempt-1", action)).resolves.toBe(
      "reviewed",
    );
    expect(starts).toBe(1);
  });

  it("clears a failed attempt so the same identity can resume", async () => {
    const attempts = new AttemptSingleFlight<string>();
    let starts = 0;
    const action = async () => {
      starts += 1;
      if (starts === 1) throw new Error("interrupted");
      return "resumed";
    };

    await expect(attempts.run("review-attempt-1", action)).rejects.toThrow(
      "interrupted",
    );
    await expect(attempts.run("review-attempt-1", action)).resolves.toBe(
      "resumed",
    );
    expect(starts).toBe(2);
  });
});
