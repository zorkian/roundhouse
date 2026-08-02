// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { compileWorkflow, defaultIssueWorkflowSource } from "@roundhouse/core";
import { describe, expect, it } from "vitest";
import type { RunDetails } from "./d1-store.js";
import { renderRunDetails } from "./run-details.js";

type DetailsRun = RunDetails["run"];
type DetailsAttempt = RunDetails["attempts"][number];
const workflowCommit = "c".repeat(40);
const workflow = await compileWorkflow(
  defaultIssueWorkflowSource,
  workflowCommit,
);
const runtime = {
  contextWindow: 1_000_000,
  maxOutputTokens: 128_000,
  thinkingLevelMap: { low: "low", high: "high" },
} as const;

function runFixture(overrides: Partial<DetailsRun> = {}): DetailsRun {
  return {
    schemaVersion: 2,
    id: "run_fixture",
    repository: "zorkian/roundhouse",
    issueNumber: 281,
    baseCommit: "base",
    currentHead: "base",
    profileVersion: "test",
    status: "active",
    stage: "implement",
    revision: 1,
    ...overrides,
  };
}

function attemptFixture(
  overrides: Partial<DetailsAttempt> = {},
): DetailsAttempt {
  return {
    id: "attempt",
    runId: "run_fixture",
    runRevision: 1,
    kind: "agent",
    stage: "implement",
    role: "implement",
    state: "completed",
    deadlineAt: 10,
    baseCommit: "base",
    expectedHead: "base",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function detailsFixture(
  overrides: Omit<Partial<RunDetails>, "run"> & {
    readonly run?: Partial<DetailsRun>;
  } = {},
): RunDetails {
  const { run, ...rest } = overrides;
  return {
    run: runFixture(run),
    createdAt: 1,
    updatedAt: 2,
    attempts: [],
    ...rest,
  };
}

describe("run details", () => {
  it("renders escaped summary, usage, links, and workflow evidence", () => {
    const html = renderRunDetails(
      detailsFixture({
        run: {
          id: "run_summary",
          currentHead: "candidate-sha",
          status: "succeeded",
          stage: "merge",
          issue: {
            title: "<script>alert(1)</script>",
            body: "body",
            url: "https://github.com/zorkian/roundhouse/issues/281",
            actor: "user",
          },
        },
        attempts: [
          attemptFixture({
            id: "implementation",
            runId: "run_summary",
            acceptedHead: "candidate-sha",
            result: {
              implementation: {
                summary: "done <img src=x onerror=alert(1)>",
                validation: [{ command: "npm test", output: "<b>bad</b>" }],
                pullRequest: {
                  number: 99,
                  html_url: "https://github.com/zorkian/roundhouse/pull/99",
                },
              },
            },
            routing: {
              provider: "openai",
              model: "test-model",
              protocol: "openai-responses",
              thinkingLevel: "low",
              runtime,
              rule: "implementation-default-v1",
            },
          }),
        ],
        usage: [
          {
            callId: "call-1",
            attemptId: "implementation",
            model: "test-model",
            inputTokens: 100,
            cachedInputTokens: 40,
            outputTokens: 20,
            totalTokens: 120,
            costUsd: 0.01,
          },
        ],
        events: [
          {
            attemptId: "implementation",
            kind: "workflow_transition",
            payload: { fromNodeId: "implement", toNodeId: "review" },
            createdAt: 2,
          },
        ],
      }),
    );

    expect(html).toContain(
      "<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>",
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;b&gt;bad&lt;/b&gt;");
    expect(html).toContain("120 tokens");
    expect(html).toContain("test-model");
    expect(html).toContain(
      "https://github.com/zorkian/roundhouse/pull/99/files",
    );
    expect(html).toContain("Workflow evidence");
    expect(html).toContain("fromNodeId");
  });

  it("orders collapsed attempts chronologically", () => {
    const html = renderRunDetails(
      detailsFixture({
        attempts: [
          attemptFixture({
            id: "later",
            stage: "review",
            createdAt: Date.UTC(2026, 0, 2),
            updatedAt: Date.UTC(2026, 0, 2) + 65_000,
          }),
          attemptFixture({
            id: "earlier",
            createdAt: Date.UTC(2026, 0, 1),
            updatedAt: Date.UTC(2026, 0, 1) + 65_000,
          }),
        ],
      }),
    );

    expect(html.indexOf(">implement</span>")).toBeLessThan(
      html.indexOf(">review</span>"),
    );
    expect(html).toContain("1m 5s");
    expect(html.match(/<details class="attempt">/g)).toHaveLength(2);
    expect(html).not.toContain("<details open");
  });

  it("shows effective authority and typed reconciliation outcomes", () => {
    const head = "b".repeat(40);
    const html = renderRunDetails(
      detailsFixture({
        run: { id: "run_reconciliation", currentHead: head },
        attempts: [
          attemptFixture({
            id: "run_reconciliation_rev_1",
            runId: "run_reconciliation",
            nodeId: "integrate",
            executor: "validate",
            stage: "integrate",
            capabilities: [
              "repository.read",
              "artifact.write",
              "commands.execute",
            ],
            acceptedHead: head,
            outcome: {
              kind: "branch_superseded",
              source: "checkpoint_publisher",
              status: 409,
              detail: `publish_branch_changed:${head}`,
              observedHead: head,
            },
          }),
        ],
      }),
    );

    expect(html).toContain("Effective capabilities");
    expect(html).toContain("artifact.write");
    expect(html).toContain("Executor outcome");
    expect(html).toContain("branch_superseded");
  });

  it("uses the investigate label across classifications and locations", () => {
    for (const requestClassification of ["feature", "maintenance", "bug"]) {
      const html = renderRunDetails(
        detailsFixture({
          run: {
            stage: "reproduce",
            profile: {
              sourcePath: ".roundhouse/profile.yaml",
              sourceCommit: "c".repeat(40),
              version: 1,
              hash: "e".repeat(64),
              paths: {
                allowed: ["**"],
                protected: [".github/workflows/**"],
              },
            },
          },
          attempts: [
            attemptFixture({
              stage: "reproduce",
              result: {
                requestClassification,
                reproduction: { status: "confirmed" },
              },
            }),
          ],
        }),
      );

      expect(html).toContain("<dt>Current stage</dt><dd>investigate</dd>");
      expect(html).toContain('<span class="phase">investigate</span>');
      expect(html).toContain(
        "<h3>Latest attempt · investigate · completed</h3>",
      );
      expect(html).not.toContain("Current behavior");
      expect(html).not.toContain("Reproduction");
      expect(html).toContain("<dt>Allowed paths</dt>");
      expect(html).toContain("<dt>Protected paths</dt>");
      expect(html).toContain(".github/workflows/**");
    }
  });

  it("links to the immutable workflow used by this run", () => {
    const html = renderRunDetails(
      detailsFixture({
        run: {
          profile: {
            sourcePath: ".roundhouse/profile.yaml",
            sourceCommit: workflowCommit,
            version: 1,
            hash: "e".repeat(64),
            workflow,
            paths: { allowed: ["**"], protected: [] },
          },
        },
      }),
    );

    expect(html).toContain(
      '<a href="/repositories/zorkian/roundhouse/issues/281/workflow">View workflow for this run</a>',
    );
  });

  it("separates recovered executions and their usage", () => {
    const html = renderRunDetails(
      detailsFixture({
        run: { id: "run_recovered", status: "succeeded", revision: 13 },
        createdAt: 1_000,
        updatedAt: 9_000,
        attempts: [
          attemptFixture({
            id: "implementation",
            runId: "run_recovered",
            runRevision: 13,
            createdAt: 1_000,
            updatedAt: 9_000,
          }),
        ],
        events: [
          {
            attemptId: "implementation",
            kind: "attempt_progress",
            payload: { phase: "workspace_started" },
            createdAt: 2_000,
          },
          {
            attemptId: "implementation",
            kind: "attempt_lease_expired",
            payload: {},
            createdAt: 4_000,
          },
          {
            attemptId: "implementation",
            kind: "attempt_progress",
            payload: { phase: "workspace_started" },
            createdAt: 5_000,
          },
        ],
        usage: [
          {
            callId: "before",
            attemptId: "implementation",
            model: "model-a",
            totalTokens: 150,
            costUsd: 0.015,
            createdAt: 3_000,
          },
          {
            callId: "after",
            attemptId: "implementation",
            model: "model-b",
            totalTokens: 500,
            costUsd: 0.05,
            createdAt: 6_000,
          },
        ],
      }),
    );

    // Rendered in the outcome section and inside the attempt record.
    expect(html.match(/class="execution"/g)).toHaveLength(4);
    expect(html).toContain("Interrupted");
    expect(html).toContain("Restarted · Completed");
    expect(html).toContain("150 tokens");
    expect(html).toContain("500 tokens");
    expect(html).toContain("650 tokens");
  });

  it("derives execution status from both attempt and run state", () => {
    const cases = [
      {
        state: "dispatched" as const,
        runStatus: "active" as const,
        expected: "<dt>State</dt><dd>Active</dd>",
      },
      {
        state: "failed" as const,
        runStatus: "active" as const,
        expected: "<dt>Outcome</dt><dd>Failed</dd>",
      },
      {
        state: "dispatched" as const,
        runStatus: "cancelled" as const,
        expected: "<dt>Outcome</dt><dd>Cancelled</dd>",
      },
    ];
    for (const item of cases) {
      const html = renderRunDetails(
        detailsFixture({
          run: { status: item.runStatus },
          attempts: [attemptFixture({ state: item.state })],
          events: [
            {
              attemptId: "attempt",
              kind: "attempt_progress",
              payload: { phase: "workspace_started" },
              createdAt: 2,
            },
          ],
          updatedAt: 5,
        }),
      );
      expect(html).toContain(item.expected);
    }
  });

  it("distinguishes candidate, integration, and accepted merge heads", () => {
    const candidate = "b".repeat(40);
    const base = "c".repeat(40);
    const integration = "d".repeat(40);
    const html = renderRunDetails(
      detailsFixture({
        run: {
          status: "failed",
          stage: "merge",
          currentHead: integration,
          candidateHead: candidate,
          reviewedHead: candidate,
          targetBaseHead: base,
          integrationHead: integration,
        },
        attempts: [
          attemptFixture({
            kind: "external",
            stage: "merge",
            role: "github-merge",
            state: "failed",
            expectedHead: integration,
          }),
        ],
      }),
    );

    expect(html).toContain("<dt>Authored candidate head</dt>");
    expect(html).toContain("<dt>Target base head</dt>");
    expect(html).toContain("<dt>Validated integration head</dt>");
    expect(html).toContain(
      "<dt>Accepted head</dt><dd><code>Unavailable</code></dd>",
    );
  });

  it("shows outcome before attempts and diagnostics after them", () => {
    const html = renderRunDetails(
      detailsFixture({
        run: { status: "failed", stage: "implement" },
        attempts: [
          attemptFixture({
            id: "failed-attempt",
            state: "failed",
            outcome: {
              kind: "checkpoint_rejected",
              source: "checkpoint_validator",
              status: 422,
              detail: "push rejected",
            },
            result: { implementation: { summary: "failed" } },
          }),
        ],
        events: [
          {
            attemptId: "failed-attempt",
            kind: "workflow_review_fanout",
            payload: { reviewers: ["a"] },
            createdAt: 2,
          },
        ],
      }),
    );

    const outcome = html.indexOf("<h2>Outcome</h2>");
    const history = html.indexOf("<h2>Attempt history</h2>");
    const diagnostics = html.indexOf("<h2>Diagnostics</h2>");
    expect(outcome).toBeGreaterThan(-1);
    expect(outcome).toBeLessThan(history);
    expect(history).toBeLessThan(diagnostics);
    expect(html.indexOf("push rejected")).toBeLessThan(history);
    expect(html).toContain("Executor outcome");
    // Review fan-out evidence stays available but below the outcome.
    expect(html.indexOf("Review workflow evidence")).toBeGreaterThan(history);
    // Run-level commit bookkeeping moved out of the top summary.
    expect(html.indexOf("Authored candidate head")).toBeGreaterThan(history);
    expect(html).not.toContain("<details open");
  });

  it("omits the pull request row when no valid pull request URL exists", () => {
    const without = renderRunDetails(detailsFixture({}));
    expect(without).not.toContain("<dt>Pull request</dt>");
    expect(without).not.toContain("<h2>Outcome</h2>");

    const withPr = renderRunDetails(
      detailsFixture({
        attempts: [
          attemptFixture({
            result: {
              implementation: {
                pullRequest: {
                  number: 5,
                  html_url: "https://github.com/zorkian/roundhouse/pull/5",
                },
              },
            },
          }),
        ],
      }),
    );
    expect(withPr).toContain("<dt>Pull request</dt>");
    expect(withPr).toContain("Pull request #5");
  });

  it("omits related links when the pull request object has no valid URL", () => {
    const html = renderRunDetails(
      detailsFixture({
        run: { status: "failed", stage: "implement" },
        attempts: [
          attemptFixture({
            id: "invalid-pr-attempt",
            state: "failed",
            outcome: {
              kind: "checkpoint_rejected",
              source: "checkpoint_validator",
              status: 422,
              detail: "push rejected",
            },
            result: {
              implementation: { pullRequest: { number: 7 } },
            },
          }),
        ],
      }),
    );
    expect(html).not.toContain("Related links");
    expect(html).toContain("Executor outcome");
  });

  it("shows the last completed stage result when the latest attempt has none", () => {
    const html = renderRunDetails(
      detailsFixture({
        run: { status: "active", stage: "review" },
        attempts: [
          attemptFixture({
            id: "completed",
            stage: "implement",
            createdAt: 1,
            updatedAt: 2,
            result: { implementation: { summary: "stage finished" } },
          }),
          attemptFixture({
            id: "dispatched",
            stage: "review",
            state: "dispatched",
            createdAt: 3,
            updatedAt: 3,
          }),
        ],
      }),
    );

    expect(html).toContain("<h2>Outcome</h2>");
    expect(html).toContain("Last completed stage");
    expect(html.indexOf("stage finished")).toBeLessThan(
      html.indexOf("<h2>Attempt history</h2>"),
    );
  });

  it("includes the latest execution summary in the outcome section", () => {
    const html = renderRunDetails(
      detailsFixture({
        run: { status: "failed" },
        attempts: [attemptFixture({ id: "attempt", state: "failed" })],
        events: [
          {
            attemptId: "attempt",
            kind: "attempt_progress",
            payload: { phase: "workspace_started" },
            createdAt: 2,
          },
        ],
      }),
    );

    const outcome = html.indexOf("<h2>Outcome</h2>");
    const history = html.indexOf("<h2>Attempt history</h2>");
    expect(outcome).toBeGreaterThan(-1);
    const executions = html.indexOf("<h4>Executions</h4>");
    expect(executions).toBeGreaterThan(outcome);
    expect(executions).toBeLessThan(history);
  });

  it("surfaces the waiting reason in the outcome section", () => {
    const html = renderRunDetails(
      detailsFixture({
        run: { status: "waiting", waitingReason: "plan_approval" },
      }),
    );
    expect(html).toContain("<h2>Outcome</h2>");
    expect(html).toContain("<dt>Waiting on</dt><dd>plan approval</dd>");
  });
});

describe("run details competitions", () => {
  it("renders candidates, scores, winner, judge, and usage for a competition", () => {
    const judgement = {
      selected: "alpha",
      scores: [
        {
          candidateId: "alpha",
          score: 9,
          rationale: "Stronger <b>analysis</b>",
        },
        { candidateId: "beta", score: 6, rationale: "Weaker analysis" },
      ],
    };
    const html = renderRunDetails(
      detailsFixture({
        run: {
          profile: {
            sourcePath: ".roundhouse/profile.yaml",
            sourceCommit: "c".repeat(40),
            version: 1,
            hash: "d".repeat(64),
            paths: { allowed: ["**"], protected: [] },
            workflow: {
              sourcePath: ".roundhouse/workflow.yaml",
              sourceCommit: "c".repeat(40),
              version: 1,
              hash: "e".repeat(64),
              triggers: { "github.issue.started": "qualify" },
              nodes: {
                qualify: {
                  executor: "agent.read",
                  role: "qualify",
                  agent: {
                    task: "qualification",
                    inputs: { issue: "trigger.issue" },
                    result: {
                      key: "qualification",
                      schema: "roundhouse.qualification.v1",
                    },
                    competition: {
                      candidates: [
                        {
                          id: "alpha",
                          model: { id: "openai/gpt-alpha", reasoning: "low" },
                        },
                        {
                          id: "beta",
                          model: {
                            id: "anthropic/claude-beta",
                            reasoning: "medium",
                          },
                        },
                      ],
                      judge: {
                        model: { id: "openai/gpt-judge", reasoning: "high" },
                      },
                    },
                  },
                  capabilities: [],
                  outputs: ["qualification.classification"],
                  transitions: [{ terminal: "succeeded" }],
                },
              },
            },
          } as never,
        },
        attempts: [
          attemptFixture({
            id: "candidate-alpha",
            nodeId: "qualify",
            stage: "qualify",
            role: "qualify-candidate-alpha",
            competition: { purpose: "candidate", candidateId: "alpha" },
            routing: {
              provider: "openai",
              model: "gpt-alpha-actual",
              protocol: "openai-responses",
              thinkingLevel: "low",
              runtime,
              rule: "configured",
            },
          }),
          attemptFixture({
            id: "candidate-beta",
            nodeId: "qualify",
            stage: "qualify",
            role: "qualify-candidate-beta",
            competition: { purpose: "candidate", candidateId: "beta" },
          }),
          attemptFixture({
            id: "judge",
            nodeId: "qualify",
            stage: "qualify",
            role: "qualify-judge",
            competition: { purpose: "judge" },
            routing: {
              provider: "openai",
              model: "gpt-judge-actual",
              protocol: "openai-responses",
              thinkingLevel: "high",
              runtime,
              rule: "configured",
            },
          }),
          attemptFixture({
            id: "canonical",
            nodeId: "qualify",
            stage: "qualify",
            role: "qualify",
            competition: {
              purpose: "selected",
              candidateId: "alpha",
              judgement,
            },
          }),
        ],
        usage: [
          {
            callId: "c1",
            attemptId: "candidate-alpha",
            model: "gpt-alpha-actual",
            totalTokens: 100,
            costUsd: 0.01,
          },
          {
            callId: "c2",
            attemptId: "candidate-beta",
            model: "claude-beta",
            totalTokens: 200,
            costUsd: 0.02,
          },
          {
            callId: "c3",
            attemptId: "judge",
            model: "gpt-judge-actual",
            totalTokens: 50,
            costUsd: 0.03,
          },
        ],
      }),
    );
    expect(html).toContain("Model competitions");
    expect(html).toContain("Selected");
    expect(html).toContain("openai/gpt-alpha (low)");
    expect(html).toContain("anthropic/claude-beta (medium)");
    expect(html).toContain("gpt-alpha-actual");
    expect(html).toContain("Stronger &lt;b&gt;analysis&lt;/b&gt;");
    expect(html).toContain("openai/gpt-judge (high)");
    expect(html).toContain("gpt-judge-actual");
    expect(html).toContain("alpha");
    // Candidate and judge usage stay separate; run total includes all calls.
    expect(html).toContain("100 tokens · $0.01");
    expect(html).toContain("50 tokens · $0.03");
    expect(html).toContain("350 tokens · $0.06");
  });

  it("does not render a competition section for ordinary single-model runs", () => {
    const html = renderRunDetails(
      detailsFixture({ attempts: [attemptFixture({ id: "ordinary" })] }),
    );
    expect(html).not.toContain("Model competitions");
  });
});
