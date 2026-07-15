// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import { operatorPage } from "./operator-ui.js";

afterEach(() => vi.unstubAllGlobals());

describe("operator UI", () => {
  it("renders the environment-specific start command", async () => {
    const response = operatorPage(
      "/repositories/zorkian/roundhouse/issues/24",
      "/rhd",
    )!;
    const html = await response.text();
    expect(html).toContain('"commandPrefix":"/rhd"');
  });

  it("serves authenticated dashboard, issue, plan, run, and review shells", async () => {
    for (const path of [
      "/",
      "/repositories/zorkian/roundhouse/issues/24",
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

  it("renders one repository-qualified issue workflow", async () => {
    const reviewId = `review_${"a".repeat(40)}`;
    const response = operatorPage(
      "/repositories/zorkian/roundhouse/issues/24",
    )!;
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
      vi.fn(async (input: string) => {
        expect(input).toBe("/v1/repositories/zorkian/roundhouse/issues/24");
        return Response.json({
          schemaVersion: 1,
          repositoryFullName: "zorkian/roundhouse",
          issueNumber: 24,
          plan: {
            plan: { planId: "plan_issue_workflow" },
          },
          sourceRun: { runId: "run_source" },
          activeRun: {
            runId: "run_remediation",
            publication: {
              pullRequestUrl: "https://github.com/zorkian/roundhouse/pull/25",
            },
          },
          pullRequestLifecycle: {
            state: "merged",
            mergeCommitSha: "c".repeat(40),
          },
          reviews: [
            {
              status: "completed",
              request: {
                cycle: 2,
                reviewId,
                headCommit: "b".repeat(40),
              },
              execution: { result: { findings: [] } },
            },
          ],
        });
      }),
    );
    new Function(script!)();
    await vi.waitFor(() => expect(app.innerHTML).toContain("run_remediation"));
    expect(app.innerHTML).toContain("What happens next");
    expect(app.innerHTML).toContain("This issue is complete");
    expect(app.innerHTML).toContain(`/reviews/${reviewId}`);
    expect(app.innerHTML).toContain(
      "https://github.com/zorkian/roundhouse/pull/25",
    );
    expect(app.innerHTML).toContain("development release and checks");
    expect(app.innerHTML).toContain(`${"c".repeat(40)}/checks`);
  });

  it("puts the operator's next action ahead of workflow internals", async () => {
    const reviewId = `review_${"b".repeat(40)}`;
    const response = operatorPage(
      "/repositories/zorkian/roundhouse/issues/24",
    )!;
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
          repositoryFullName: "zorkian/roundhouse",
          issueNumber: 24,
          plan: null,
          sourceRun: {
            runId: "run_source",
            state: "completed",
            publication: {
              pullRequestUrl: "https://github.com/zorkian/roundhouse/pull/25",
            },
          },
          reviews: [
            {
              status: "running",
              request: {
                cycle: 1,
                reviewId,
                headCommit: "b".repeat(40),
              },
            },
          ],
        }),
      ),
    );
    new Function(script!)();
    await vi.waitFor(() =>
      expect(app.innerHTML).toContain("Independent review is running"),
    );
    expect(app.innerHTML.indexOf("What happens next")).toBeLessThan(
      app.innerHTML.indexOf("GitHub issue workflow"),
    );
    expect(app.innerHTML).toContain("No action needed");
    expect(app.innerHTML).toContain(`/reviews/${reviewId}`);
  });

  it("renders live Container phases on a run page", async () => {
    const response = operatorPage("/runs/run_live")!;
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
          runId: "run_live",
          taskId: "task_live",
          state: "implementing",
          revision: 3,
          attempts: [],
          evidence: [],
          events: [],
          reviews: [
            {
              status: "completed",
              attemptCount: 1,
              request: {
                reviewId: "review_45406706e161b9dbdebd8485dea2f19bf7995bb4",
                attemptId:
                  "review_45406706e161b9dbdebd8485dea2f19bf7995bb4-attempt-1",
                cycle: 1,
              },
              execution: {
                evidence: { objectKey: "reviews/result.json" },
                result: {
                  summary: "The implementation is ready.",
                  findings: [
                    {
                      severity: "low",
                      path: "apps/control-plane-worker/src/operator-ui.ts",
                      title: "Keep the timeline readable",
                      rationale: "Operators scan phases before attempts.",
                      recommendation: "Keep phase in the first column.",
                    },
                  ],
                },
              },
            },
          ],
          progress: [
            {
              attemptId: "run_live-prepare-1",
              phase: "agent.implement",
              status: "running",
              startedAt: "2026-07-14T00:00:00.000Z",
              updatedAt: "2026-07-14T00:00:00.000Z",
            },
            {
              attemptId: "run_live-attempt-2",
              phase: "validation.test",
              status: "completed",
              startedAt: "2026-07-14T00:00:00.000Z",
              completedAt: "2026-07-14T00:00:05.000Z",
              updatedAt: "2026-07-14T00:00:05.000Z",
            },
            {
              attemptId:
                "review_45406706e161b9dbdebd8485dea2f19bf7995bb4-attempt-1",
              phase: "agent.review",
              status: "completed",
              startedAt: "2026-07-14T00:00:00.000Z",
              completedAt: "2026-07-14T00:00:03.000Z",
              updatedAt: "2026-07-14T00:00:03.000Z",
            },
          ],
        }),
      ),
    );
    new Function(script!)();
    await vi.waitFor(() => expect(app.innerHTML).toContain("Timeline"));
    expect(app.innerHTML).toContain("prepare #1");
    expect(app.innerHTML).toContain("attempt #2");
    expect(app.innerHTML).toContain("attempt #1");
    expect(app.innerHTML).toContain("agent.implement");
    expect(app.innerHTML).toContain("validation.test");
    expect(app.innerHTML).toContain("The implementation is ready.");
    expect(app.innerHTML).toContain("Keep the timeline readable");
    expect(app.innerHTML).toContain("running");
    expect(app.innerHTML).toContain("5s");
    expect(app.innerHTML).not.toContain("run_live-prepare-1");
    expect(app.innerHTML).not.toContain(
      '<strong class="event-attempt">review_45406706e161b9dbdebd8485dea2f19bf7995bb4',
    );
    expect(app.innerHTML).toContain("<details");
    expect(app.innerHTML.indexOf("Phase")).toBeLessThan(
      app.innerHTML.indexOf("Attempt"),
    );
    expect(app.innerHTML).not.toContain("<h2>Attempts</h2>");
    expect(app.innerHTML).not.toContain("<h2>Evidence</h2>");
    expect(app.innerHTML.match(/class="event-row"/g)).toHaveLength(3);
  });

  it("does not label the source run as an active remediation", async () => {
    const response = operatorPage(
      "/repositories/zorkian/roundhouse/issues/24",
    )!;
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
          repositoryFullName: "zorkian/roundhouse",
          issueNumber: 24,
          plan: null,
          sourceRun: {
            runId: "run_source",
            publication: {
              pullRequestUrl: "https://github.com/zorkian/roundhouse/pull/27",
            },
          },
          reviews: [],
        }),
      ),
    );
    new Function(script!)();
    await vi.waitFor(() => expect(app.innerHTML).toContain("run_source"));
    expect(app.innerHTML).toContain(
      '<span class="muted">active run</span><span>—</span>',
    );
    expect(app.innerHTML).toContain(
      "https://github.com/zorkian/roundhouse/pull/27",
    );
  });

  it("keeps the source pull request linked while remediation is unpublished", async () => {
    const response = operatorPage(
      "/repositories/zorkian/roundhouse/issues/24",
    )!;
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
          repositoryFullName: "zorkian/roundhouse",
          issueNumber: 24,
          plan: null,
          sourceRun: {
            runId: "run_source",
            publication: {
              pullRequestUrl: "https://github.com/zorkian/roundhouse/pull/27",
            },
          },
          activeRun: { runId: "run_remediation" },
          reviews: [],
        }),
      ),
    );
    new Function(script!)();
    await vi.waitFor(() => expect(app.innerHTML).toContain("run_remediation"));
    expect(app.innerHTML).toContain(
      "https://github.com/zorkian/roundhouse/pull/27",
    );
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

  it("organizes the dashboard around repository-qualified issues", async () => {
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
          plans: [
            {
              status: "materialized",
              runId: "run_ui_contract",
              plan: {
                planId: `plan_${"b".repeat(40)}`,
                issueNumber: 66,
                subject: "Improve the operator dashboard",
                createdAt: "2026-07-14T18:00:00.000Z",
              },
            },
            {
              status: "needs_clarification",
              plan: {
                planId: `plan_${"c".repeat(40)}`,
                issueNumber: 65,
                subject: "Clarify production rollout",
                createdAt: "2026-07-14T19:00:00.000Z",
              },
            },
          ],
          runs: [
            {
              schemaVersion: 1,
              runId: "run_ui_contract",
              taskId: "task_ui_contract",
              subject: "Improve the operator dashboard",
              baseCommit: "a".repeat(40),
              state: "implementing",
              revision: 3,
              updatedAt: "2026-07-14T20:00:00.000Z",
              source: {
                owner: "zorkian",
                repository: "roundhouse",
                issueNumber: 66,
                issueUrl: "https://github.com/zorkian/roundhouse/issues/66",
              },
              attempts: [],
              evidence: [],
            },
          ],
          reviews: [
            {
              status: "completed",
              updatedAt: "2026-07-14T21:00:00.000Z",
              request: {
                reviewId: `review_${"d".repeat(40)}`,
                repositoryUrl: "https://github.com/zorkian/roundhouse.git",
                issueNumber: 64,
                issueUrl: "https://github.com/zorkian/roundhouse/issues/64",
                subject: "Make status understandable",
                pullRequestNumber: 70,
                pullRequestUrl: "https://github.com/zorkian/roundhouse/pull/70",
              },
            },
          ],
        }),
      ),
    );

    new Function(script!)();
    await vi.waitFor(() =>
      expect(app.innerHTML).toContain("Improve the operator dashboard"),
    );
    expect(app.innerHTML).toContain("zorkian/roundhouse");
    expect(app.innerHTML).toContain("#66");
    expect(app.innerHTML).toContain("Implementing");
    expect(app.innerHTML).toContain("Clarification needed");
    expect(app.innerHTML).toContain("Ready for human review");
    expect(app.innerHTML).toContain("Review pull request #70");
    expect(app.innerHTML).toContain("Needs attention");
    expect(app.innerHTML).toContain("In progress");
    expect(app.innerHTML).toContain("Finished");
    expect(app.innerHTML).not.toContain("<h2>Plans</h2>");
    expect(app.innerHTML).not.toContain("<h2>Runs</h2>");
    expect(app.innerHTML).not.toContain("<h2>Independent reviews</h2>");
    expect(app.innerHTML).not.toContain(`>plan_${"b".repeat(40)}<`);
    expect(app.innerHTML).not.toContain(">run_ui_contract<");
  });

  it("links retained failed-validation diagnostics without making them approval eligible", async () => {
    const runId = "run_failed_validation";
    const evidenceId = "evidence_run_failed_validation-prepare-1";
    const response = operatorPage(`/runs/${runId}`)!;
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
          runId,
          subject: "Repair formatting",
          state: "failed",
          revision: 5,
          attempts: [
            {
              attemptId: `${runId}-prepare-1`,
              stage: "prepare",
              number: 1,
              status: "failed",
              classification: "validation_failed",
              error: "format failed: packages/example.ts needs formatting",
            },
          ],
          evidence: [
            {
              evidenceId,
              attemptId: `${runId}-prepare-1`,
              objectKey: `runs/${runId}/attempts/prepare-1/result.json`,
              sha256: "a".repeat(64),
              size: 123,
              approvalEligible: false,
            },
          ],
          events: [],
        }),
      ),
    );

    new Function(script!)();
    await vi.waitFor(() => expect(app.innerHTML).toContain("needs formatting"));
    expect(app.innerHTML).toContain(`/v1/runs/${runId}/evidence/${evidenceId}`);
    expect(app.innerHTML).toContain("approval eligible");
    expect(app.innerHTML).toContain("no");
  });

  it("renders the exact retained implementation review", async () => {
    const runId = "run_exact_review";
    const response = operatorPage(`/runs/${runId}`)!;
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
      vi.fn(async (path: string) =>
        path.endsWith("/implementation")
          ? Response.json({
              runId,
              patch: "diff --git a/docs/a.md b/docs/a.md\n+reviewable",
              patchSha256: "a".repeat(64),
              patchBytes: 52,
              changedFiles: ["docs/a.md"],
              summary: "Implemented the approved behavior.",
              validation: [
                {
                  name: "plan-compliance",
                  command: "internal: approved path boundary",
                  exitCode: 0,
                  stdout: "Final patch changes 1 of 2 approved path(s).",
                  stderr: "",
                },
              ],
              retryLineage: {
                priorAttemptId: `${runId}-prepare-1`,
                priorPatchSha256: "b".repeat(64),
              },
            })
          : Response.json({
              runId,
              subject: "Review this implementation",
              state: "awaiting_approval",
              revision: 7,
              implementation: { patchSha256: "a".repeat(64) },
              attempts: [],
              evidence: [],
              events: [],
            }),
      ),
    );

    new Function(script!)();
    await vi.waitFor(() =>
      expect(app.innerHTML).toContain("Exact retained diff"),
    );
    expect(app.innerHTML).toContain("Implemented the approved behavior");
    expect(app.innerHTML).toContain("plan-compliance");
    expect(app.innerHTML).toContain("reviewable");
    expect(app.innerHTML).toContain("agent.implement");
    expect(app.innerHTML).not.toContain(`${runId}-prepare-1`);
  });

  it("renders a clarification plan without assuming rejection findings", async () => {
    const response = operatorPage("/plans/plan_clarify")!;
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
          plan: {
            status: "needs_clarification",
            revision: 1,
            evidence: {
              objectKey: "plans/plan_clarify/plan.json",
              sha256: "a".repeat(64),
            },
            plan: {
              planId: "plan_clarify",
              issueNumber: 33,
              status: "needs_clarification",
              baseCommit: "b".repeat(40),
              planSha256: "c".repeat(64),
              understanding: "The interaction surface is ambiguous.",
              questions: ["Should this change the issue or run page?"],
              evidence: [],
            },
          },
        }),
      ),
    );

    new Function(script!)();
    await vi.waitFor(() =>
      expect(app.innerHTML).toContain(
        "Should this change the issue or run page?",
      ),
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
