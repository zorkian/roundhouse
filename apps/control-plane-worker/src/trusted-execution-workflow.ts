// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  reviewDeliverySchema,
  runDeliverySchema,
  type DeliveryMessage,
  type IndependentReviewExecution,
  type ReviewDelivery,
  type RunDelivery,
} from "@roundhouse/self-development/cloudflare";

import type { ControlPlaneEnv } from "./environment.js";

export const trustedExecutionWorkflowMigration = `
CREATE TABLE IF NOT EXISTS trusted_execution_workflows (
  workflow_instance_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatched', 'running', 'completed', 'failed')),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE (run_id, delivery_id)
);
CREATE INDEX IF NOT EXISTS trusted_execution_workflows_run
  ON trusted_execution_workflows(run_id, created_at);

CREATE TABLE IF NOT EXISTS trusted_review_workflows (
  workflow_instance_id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatched', 'running', 'completed', 'failed')),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE (review_id, delivery_id)
);
CREATE INDEX IF NOT EXISTS trusted_review_workflows_review
  ON trusted_review_workflows(review_id, created_at);
`;

export type TrustedWorkflowPayload = RunDelivery | ReviewDelivery;

export type TrustedExecutionWorkflowBindingPort = {
  createBatch(
    batch: Array<{ id: string; params: TrustedWorkflowPayload }>,
  ): Promise<Array<{ id: string }>>;
};

export type TrustedExecutionWorkflowStepPort = {
  do<T>(
    name: string,
    config: {
      retries: {
        limit: number;
        delay: string | number;
        backoff: "constant" | "linear" | "exponential";
      };
      timeout: string | number;
    },
    callback: () => Promise<T>,
  ): Promise<T>;
};

export type TrustedExecutionWorkflowResult = {
  schemaVersion: 1;
  runId: string;
  revision: number;
  state: string;
};

export type TrustedReviewWorkflowResult = {
  schemaVersion: 1;
  reviewId: string;
  revision: number;
  status: string;
};

async function digest(value: string): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function trustedExecutionWorkflowId(
  input: RunDelivery,
): Promise<string> {
  const delivery = runDeliverySchema.parse(input);
  const hash = await digest(
    JSON.stringify([
      delivery.schemaVersion,
      delivery.runId,
      delivery.deliveryId,
      delivery.expectedRevision,
    ]),
  );
  return `trusted-${hash}`;
}

export async function trustedReviewWorkflowId(
  input: ReviewDelivery,
): Promise<string> {
  const delivery = reviewDeliverySchema.parse(input);
  const hash = await digest(
    JSON.stringify([
      delivery.schemaVersion,
      delivery.kind,
      delivery.reviewId,
      delivery.deliveryId,
    ]),
  );
  return `review-${hash}`;
}

export async function dispatchTrustedExecutionWorkflow(
  env: ControlPlaneEnv,
  input: RunDelivery,
): Promise<string> {
  const delivery = runDeliverySchema.parse(input);
  const binding = env.TRUSTED_EXECUTION_WORKFLOW;
  if (!binding) throw new Error("Trusted execution Workflow is not configured");
  const instanceId = await trustedExecutionWorkflowId(delivery);
  const now = new Date().toISOString();
  const reservation = await env.DB.prepare(
    `INSERT OR IGNORE INTO trusted_execution_workflows(
       workflow_instance_id, run_id, delivery_id, expected_revision, status, created_at
     ) SELECT ?, ?, ?, ?, 'pending', ?
       WHERE EXISTS (
         SELECT 1 FROM self_development_runs
          WHERE run_id = ? AND revision = ?
            AND state NOT IN ('completed', 'cancelled', 'failed')
       )`,
  )
    .bind(
      instanceId,
      delivery.runId,
      delivery.deliveryId,
      delivery.expectedRevision,
      now,
      delivery.runId,
      delivery.expectedRevision,
    )
    .run();
  if ((reservation.meta.changes ?? 0) === 0)
    await env.DB.prepare(
      `INSERT OR IGNORE INTO trusted_execution_workflows(
         workflow_instance_id, run_id, delivery_id, expected_revision, status, created_at, completed_at
       ) VALUES (?, ?, ?, ?, 'completed', ?, ?)`,
    )
      .bind(
        instanceId,
        delivery.runId,
        delivery.deliveryId,
        delivery.expectedRevision,
        now,
        now,
      )
      .run();
  const reserved = await env.DB.prepare(
    "SELECT run_id, delivery_id, expected_revision, status FROM trusted_execution_workflows WHERE workflow_instance_id = ?",
  )
    .bind(instanceId)
    .first<{
      run_id: string;
      delivery_id: string;
      expected_revision: number;
      status: "pending" | "dispatched" | "running" | "completed" | "failed";
    }>();
  if (
    !reserved ||
    reserved.run_id !== delivery.runId ||
    reserved.delivery_id !== delivery.deliveryId ||
    reserved.expected_revision !== delivery.expectedRevision
  )
    throw new Error("Trusted execution Workflow identity conflict");
  if (reserved.status === "completed") return instanceId;
  await binding.createBatch([{ id: instanceId, params: delivery }]);
  await env.DB.prepare(
    "UPDATE trusted_execution_workflows SET status = 'dispatched' WHERE workflow_instance_id = ? AND status = 'pending'",
  )
    .bind(instanceId)
    .run();
  return instanceId;
}

