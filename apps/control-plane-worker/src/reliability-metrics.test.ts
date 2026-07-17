// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import {
  markManualFallback,
  reliabilitySummary,
} from "./reliability-metrics.js";

let instance: Miniflare;
let db: D1Database;

const schema = `
CREATE TABLE github_issue_plans(plan_id TEXT PRIMARY KEY, issue_number INTEGER, revision INTEGER, status TEXT, plan_sha256 TEXT, approved_at TEXT, run_id TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE github_planning_jobs(job_id TEXT PRIMARY KEY, roundhouse_environment TEXT, repository_full_name TEXT, issue_number INTEGER, actor_id TEXT, command_json TEXT, status TEXT, attempt_count INTEGER, failure_reason TEXT, created_at TEXT);
CREATE TABLE self_development_runs(run_id TEXT PRIMARY KEY, state TEXT, payload TEXT);
CREATE TABLE independent_reviews(review_id TEXT PRIMARY KEY, run_id TEXT, cycle INTEGER, status TEXT, attempt_count INTEGER, payload TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE github_ci_outcomes(repository_full_name TEXT, pull_request_number INTEGER, observed_at TEXT, status TEXT, conclusion TEXT);
CREATE TABLE github_plan_events(event_id TEXT PRIMARY KEY, plan_id TEXT, sequence INTEGER, event_type TEXT, actor_id TEXT, detail_json TEXT, occurred_at TEXT, UNIQUE(plan_id, sequence));
CREATE TABLE github_webhook_deliveries(delivery_id TEXT PRIMARY KEY, repository_full_name TEXT, payload_sha256 TEXT);
CREATE TABLE operator_mutations(idempotency_key TEXT PRIMARY KEY, run_id TEXT, action TEXT, actor_id TEXT, status TEXT);
`;

function env(): ControlPlaneEnv {
  return { DB: db } as ControlPlaneEnv;
}

beforeAll(async () => {
  instance = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "reliability-local" },
  });
  db = await instance.getD1Database("DB");
  for (const statement of schema
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
});

beforeEach(async () => {
  for (const table of [
    "github_plan_events",
    "operator_mutations",
    "github_webhook_deliveries",
    "github_ci_outcomes",
    "independent_reviews",
    "self_development_runs",
    "github_planning_jobs",
    "github_issue_plans",
  ])
    await db.prepare(`DELETE FROM ${table}`).run();
});

afterAll(async () => instance.dispose());

