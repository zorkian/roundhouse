// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { IndependentReviewExecution } from "@roundhouse/self-development/cloudflare";

import type { ControlPlaneEnv } from "./environment.js";
import {
  consumeTrustedReviewDelivery,
  consumeTrustedExecutionDelivery,
  runTrustedReviewWorkflow,
  runTrustedExecutionWorkflow,
  trustedReviewWorkflowId,
  trustedExecutionWorkflowId,
  trustedExecutionWorkflowMigration,
  type TrustedExecutionWorkflowStepPort,
} from "./trusted-execution-workflow.js";

let instance: Miniflare;
let database: D1Database;

const delivery = {
  schemaVersion: 1 as const,
  runId: "run_trusted_workflow",
  deliveryId: "delivery_trusted_workflow_1",
  expectedRevision: 1,
};

const reviewDelivery = {
  schemaVersion: 1 as const,
  kind: "independent_review" as const,
  reviewId: `review_${"a".repeat(40)}`,
  deliveryId: `review_delivery_review_${"a".repeat(40)}_1`,
};

const reviewExecution = {
  result: {
    schemaVersion: 1,
    reviewId: reviewDelivery.reviewId,
  },
  evidence: {
    evidenceId: "review_evidence",
  },
} as unknown as IndependentReviewExecution;

function environment(created: Set<string>): ControlPlaneEnv {
  return {
    DB: database,
    RUN_QUEUE: { send: async () => undefined } as unknown as Queue<unknown>,
    TRUSTED_EXECUTION_WORKFLOW: {
      createBatch: async (batch) => {
        const added = batch.filter(({ id }) => !created.has(id));
        for (const { id } of added) created.add(id);
        return added.map(({ id }) => ({ id }));
      },
    },
    EXECUTION_MODE: "cloudflare-trusted-codex",
    ALLOWED_REPOSITORY_PATH: "/workspace/roundhouse",
    ALLOWED_REMOTE_URL: "https://github.com/zorkian/roundhouse.git",
  };
}

beforeAll(async () => {
  instance = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "trusted-execution-workflow-test" },
  });
  database = await instance.getD1Database("DB");
  for (const statement of trustedExecutionWorkflowMigration
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await database.prepare(statement).run();
  await database
    .prepare(
      "CREATE TABLE IF NOT EXISTS self_development_runs (run_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL)",
    )
    .run();
});

beforeEach(async () => {
  await database.prepare("DELETE FROM trusted_execution_workflows").run();
  await database.prepare("DELETE FROM trusted_review_workflows").run();
  await database.prepare("DELETE FROM self_development_runs").run();
  await database
    .prepare(
      "INSERT INTO self_development_runs(run_id, revision, state) VALUES (?, ?, 'created')",
    )
    .bind(delivery.runId, delivery.expectedRevision)
    .run();
});

afterAll(async () => {
  await instance.dispose();
});