export async function dispatchTrustedReviewWorkflow(
  env: ControlPlaneEnv,
  input: ReviewDelivery,
): Promise<string> {
  const delivery = reviewDeliverySchema.parse(input);
  const binding = env.TRUSTED_EXECUTION_WORKFLOW;
  if (!binding) throw new Error("Trusted execution Workflow is not configured");
  const instanceId = await trustedReviewWorkflowId(delivery);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO trusted_review_workflows(
       workflow_instance_id, review_id, delivery_id, status, created_at
     ) VALUES (?, ?, ?, 'pending', ?)`,
  )
    .bind(instanceId, delivery.reviewId, delivery.deliveryId, now)
    .run();
  const reserved = await env.DB.prepare(
    "SELECT review_id, delivery_id FROM trusted_review_workflows WHERE workflow_instance_id = ?",
  )
    .bind(instanceId)
    .first<{ review_id: string; delivery_id: string }>();
  if (
    !reserved ||
    reserved.review_id !== delivery.reviewId ||
    reserved.delivery_id !== delivery.deliveryId
  )
    throw new Error("Trusted review Workflow identity conflict");
  await binding.createBatch([{ id: instanceId, params: delivery }]);
  await env.DB.prepare(
    "UPDATE trusted_review_workflows SET status = 'dispatched' WHERE workflow_instance_id = ? AND status = 'pending'",
  )
    .bind(instanceId)
    .run();
  return instanceId;
}

export async function readTrustedReviewWorkflows(
  env: ControlPlaneEnv,
  reviewId: string,
): Promise<
  Array<{
    workflowInstanceId: string;
    deliveryId: string;
    status: "pending" | "dispatched" | "running" | "completed" | "failed";
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
  }>
> {
  const rows = await env.DB.prepare(
    "SELECT workflow_instance_id, delivery_id, status, created_at, started_at, completed_at FROM trusted_review_workflows WHERE review_id = ? ORDER BY created_at, workflow_instance_id",
  )
    .bind(reviewId)
    .all<{
      workflow_instance_id: string;
      delivery_id: string;
      status: "pending" | "dispatched" | "running" | "completed" | "failed";
      created_at: string;
      started_at: string | null;
      completed_at: string | null;
    }>();
  return rows.results.map((row) => ({
    workflowInstanceId: row.workflow_instance_id,
    deliveryId: row.delivery_id,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  }));
}

export async function readTrustedExecutionWorkflows(
  env: ControlPlaneEnv,
  runId: string,
): Promise<
  Array<{
    workflowInstanceId: string;
    deliveryId: string;
    expectedRevision: number;
    status: "pending" | "dispatched" | "running" | "completed" | "failed";
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
  }>
> {
  const rows = await env.DB.prepare(
    "SELECT workflow_instance_id, delivery_id, expected_revision, status, created_at, started_at, completed_at FROM trusted_execution_workflows WHERE run_id = ? ORDER BY created_at, workflow_instance_id",
  )
    .bind(runId)
    .all<{
      workflow_instance_id: string;
      delivery_id: string;
      expected_revision: number;
      status: "pending" | "dispatched" | "running" | "completed" | "failed";
      created_at: string;
      started_at: string | null;
      completed_at: string | null;
    }>();
  return rows.results.map((row) => ({
    workflowInstanceId: row.workflow_instance_id,
    deliveryId: row.delivery_id,
    expectedRevision: row.expected_revision,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  }));
}

export async function consumeTrustedExecutionDelivery(
  message: DeliveryMessage,
  env: ControlPlaneEnv,
): Promise<string | null> {
  const delivery = runDeliverySchema.safeParse(message.body);
  if (!delivery.success) {
    message.ack();
    return null;
  }
  try {
    const instanceId = await dispatchTrustedExecutionWorkflow(
      env,
      delivery.data,
    );
    message.ack();
    return instanceId;
  } catch {
    message.retry();
    return null;
  }
}

export async function consumeTrustedReviewDelivery(
  message: DeliveryMessage,
  env: ControlPlaneEnv,
): Promise<string | null> {
  const delivery = reviewDeliverySchema.safeParse(message.body);
  if (!delivery.success) return null;
  try {
    const instanceId = await dispatchTrustedReviewWorkflow(env, delivery.data);
    message.ack();
    return instanceId;
  } catch {
    message.retry();
    return null;
  }
}

export async function runTrustedExecutionWorkflow(
  env: ControlPlaneEnv,
  input: unknown,
  step: TrustedExecutionWorkflowStepPort,
  execute: (delivery: RunDelivery) => Promise<TrustedExecutionWorkflowResult>,
  finalize: (delivery: RunDelivery) => Promise<TrustedExecutionWorkflowResult>,
): Promise<TrustedExecutionWorkflowResult> {
  const delivery = runDeliverySchema.parse(input);
  const instanceId = await trustedExecutionWorkflowId(delivery);
  try {
    await step.do(
      "execute trusted repository attempt",
      {
        retries: { limit: 5, delay: "10 minutes", backoff: "constant" },
        timeout: "3 hours",
      },
      async () => {
        const running = await env.DB.prepare(
          "UPDATE trusted_execution_workflows SET status = 'running', started_at = COALESCE(started_at, ?) WHERE workflow_instance_id = ? AND run_id = ? AND delivery_id = ? AND expected_revision = ? AND status IN ('pending', 'dispatched', 'running')",
        )
          .bind(
            new Date().toISOString(),
            instanceId,
            delivery.runId,
            delivery.deliveryId,
            delivery.expectedRevision,
          )
          .run();
        if ((running.meta.changes ?? 0) !== 1)
          throw new Error("Trusted execution Workflow reservation is invalid");
        return execute(delivery);
      },
    );
    return await step.do(
      "finalize trusted repository attempt",
      {
        retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
        timeout: "5 minutes",
      },
      async () => {
        const result = await finalize(delivery);
        const completed = await env.DB.prepare(
          "UPDATE trusted_execution_workflows SET status = 'completed', completed_at = ? WHERE workflow_instance_id = ? AND run_id = ? AND delivery_id = ? AND expected_revision = ? AND status IN ('running', 'completed')",
        )
          .bind(
            new Date().toISOString(),
            instanceId,
            delivery.runId,
            delivery.deliveryId,
            delivery.expectedRevision,
          )
          .run();
        if ((completed.meta.changes ?? 0) !== 1)
          throw new Error("Trusted execution Workflow completion is invalid");
        return result;
      },
    );
  } catch (error) {
    await env.DB.prepare(
      "UPDATE trusted_execution_workflows SET status = 'failed', completed_at = ? WHERE workflow_instance_id = ? AND status != 'completed'",
    )
      .bind(new Date().toISOString(), instanceId)
      .run();
    throw error;
  }
}

export async function runTrustedReviewWorkflow(
  env: ControlPlaneEnv,
  input: unknown,
  step: TrustedExecutionWorkflowStepPort,
  execute: (delivery: ReviewDelivery) => Promise<IndependentReviewExecution>,
  finalize: (
    delivery: ReviewDelivery,
    execution: IndependentReviewExecution,
  ) => Promise<TrustedReviewWorkflowResult>,
  fail: (
    delivery: ReviewDelivery,
    error: unknown,
  ) => Promise<TrustedReviewWorkflowResult>,
): Promise<TrustedReviewWorkflowResult> {
  const delivery = reviewDeliverySchema.parse(input);
  const instanceId = await trustedReviewWorkflowId(delivery);
  try {
    const execution = await step.do(
      "execute independent review",
      {
        retries: { limit: 2, delay: "6 minutes", backoff: "constant" },
        timeout: "3 hours",
      },
      async () => {
        const running = await env.DB.prepare(
          "UPDATE trusted_review_workflows SET status = 'running', started_at = COALESCE(started_at, ?) WHERE workflow_instance_id = ? AND review_id = ? AND delivery_id = ? AND status IN ('pending', 'dispatched', 'running')",
        )
          .bind(
            new Date().toISOString(),
            instanceId,
            delivery.reviewId,
            delivery.deliveryId,
          )
          .run();
        if ((running.meta.changes ?? 0) !== 1)
          throw new Error("Trusted review Workflow reservation is invalid");
        return execute(delivery);
      },
    );
    return await step.do(
      "finalize independent review",
      {
        retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
        timeout: "5 minutes",
      },
      async () => {
        const result = await finalize(delivery, execution);
        const completed = await env.DB.prepare(
          "UPDATE trusted_review_workflows SET status = 'completed', completed_at = ? WHERE workflow_instance_id = ? AND review_id = ? AND delivery_id = ? AND status IN ('running', 'completed')",
        )
          .bind(
            new Date().toISOString(),
            instanceId,
            delivery.reviewId,
            delivery.deliveryId,
          )
          .run();
        if ((completed.meta.changes ?? 0) !== 1)
          throw new Error("Trusted review Workflow completion is invalid");
        return result;
      },
    );
  } catch (error) {
    const result = await step.do(
      "record independent review failure",
      {
        retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
        timeout: "5 minutes",
      },
      () => fail(delivery, error),
    );
    await env.DB.prepare(
      "UPDATE trusted_review_workflows SET status = 'failed', completed_at = ? WHERE workflow_instance_id = ? AND status != 'completed'",
    )
      .bind(new Date().toISOString(), instanceId)
      .run();
    return result;
  }
}