async function seedCompleted() {
  const planSha = "a".repeat(64);
  await db
    .prepare(
      "INSERT INTO github_issue_plans VALUES ('plan_metrics', 83, 1, 'materialized', ?, '2026-07-15T00:02:00.000Z', 'run_metrics', '2026-07-15T00:01:00.000Z', '2026-07-15T00:10:00.000Z')",
    )
    .bind(planSha)
    .run();
  await db
    .prepare(
      "INSERT INTO github_planning_jobs VALUES ('job_start', 'development', 'zorkian/roundhouse', 83, 'github:zorkian', '{\"kind\":\"start\"}', 'completed', 1, NULL, '2026-07-15T00:00:00.000Z')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO github_planning_jobs VALUES ('job_replan', 'development', 'zorkian/roundhouse', 83, 'github:zorkian', '{\"kind\":\"replan\"}', 'completed', 2, NULL, '2026-07-15T00:00:30.000Z')",
    )
    .run();
  const run = {
    schemaVersion: 1,
    runId: "run_metrics",
    state: "completed",
    attempts: [
      {
        attemptId: "run_metrics-implement-1",
        stage: "implement",
        number: 1,
        status: "failed",
        classification: "validation_failed",
        startedAt: "2026-07-15T00:03:00.000Z",
        completedAt: "2026-07-15T00:04:00.000Z",
      },
      {
        attemptId: "run_metrics-implement-2",
        stage: "implement",
        number: 2,
        status: "succeeded",
        startedAt: "2026-07-15T00:04:00.000Z",
        completedAt: "2026-07-15T00:05:00.000Z",
      },
    ],
    events: [
      { state: "awaiting_approval", occurredAt: "2026-07-15T00:05:00.000Z" },
    ],
    approval: { approvedAt: "2026-07-15T00:06:00.000Z" },
    publication: {
      verifiedAt: "2026-07-15T00:07:00.000Z",
      pullRequestUrl: "https://github.com/zorkian/roundhouse/pull/99",
    },
  };
  await db
    .prepare(
      "INSERT INTO self_development_runs VALUES ('run_metrics', 'completed', ?)",
    )
    .bind(JSON.stringify(run))
    .run();
  await db
    .prepare(
      "INSERT INTO github_ci_outcomes VALUES ('zorkian/roundhouse', 99, '2026-07-15T00:08:00.000Z', 'in_progress', NULL), ('zorkian/roundhouse', 99, '2026-07-15T00:09:00.000Z', 'completed', 'success')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO independent_reviews VALUES ('review_metrics', 'run_metrics', 2, 'completed', 1, '{}', '2026-07-15T00:07:00.000Z', '2026-07-15T00:08:00.000Z')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO github_plan_events VALUES ('plan_metrics:1', 'plan_metrics', 1, 'plan.proposed', 'github:zorkian', '{}', '2026-07-15T00:01:00.000Z')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO github_webhook_deliveries VALUES ('delivery_1', 'zorkian/roundhouse', 'same'), ('delivery_2', 'zorkian/roundhouse', 'same')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO operator_mutations VALUES ('retry_once', 'run_metrics', 'retry', 'github:zorkian', 'completed')",
    )
    .run();
  return planSha;
}

