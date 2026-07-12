// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import {
  D1JobStore,
  d1JobStoreMigration,
  type D1DatabasePort,
} from "./cloudflare-job-store.js";
import { jobStoreContract } from "./job-store-contract.shared.js";
import {
  consumeRunDelivery,
  type DeliveryMessage,
  type RunDelivery,
} from "./queue-delivery.js";
import { ResumableCoordinator } from "./resumable-coordinator.js";
import type { JobStageExecutor } from "./job-ports.js";
import type { SelfDevelopmentTask } from "./task.js";

const instances: Miniflare[] = [];
const task: SelfDevelopmentTask = {
  schemaVersion: 1,
  taskId: "task_cloudflare",
  subject: "Cloudflare contract",
  instructions: "bounded",
  repositoryPath: "/tmp/repo",
  baseCommit: "c".repeat(40),
  validationLevel: "quick",
  allowedPaths: ["docs/**"],
  publication: {
    remote: "origin",
    remoteUrl: "https://example.invalid/repo.git",
    branch: "roundhouse/output",
    expectedRemoteHead: null,
    commitMessage: "Change",
    authorName: "Test",
    authorEmail: "test@example.invalid",
  },
};

async function database(): Promise<D1DatabasePort> {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "roundhouse-local" },
  });
  instances.push(mf);
  const db = await mf.getD1Database("DB");
  for (const statement of d1JobStoreMigration
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
  return db;
}

async function store(): Promise<D1JobStore> {
  return new D1JobStore(await database());
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((value) => value.dispose()));
  contractDatabase = undefined;
});

describe("local Cloudflare coordination", () => {
  it("uses D1 compare-and-set for exclusive claims and expiry reclaim", async () => {
    const jobs = await store();
    const start = new Date("2026-07-12T00:00:00Z");
    await jobs.submit("run_cloudflare", task, start);
    const claims = await Promise.all([
      jobs.claim("run_cloudflare", "worker-a", start, 1_000, 1),
      jobs.claim("run_cloudflare", "worker-b", start, 1_000, 1),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find(Boolean)!;
    await jobs.startAttempt("run_cloudflare", first.token, "prepare", start);
    const reclaimed = await jobs.claim(
      "run_cloudflare",
      "worker-c",
      new Date("2026-07-12T00:00:02Z"),
      1_000,
    );
    expect(reclaimed?.run.attempts[0]).toMatchObject({
      status: "failed",
      classification: "lease_expired",
    });
  });

  it("acks duplicate queue deliveries while executing one expected revision", async () => {
    const jobs = await store();
    await jobs.submit("run_delivery", task, new Date("2026-07-12T00:00:00Z"));
    let executions = 0;
    const executor: JobStageExecutor = {
      execute: async () => {
        executions += 1;
        return {
          state: "workspace_ready",
          updates: { workspaceRef: "container:test" },
        };
      },
    };
    const coordinator = new ResumableCoordinator(
      jobs,
      executor,
      { now: () => new Date("2026-07-12T00:00:01Z") },
      { workerId: "queue-worker" },
    );
    const delivery: RunDelivery = {
      schemaVersion: 1,
      runId: "run_delivery",
      deliveryId: "delivery-1",
      expectedRevision: 1,
    };
    const outcomes: string[] = [];
    const message = (): DeliveryMessage => ({
      body: delivery,
      ack: () => outcomes.push("ack"),
      retry: () => outcomes.push("retry"),
    });
    await Promise.all([
      consumeRunDelivery(message(), coordinator),
      consumeRunDelivery(message(), coordinator),
    ]);
    expect(executions).toBe(1);
    expect(outcomes).toEqual(["ack", "ack"]);
    expect((await jobs.read("run_delivery")).state).toBe("workspace_ready");
  });

  it("acks an invalid queue delivery without executing or retrying it", async () => {
    const jobs = await store();
    let executions = 0;
    const coordinator = new ResumableCoordinator(
      jobs,
      {
        execute: async () => {
          executions += 1;
          throw new Error("must not execute");
        },
      },
      { now: () => new Date("2026-07-12T00:00:01Z") },
      { workerId: "queue-worker" },
    );
    const outcomes: string[] = [];
    await consumeRunDelivery(
      {
        body: { schemaVersion: 1, runId: "run_delivery" },
        ack: () => outcomes.push("ack"),
        retry: () => outcomes.push("retry"),
      },
      coordinator,
    );
    expect(executions).toBe(0);
    expect(outcomes).toEqual(["ack"]);
  });

  it("reclaims an expired running attempt from its original revision-bound delivery", async () => {
    const jobs = await store();
    const start = new Date("2026-07-12T00:00:00Z");
    await jobs.submit("run_delivery_recovery", task, start);
    const abandoned = await jobs.claim(
      "run_delivery_recovery",
      "crashed-worker",
      start,
      1_000,
      1,
    );
    await jobs.startAttempt(
      "run_delivery_recovery",
      abandoned!.token,
      "prepare",
      start,
    );
    let executions = 0;
    const coordinator = new ResumableCoordinator(
      jobs,
      {
        execute: async () => {
          executions += 1;
          return { state: "workspace_ready" };
        },
      },
      { now: () => new Date("2026-07-12T00:00:02Z") },
      { workerId: "recovery-worker", leaseMs: 1_000 },
    );
    const outcomes: string[] = [];

    await consumeRunDelivery(
      {
        body: {
          schemaVersion: 1,
          runId: "run_delivery_recovery",
          deliveryId: "original-delivery",
          expectedRevision: 1,
        },
        ack: () => outcomes.push("ack"),
        retry: () => outcomes.push("retry"),
      },
      coordinator,
    );

    const recovered = await jobs.read("run_delivery_recovery");
    expect(outcomes).toEqual(["ack"]);
    expect(executions).toBe(1);
    expect(recovered.attempts).toMatchObject([
      { status: "failed", classification: "lease_expired" },
      { status: "succeeded" },
    ]);
  });
});

let contractDatabase: D1DatabasePort | undefined;
jobStoreContract("D1JobStore (Miniflare)", async () => {
  contractDatabase ??= await database();
  return new D1JobStore(contractDatabase);
});
