// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  isCheckoutRequestAllowed,
  modelRequestAuditAccepted,
} from "./execution-egress.js";
import { withContainerControlTimeout } from "./execution-control.js";

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