describe("trusted execution Workflow dispatch", () => {
  it("derives a bounded deterministic identity from the exact delivery", async () => {
    const first = await trustedExecutionWorkflowId(delivery);
    expect(first).toMatch(/^trusted-[a-f0-9]{64}$/);
    expect(first.length).toBeLessThanOrEqual(100);
    await expect(trustedExecutionWorkflowId(delivery)).resolves.toBe(first);
    await expect(
      trustedExecutionWorkflowId({ ...delivery, expectedRevision: 2 }),
    ).resolves.not.toBe(first);
  });

  it("acknowledges duplicate Queue delivery after one durable dispatch", async () => {
    const created = new Set<string>();
    const env = environment(created);
    const outcomes: string[] = [];
    const message = () => ({
      body: delivery,
      ack: () => outcomes.push("ack"),
      retry: () => outcomes.push("retry"),
    });

    await consumeTrustedExecutionDelivery(message(), env);
    await consumeTrustedExecutionDelivery(message(), env);

    expect(outcomes).toEqual(["ack", "ack"]);
    expect(created.size).toBe(1);
    const rows = await database
      .prepare(
        "SELECT run_id, delivery_id, expected_revision, status FROM trusted_execution_workflows",
      )
      .all<{
        run_id: string;
        delivery_id: string;
        expected_revision: number;
        status: string;
      }>();
    expect(rows.results).toEqual([
      {
        run_id: delivery.runId,
        delivery_id: delivery.deliveryId,
        expected_revision: delivery.expectedRevision,
        status: "dispatched",
      },
    ]);
  });

  it("completes a scheduled delivery that loses revision ownership to an operator retry", async () => {
    const created = new Set<string>();
    const env = environment(created);
    const operatorDelivery = {
      ...delivery,
      deliveryId: "operator_retry_run_trusted_workflow_2",
      expectedRevision: 2,
    };
    await database
      .prepare("UPDATE self_development_runs SET revision = 2 WHERE run_id = ?")
      .bind(delivery.runId)
      .run();

    await consumeTrustedExecutionDelivery(
      { body: operatorDelivery, ack: () => undefined, retry: () => undefined },
      env,
    );
    await consumeTrustedExecutionDelivery(
      { body: delivery, ack: () => undefined, retry: () => undefined },
      env,
    );

    expect(created.size).toBe(1);
    const rows = await database
      .prepare(
        "SELECT expected_revision, status FROM trusted_execution_workflows ORDER BY expected_revision",
      )
      .all<{ expected_revision: number; status: string }>();
    expect(rows.results).toEqual([
      { expected_revision: 1, status: "completed" },
      { expected_revision: 2, status: "dispatched" },
    ]);
  });

  it("dispatches finalization recovery for an awaiting-publication run", async () => {
    const created = new Set<string>();
    const env = environment(created);
    const recoveryDelivery = {
      ...delivery,
      deliveryId: "recovery_run_trusted_workflow_6",
      expectedRevision: 6,
    };
    await database
      .prepare(
        "UPDATE self_development_runs SET revision = 6, state = 'awaiting_publication' WHERE run_id = ?",
      )
      .bind(delivery.runId)
      .run();

    await consumeTrustedExecutionDelivery(
      {
        body: recoveryDelivery,
        ack: () => undefined,
        retry: () => undefined,
      },
      env,
    );

    expect(created.size).toBe(1);
    await expect(
      database
        .prepare(
          "SELECT delivery_id, expected_revision, status, started_at FROM trusted_execution_workflows WHERE run_id = ?",
        )
        .bind(delivery.runId)
        .first(),
    ).resolves.toEqual({
      delivery_id: recoveryDelivery.deliveryId,
      expected_revision: recoveryDelivery.expectedRevision,
      status: "dispatched",
      started_at: null,
    });
  });

  it("completes a duplicate same-revision delivery without starting another workflow", async () => {
    const created = new Set<string>();
    const env = environment(created);
    const duplicateDelivery = {
      ...delivery,
      deliveryId: "duplicate_delivery_trusted_workflow_1",
    };

    await consumeTrustedExecutionDelivery(
      { body: delivery, ack: () => undefined, retry: () => undefined },
      env,
    );
    await consumeTrustedExecutionDelivery(
      {
        body: duplicateDelivery,
        ack: () => undefined,
        retry: () => undefined,
      },
      env,
    );

    expect(created.size).toBe(1);
    const rows = await database
      .prepare(
        "SELECT delivery_id, status, started_at FROM trusted_execution_workflows WHERE run_id = ? ORDER BY delivery_id",
      )
      .bind(delivery.runId)
      .all<{
        delivery_id: string;
        status: string;
        started_at: string | null;
      }>();
    expect(rows.results).toEqual([
      {
        delivery_id: "delivery_trusted_workflow_1",
        status: "dispatched",
        started_at: null,
      },
      {
        delivery_id: "duplicate_delivery_trusted_workflow_1",
        status: "completed",
        started_at: null,
      },
    ]);
  });
});

describe("trusted review Workflow dispatch", () => {
  it("derives a distinct deterministic identity from the exact review delivery", async () => {
    const first = await trustedReviewWorkflowId(reviewDelivery);
    expect(first).toMatch(/^review-[a-f0-9]{64}$/);
    expect(first.length).toBeLessThanOrEqual(100);
    await expect(trustedReviewWorkflowId(reviewDelivery)).resolves.toBe(first);
    await expect(
      trustedReviewWorkflowId({
        ...reviewDelivery,
        deliveryId: "review_delivery_trusted_workflow_2",
      }),
    ).resolves.not.toBe(first);
  });

  it("acknowledges duplicate review delivery after one durable dispatch", async () => {
    const created = new Set<string>();
    const env = environment(created);
    const outcomes: string[] = [];
    const message = () => ({
      body: reviewDelivery,
      ack: () => outcomes.push("ack"),
      retry: () => outcomes.push("retry"),
    });

    await consumeTrustedReviewDelivery(message(), env);
    await consumeTrustedReviewDelivery(message(), env);

    expect(outcomes).toEqual(["ack", "ack"]);
    expect(created.size).toBe(1);
    await expect(
      database
        .prepare(
          "SELECT review_id, delivery_id, status FROM trusted_review_workflows",
        )
        .first(),
    ).resolves.toEqual({
      review_id: reviewDelivery.reviewId,
      delivery_id: reviewDelivery.deliveryId,
      status: "dispatched",
    });
  });
});

