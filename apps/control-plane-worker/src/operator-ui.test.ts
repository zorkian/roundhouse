// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { operatorPage } from "./operator-ui.js";

describe("operator UI", () => {
  it("serves authenticated dashboard, plan, and run shells", async () => {
    for (const path of ["/", "/plans/plan_abc", "/runs/run_abc"]) {
      const response = operatorPage(path);
      expect(response?.status).toBe(200);
      expect(response?.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'",
      );
      const html = await response!.text();
      expect(html).toContain("refreshes every 5s");
      const script = /<script>([\s\S]+)<\/script>/.exec(html)?.[1];
      expect(script).toBeDefined();
      expect(() => new Function(script!)).not.toThrow();
    }
  });

  it("does not claim unrelated routes", () => {
    expect(operatorPage("/v1/github/webhook")).toBeUndefined();
    expect(operatorPage("/plans/bad/path")).toBeUndefined();
  });
});
