// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import { operatorPage } from "./operator-ui.js";

afterEach(() => vi.unstubAllGlobals());

describe("operator UI", () => {
  it("serves authenticated dashboard, plan, and run shells", async () => {
    for (const path of ["/", "/plans/plan_abc", "/runs/run_abc"]) {
      const response = operatorPage(path);
      expect(response?.status).toBe(200);
      expect(response?.headers.get("content-security-policy")).toContain(
        "frame-ancestors 'none'",
      );
      expect(response?.headers.get("content-security-policy")).not.toContain(
        "unsafe-inline",
      );
      expect(response?.headers.get("cache-control")).toBe("no-store");
      const html = await response!.text();
      expect(html).toContain("refreshes every 5s");
      const script = /<script[^>]*>([\s\S]+)<\/script>/.exec(html)?.[1];
      expect(script).toBeDefined();
      expect(() => new Function(script!)).not.toThrow();
    }
  });

  it("does not claim unrelated routes", () => {
    expect(operatorPage("/v1/github/webhook")).toBeUndefined();
    expect(operatorPage("/plans/bad/path")).toBeUndefined();
  });

  it("renders the public run-inspection contract without an internal task", async () => {
    const response = operatorPage("/")!;
    const script = /<script[^>]*>([\s\S]+)<\/script>/.exec(
      await response.text(),
    )![1];
    const app = { innerHTML: "Loading…" };
    vi.stubGlobal("document", {
      getElementById: (id: string) => (id === "app" ? app : null),
    });
    vi.stubGlobal("setInterval", () => 0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          schemaVersion: 1,
          plans: [],
          runs: [
            {
              schemaVersion: 1,
              runId: "run_ui_contract",
              taskId: "task_ui_contract",
              subject: "Public inspection subject",
              baseCommit: "a".repeat(40),
              state: "created",
              revision: 3,
              attempts: [],
              evidence: [],
            },
          ],
        }),
      ),
    );

    new Function(script!)();
    await vi.waitFor(() =>
      expect(app.innerHTML).toContain("Public inspection subject"),
    );
  });

  it("shows the offending path for a rejected plan", async () => {
    const response = operatorPage("/plans/plan_rejected")!;
    const script = /<script[^>]*>([\s\S]+)<\/script>/.exec(
      await response.text(),
    )![1];
    const app = { innerHTML: "Loading…" };
    vi.stubGlobal("document", {
      getElementById: (id: string) => (id === "app" ? app : null),
    });
    vi.stubGlobal("setInterval", () => 0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          schemaVersion: 1,
          plan: {
            status: "rejected",
            revision: 1,
            evidence: {
              objectKey: "plans/plan_rejected/plan.json",
              sha256: "a".repeat(64),
            },
            plan: {
              planId: "plan_rejected",
              issueNumber: 17,
              status: "rejected",
              baseCommit: "b".repeat(40),
              planSha256: "c".repeat(64),
              findings: [
                {
                  code: "protected_path",
                  path: ".github/workflows/ci.yml",
                  message: "Protected repository path",
                },
              ],
            },
          },
        }),
      ),
    );

    new Function(script!)();
    await vi.waitFor(() =>
      expect(app.innerHTML).toContain(".github/workflows/ci.yml"),
    );
  });
});
