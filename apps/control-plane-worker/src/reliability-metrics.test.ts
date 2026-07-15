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
CREATE TABLE github_planning_jobs(job_id TEXT PRIMARY KEY, roundhouse_environment TEXT, repository_full_name TEXT, issue_number INTEGER, actor_id TEXT, command_json TEXT, created_at TEXT);
CREATE TABLE self_development_runs(run_id TEXT PRIMARY KEY, state TEXT, payload TEXT);
CREATE TABLE independent_reviews(review_id TEXT PRIMARY KEY, run_id TEXT, cycle INTEGER, status TEXT, attempt_count INTEGER, created_at TEXT, updated_at TEXT);
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
      "INSERT INTO github_planning_jobs VALUES ('job_start', 'development', 'zorkian/roundhouse', 83, 'github:zorkian', '{\"kind\":\"start\"}', '2026-07-15T00:00:00.000Z')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO github_planning_jobs VALUES ('job_replan', 'development', 'zorkian/roundhouse', 83, 'github:zorkian', '{\"kind\":\"replan\"}', '2026-07-15T00:00:30.000Z')",
    )
    .run();
  const run = {
    schemaVersion: 1,
    runId: "run_metrics",
    state: "completed",
    attempts: [
      {
        stage: "implement",
        startedAt: "2026-07-15T00:03:00.000Z",
        completedAt: "2026-07-15T00:04:00.000Z",
      },
      {
        stage: "implement",
        classification: "validation_failed",
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
      "INSERT INTO independent_reviews VALUES ('review_metrics', 'run_metrics', 2, 'completed', 1, '2026-07-15T00:07:00.000Z', '2026-07-15T00:08:00.000Z')",
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
