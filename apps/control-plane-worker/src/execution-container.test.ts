// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { isCheckoutRequestAllowed } from "./execution-egress.js";

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