describe("trusted execution Workflow lifecycle", () => {
  it("durably separates long execution from idempotent finalization", async () => {
    const created = new Set<string>();
    const env = environment(created);
    await consumeTrustedExecutionDelivery(
      { body: delivery, ack: () => undefined, retry: () => undefined },
      env,
    );
    const steps: Array<{ name: string; timeout: string | number }> = [];
    const step: TrustedExecutionWorkflowStepPort = {
      do: async (name, config, callback) => {
        steps.push({ name, timeout: config.timeout });
        return callback();
      },
    };
    let executions = 0;
    let finalizations = 0;

    const result = await runTrustedExecutionWorkflow(
      env,
      delivery,
      step,
      async () => {
        executions += 1;
        return {
          schemaVersion: 1,
          runId: delivery.runId,
          revision: 4,
          state: "awaiting_approval",
        };
      },
      async () => {
        finalizations += 1;
        return {
          schemaVersion: 1,
          runId: delivery.runId,
          revision: 4,
          state: "awaiting_approval",
        };
      },
    );

    expect(result).toMatchObject({
      runId: delivery.runId,
      revision: 4,
      state: "awaiting_approval",
    });
    expect({ executions, finalizations }).toEqual({
      executions: 1,
      finalizations: 1,
    });
    expect(steps).toEqual([
      { name: "execute trusted repository attempt", timeout: "3 hours" },
      { name: "finalize trusted repository attempt", timeout: "5 minutes" },
    ]);
    await expect(
      database
        .prepare(
          "SELECT status FROM trusted_execution_workflows WHERE run_id = ?",
        )
        .bind(delivery.runId)
        .first<{ status: string }>(),
    ).resolves.toEqual({ status: "completed" });
  });

  it("replays an interrupted execution step without duplicating finalization", async () => {
    const created = new Set<string>();
    const env = environment(created);
    await consumeTrustedExecutionDelivery(
      { body: delivery, ack: () => undefined, retry: () => undefined },
      env,
    );
    const step: TrustedExecutionWorkflowStepPort = {
      do: async (name, _config, callback) => {
        if (name !== "execute trusted repository attempt") return callback();
        try {
          return await callback();
        } catch {
          return callback();
        }
      },
    };
    let executions = 0;
    let finalizations = 0;

    await runTrustedExecutionWorkflow(
      env,
      delivery,
      step,
      async () => {
        executions += 1;
        if (executions === 1) throw new Error("simulated Worker interruption");
        return {
          schemaVersion: 1,
          runId: delivery.runId,
          revision: 6,
          state: "awaiting_approval",
        };
      },
      async () => {
        finalizations += 1;
        return {
          schemaVersion: 1,
          runId: delivery.runId,
          revision: 6,
          state: "awaiting_approval",
        };
      },
    );

    expect({ executions, finalizations }).toEqual({
      executions: 2,
      finalizations: 1,
    });
  });
});

describe("trusted review Workflow lifecycle", () => {
  it("replays an interrupted long review without duplicating finalization", async () => {
    const created = new Set<string>();
    const env = environment(created);
    await consumeTrustedReviewDelivery(
      { body: reviewDelivery, ack: () => undefined, retry: () => undefined },
      env,
    );
    const steps: string[] = [];
    const step: TrustedExecutionWorkflowStepPort = {
      do: async (name, _config, callback) => {
        steps.push(name);
        if (name !== "execute independent review") return callback();
        try {
          return await callback();
        } catch {
          return callback();
        }
      },
    };
    let executions = 0;
    let finalizations = 0;
    let failures = 0;

    const result = await runTrustedReviewWorkflow(
      env,
      reviewDelivery,
      step,
      async () => {
        executions += 1;
        if (executions === 1)
          throw new Error("simulated mid-review Worker interruption");
        return reviewExecution;
      },
      async () => {
        finalizations += 1;
        return {
          schemaVersion: 1,
          reviewId: reviewDelivery.reviewId,
          revision: 4,
          status: "completed",
        };
      },
      async () => {
        failures += 1;
        return {
          schemaVersion: 1,
          reviewId: reviewDelivery.reviewId,
          revision: 4,
          status: "failed",
        };
      },
    );

    expect(result.status).toBe("completed");
    expect({ executions, finalizations, failures }).toEqual({
      executions: 2,
      finalizations: 1,
      failures: 0,
    });
    expect(steps).toEqual([
      "execute independent review",
      "finalize independent review",
    ]);
    await expect(
      database
        .prepare(
          "SELECT status FROM trusted_review_workflows WHERE review_id = ?",
        )
        .bind(reviewDelivery.reviewId)
        .first(),
    ).resolves.toEqual({ status: "completed" });
  });
});
