// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import { operatorPage } from "./operator-ui.js";

afterEach(() => vi.unstubAllGlobals());

describe("operator UI", () => {
  it("serves authenticated dashboard, plan, run, and review shells", async () => {
    for (const path of [
      "/",
      "/plans/plan_abc",
      "/runs/run_abc",
      `/reviews/review_${"a".repeat(40)}`,
    ]) {
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

  it("renders linked independent-review evidence and findings", async () => {
    const reviewId = `review_${"a".repeat(40)}`;
    const response = operatorPage(`/reviews/${reviewId}`)!;
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
          revision: 3,
          status: "completed",
          request: {
            reviewId,
            cycle: 1,
            issueNumber: 24,
            issueUrl: "https://github.com/zorkian/roundhouse/issues/24",
            pullRequestNumber: 25,
            pullRequestUrl: "https://github.com/zorkian/roundhouse/pull/25",
            runId: "run_reviewed",
            baseCommit: "b".repeat(40),
            headCommit: "c".repeat(40),
            patchSha256: "d".repeat(64),
          },
          execution: {
            evidence: {
              objectKey: `reviews/${reviewId}/review.json`,
              sha256: "e".repeat(64),
            },
            result: {
              findings: [
                {
                  findingId: `finding_${"f".repeat(40)}`,
                  severity: "medium",
                  path: "packages/domain/src/ids.ts",
                  title: "Validate identity",
                  rationale: "Malformed identity was accepted.",
                  recommendation: "Validate the complete syntax.",
                },
              ],
            },
          },
          dispositions: [],
          events: [],
        }),
      ),
    );
    new Function(script!)();
    await vi.waitFor(() =>
      expect(app.innerHTML).toContain("Validate identity"),
    );
    expect(app.innerHTML).toContain(`/v1/reviews/${reviewId}/evidence`);
    expect(app.innerHTML).toContain(
      "https://github.com/zorkian/roundhouse/pull/25",
    );
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
