// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import {
  consumeTrustedExecutionDelivery,
  runTrustedExecutionWorkflow,
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
});

beforeEach(async () => {
  await database.prepare("DELETE FROM trusted_execution_workflows").run();
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