describe("V1 pilot reliability metrics", () => {
  it("summarizes successful retried, replanned, and remediated workflows deterministically", async () => {
    await seedCompleted();
    const first = await reliabilitySummary(
      env(),
      "development",
      "zorkian/roundhouse",
    );
    const second = await reliabilitySummary(
      env(),
      "development",
      "zorkian/roundhouse",
    );
    expect(second).toEqual(first);
    expect(first.counts.duplicateDeliveries).toBe(1);
    expect(first.workflows[0]).toMatchObject({
      environment: "development",
      workflowId: "development:zorkian/roundhouse#83",
      counts: {
        retries: 1,
        replans: 1,
        remediationCycles: 1,
        duplicateDeliveries: 0,
      },
      terminal: { status: "terminal", outcome: "succeeded" },
      modelPhases: {
        planning: {
          attempts: 3,
          terminal: { status: "terminal", outcome: "succeeded" },
        },
        implementation: {
          attempts: 2,
          terminal: { status: "terminal", outcome: "succeeded" },
        },
        independentReview: {
          attempts: 1,
          terminal: { status: "terminal", outcome: "succeeded" },
        },
      },
    });
    expect(first.workflows[0]?.durations.startToPlan).toEqual({
      status: "available",
      milliseconds: 60_000,
    });
    expect(first.workflows[0]?.durations.ci).toEqual({
      status: "available",
      milliseconds: 60_000,
    });
  });

  it("keeps failed and incomplete legacy workflows readable", async () => {
    await db
      .prepare(
        "INSERT INTO github_issue_plans VALUES ('plan_legacy', 7, 1, 'materialized', ?, NULL, 'run_legacy', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z')",
      )
      .bind("b".repeat(64))
      .run();
    await db
      .prepare(
        "INSERT INTO self_development_runs VALUES ('run_legacy', 'failed', ?)",
      )
      .bind(
        JSON.stringify({
          state: "failed",
          attempts: [{ classification: "unknown-secret-value" }],
          events: [],
        }),
      )
      .run();
    const value = await reliabilitySummary(
      env(),
      "development",
      "zorkian/roundhouse",
    );
    expect(value.workflows[0]?.durations.approvalToDraftPullRequest).toEqual({
      status: "unavailable",
    });
    expect(value.workflows[0]?.terminal).toEqual({
      status: "terminal",
      outcome: "failed",
      failureClass: "other",
    });
    expect(value.workflows[0]?.modelPhases).toEqual({
      planning: { attempts: 0, terminal: { status: "unavailable" } },
      implementation: {
        attempts: 0,
        terminal: { status: "unavailable" },
      },
      independentReview: {
        attempts: 0,
        terminal: { status: "unavailable" },
      },
    });
  });

  it("reports bounded deterministic planning failures and incomplete work", async () => {
    await db
      .prepare(
        "INSERT INTO github_issue_plans VALUES ('plan_failed', 9, 1, 'rejected', ?, NULL, NULL, '2026-07-15T00:00:00.000Z', '2026-07-15T00:01:00.000Z'), ('plan_incomplete', 10, 1, 'proposed', ?, NULL, NULL, '2026-07-15T00:02:00.000Z', '2026-07-15T00:02:00.000Z')",
      )
      .bind("c".repeat(64), "d".repeat(64))
      .run();
    await db
      .prepare(
        "INSERT INTO github_planning_jobs VALUES ('job_failed', 'development', 'zorkian/roundhouse', 9, 'github:zorkian', '{\"kind\":\"start\"}', 'failed', 1, 'Container failed: planning_invalid_structured_output raw-content-must-not-leak', '2026-07-15T00:00:00.000Z'), ('job_running', 'development', 'zorkian/roundhouse', 10, 'github:zorkian', '{\"kind\":\"start\"}', 'running', 1, NULL, '2026-07-15T00:02:00.000Z')",
      )
      .run();

    const value = await reliabilitySummary(
      env(),
      "development",
      "zorkian/roundhouse",
    );
    const failed = value.workflows.find(
      (workflow) => workflow.issueNumber === 9,
    );
    const incomplete = value.workflows.find(
      (workflow) => workflow.issueNumber === 10,
    );
    expect(failed?.modelPhases).toEqual({
      planning: {
        attempts: 1,
        terminal: {
          status: "terminal",
          outcome: "failed",
          classification: "planning_invalid_structured_output",
        },
      },
      implementation: {
        attempts: 0,
        terminal: { status: "unavailable" },
      },
      independentReview: {
        attempts: 0,
        terminal: { status: "unavailable" },
      },
    });
    expect(JSON.stringify(failed)).not.toContain("raw-content-must-not-leak");
    expect(incomplete?.modelPhases.planning).toEqual({
      attempts: 1,
      terminal: { status: "nonterminal" },
    });
    expect(incomplete?.terminal).toEqual({ status: "nonterminal" });
  });

  it("keeps implementation and review classifications phase-bound", async () => {
    await db
      .prepare(
        "INSERT INTO github_issue_plans VALUES ('plan_phase_failure', 11, 1, 'materialized', ?, NULL, 'run_phase_failure', '2026-07-15T00:00:00.000Z', '2026-07-15T00:04:00.000Z')",
      )
      .bind("e".repeat(64))
      .run();
    await db
      .prepare(
        "INSERT INTO self_development_runs VALUES ('run_phase_failure', 'failed', ?)",
      )
      .bind(
        JSON.stringify({
          state: "failed",
          attempts: [
            {
              attemptId: "run_phase_failure-implement-1",
              stage: "implement",
              number: 1,
              status: "failed",
              classification: "validation_failed",
              startedAt: "2026-07-15T00:01:00.000Z",
              completedAt: "2026-07-15T00:02:00.000Z",
            },
          ],
          events: [],
        }),
      )
      .run();
    await db
      .prepare(
        "INSERT INTO independent_reviews VALUES ('review_phase_failure', 'run_phase_failure', 1, 'failed', 2, ?, '2026-07-15T00:02:00.000Z', '2026-07-15T00:04:00.000Z')",
      )
      .bind(
        JSON.stringify({
          failureClassification: "review_workflow_exhausted",
          failureReason: "raw-review-detail-must-not-leak",
        }),
      )
      .run();

    const value = await reliabilitySummary(
      env(),
      "development",
      "zorkian/roundhouse",
    );
    const workflow = value.workflows[0];
    expect(workflow?.modelPhases).toEqual({
      planning: { attempts: 0, terminal: { status: "unavailable" } },
      implementation: {
        attempts: 1,
        terminal: {
          status: "terminal",
          outcome: "failed",
          classification: "validation_failed",
        },
      },
      independentReview: {
        attempts: 2,
        terminal: {
          status: "terminal",
          outcome: "failed",
          classification: "review_workflow_exhausted",
        },
      },
    });
    expect(JSON.stringify(workflow)).not.toContain(
      "raw-review-detail-must-not-leak",
    );
  });

  it("reports trusted prepare-stage implementation and repair attempts separately", async () => {
    await db
      .prepare(
        "INSERT INTO github_issue_plans VALUES ('plan_trusted_repair', 12, 1, 'materialized', ?, NULL, 'run_trusted_repair', '2026-07-15T01:00:00.000Z', '2026-07-15T01:04:00.000Z')",
      )
      .bind("f".repeat(64))
      .run();
    await db
      .prepare(
        "INSERT INTO self_development_runs VALUES ('run_trusted_repair', 'awaiting_approval', ?)",
      )
      .bind(
        JSON.stringify({
          state: "awaiting_approval",
          attempts: [
            {
              attemptId: "run_trusted_repair-prepare-1",
              stage: "prepare",
              number: 1,
              status: "failed",
              retryable: false,
              automaticRepair: true,
              classification: "validation_failed",
              startedAt: "2026-07-15T01:01:00.000Z",
              completedAt: "2026-07-15T01:02:00.000Z",
            },
            {
              attemptId: "run_trusted_repair-prepare-2",
              stage: "prepare",
              number: 2,
              status: "succeeded",
              startedAt: "2026-07-15T01:02:00.000Z",
              completedAt: "2026-07-15T01:04:00.000Z",
            },
          ],
          events: [
            {
              state: "awaiting_approval",
              occurredAt: "2026-07-15T01:04:00.000Z",
            },
          ],
        }),
      )
      .run();

    const value = await reliabilitySummary(
      env(),
      "development",
      "zorkian/roundhouse",
    );
    const workflow = value.workflows.find(
      (candidate) => candidate.issueNumber === 12,
    );
    expect(workflow).toMatchObject({
      counts: {
        implementationAttempts: 2,
        repairAttempts: 1,
        retries: 0,
      },
      durations: {
        implementation: { status: "available", milliseconds: 180_000 },
      },
      modelPhases: {
        implementation: {
          attempts: 2,
          terminal: { status: "terminal", outcome: "succeeded" },
        },
      },
    });
  });

  it("records one actor-bound manual fallback and reports it", async () => {
    const planSha = await seedCompleted();
    const input = {
      planId: "plan_metrics",
      expectedRevision: 1,
      planSha256: planSha,
      actorId: "github:zorkian",
      now: new Date("2026-07-15T00:09:00.000Z"),
    };
    await markManualFallback(env(), input);
    await markManualFallback(env(), input);
    const events = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM github_plan_events WHERE event_type = 'implementation.manual_fallback'",
      )
      .first<{ count: number }>();
    expect(events?.count).toBe(1);
    const value = await reliabilitySummary(
      env(),
      "development",
      "zorkian/roundhouse",
    );
    expect(value.workflows[0]).toMatchObject({
      manualFallbackRequired: true,
      counts: { distinctHumanActions: 4 },
    });
  });
});
