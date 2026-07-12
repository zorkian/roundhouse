// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  D1JobStore,
  d1JobStoreMigration,
  type RunDelivery,
  type SelfDevelopmentTask,
} from "@roundhouse/self-development/cloudflare";
import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import { createControlPlaneHandler } from "./index.js";
import {
  controlPlaneSubmissionMigration,
  reserveSubmission,
} from "./submissions.js";

const instances: Miniflare[] = [];
const token = "local-test-token";
const repositoryPath = "/workspace/roundhouse";
const remoteUrl = "https://github.com/zorkian/roundhouse.git";

const task: SelfDevelopmentTask = {
  schemaVersion: 1,
  taskId: "task_control_plane",
  subject: "Local control-plane demonstration",
  instructions: "Perform one bounded local demonstration.",
  repositoryPath,
  baseCommit: "d".repeat(40),
  validationLevel: "quick",
  allowedPaths: ["docs/**"],
  publication: {
    remote: "origin",
    remoteUrl,
    branch: "roundhouse/local-control-plane-demo",
    expectedRemoteHead: null,
    commitMessage: "Demonstrate local control plane",
    authorName: "Roundhouse Test",
    authorEmail: "roundhouse@example.invalid",
  },
};

type Queued = { messages: unknown[]; failNext: boolean };

async function runtime(): Promise<{
  env: ControlPlaneEnv;
  queued: Queued;
}> {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "roundhouse-control-plane-local" },
  });
  instances.push(mf);
  const db = await mf.getD1Database("DB");
  for (const statement of `${d1JobStoreMigration}\n${controlPlaneSubmissionMigration}`
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
  const queued: Queued = { messages: [], failNext: false };
  const queue = {
    send: async (body: unknown) => {
      if (queued.failNext) {
        queued.failNext = false;
        throw new Error("simulated queue outage");
      }
      queued.messages.push(body);
    },
  } as unknown as Queue<unknown>;
  return {
    env: {
      DB: db,
      RUN_QUEUE: queue,
      LOCAL_API_TOKEN: token,
      EXECUTION_MODE: "deterministic-local",
      ALLOWED_REPOSITORY_PATH: repositoryPath,
      ALLOWED_REMOTE_URL: remoteUrl,
    },
    queued,
  };
}

function request(
  path: string,
  init: RequestInit = {},
  authenticated = true,
): Request<unknown, IncomingRequestCfProperties> {
  const headers = new Headers(init.headers);
  if (authenticated) headers.set("authorization", `Bearer ${token}`);
  return new Request(`http://roundhouse.local${path}`, {
    ...init,
    headers,
  }) as Request<unknown, IncomingRequestCfProperties>;
}

function submission(
  key: string,
  value: SelfDevelopmentTask = task,
): Request<unknown, IncomingRequestCfProperties> {
  return request("/v1/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({ schemaVersion: 1, task: value }),
  });
}

async function deliver(
  handler: ExportedHandler<ControlPlaneEnv>,
  env: ControlPlaneEnv,
  bodies: unknown[],
): Promise<string[]> {
  const outcomes: string[] = [];
  const messages = bodies.map((body, index) => ({
    body,
    ack: () => outcomes.push(`ack:${index}`),
    retry: () => outcomes.push(`retry:${index}`),
  }));
  await handler.queue!(
    { messages } as unknown as MessageBatch<unknown>,
    env,
    {} as ExecutionContext,
  );
  return outcomes;
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

describe("local control-plane Worker", () => {
  it("enforces authentication and safe request boundaries", async () => {
    const { env } = await runtime();
    const handler = createControlPlaneHandler();
    expect(
      (
        await handler.fetch!(
          request("/health", {}, false),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handler.fetch!(
          request("/ready", {}, false),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handler.fetch!(
          request("/v1/runs", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": "invalid-json",
            },
            body: "{",
          }),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler.fetch!(
          request("/v1/runs", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": "oversized-body-01",
            },
            body: JSON.stringify("x".repeat(65_537)),
          }),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(413);
    const unenrolled = structuredClone(task);
    unenrolled.repositoryPath = "/arbitrary/repository";
    expect(
      (
        await handler.fetch!(
          submission("unenrolled-01", unenrolled),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(403);
  });

  it("recovers a pending outbox, deduplicates submission and delivery, and redacts inspection", async () => {
    const { env, queued } = await runtime();
    const handler = createControlPlaneHandler();
    queued.failNext = true;
    expect(
      (
        await handler.fetch!(
          submission("outbox-recovery-01"),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(500);
    const recovered = await handler.fetch!(
      submission("outbox-recovery-01"),
      env,
      {} as ExecutionContext,
    );
    expect(recovered.status).toBe(200);
    const response = (await recovered.json()) as {
      runId: string;
      created: boolean;
    };
    expect(response.created).toBe(false);
    expect(queued.messages).toHaveLength(1);
    expect(
      (
        await handler.fetch!(
          submission("outbox-recovery-01"),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(200);
    expect(queued.messages).toHaveLength(1);
    expect(
      await deliver(handler, env, [queued.messages[0], queued.messages[0]]),
    ).toEqual(["ack:0", "ack:1"]);
    expect((await new D1JobStore(env.DB).read(response.runId)).state).toBe(
      "workspace_ready",
    );

    const inspected = await handler.fetch!(
      request(`/v1/runs/${response.runId}`),
      env,
      {} as ExecutionContext,
    );
    const text = await inspected.text();
    expect(inspected.status).toBe(200);
    expect(text).not.toContain(task.instructions);
    expect(text).not.toContain(task.subject);
    expect(text).not.toContain(task.repositoryPath);
    expect(text).not.toContain("lease");
    expect(text).not.toContain("workspacePath");
  });

  it("repairs interruption between submission reservation and run creation", async () => {
    const { env, queued } = await runtime();
    const key = "reservation-recovery-01";
    const reserved = await reserveSubmission(env.DB, key, task, new Date());
    expect(reserved.created).toBe(true);
    await expect(
      new D1JobStore(env.DB).read(reserved.row.run_id),
    ).rejects.toThrow("Run not found");

    const handler = createControlPlaneHandler();
    const response = await handler.fetch!(
      submission(key),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    expect((await new D1JobStore(env.DB).read(reserved.row.run_id)).state).toBe(
      "created",
    );
    expect(queued.messages).toHaveLength(1);
  });

  it("rejects conflicting idempotency reuse", async () => {
    const { env } = await runtime();
    const handler = createControlPlaneHandler();
    expect(
      (
        await handler.fetch!(
          submission("idempotency-conflict-01"),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(201);
    const changed = structuredClone(task);
    changed.subject = "Different request";
    expect(
      (
        await handler.fetch!(
          submission("idempotency-conflict-01", changed),
          env,
          {} as ExecutionContext,
        )
      ).status,
    ).toBe(409);
  });

  it("restarts over durable D1 state and reclaims an interrupted expired attempt", async () => {
    const { env, queued } = await runtime();
    const firstHandler = createControlPlaneHandler();
    const submitted = await firstHandler.fetch!(
      submission("restart-reclaim-01"),
      env,
      {} as ExecutionContext,
    );
    const { runId } = (await submitted.json()) as { runId: string };
    const jobs = new D1JobStore(env.DB);
    const past = new Date("2020-01-01T00:00:00Z");
    const claim = await jobs.claim(runId, "crashed-worker", past, 1_000, 1);
    await jobs.startAttempt(runId, claim!.token, "prepare", past);
    const interrupted = await jobs.read(runId);
    const replay: RunDelivery = {
      ...(queued.messages[0] as RunDelivery),
      expectedRevision: interrupted.revision,
    };

    const restartedHandler = createControlPlaneHandler();
    expect(await deliver(restartedHandler, env, [replay])).toEqual(["ack:0"]);
    const recovered = await new D1JobStore(env.DB).read(runId);
    expect(recovered.state).toBe("workspace_ready");
    expect(recovered.attempts).toMatchObject([
      { status: "failed", classification: "lease_expired", retryable: true },
      { status: "succeeded" },
    ]);
  });

  it("acks malformed messages and durably records terminal dispatch failure", async () => {
    const { env, queued } = await runtime();
    const handler = createControlPlaneHandler();
    expect(
      await deliver(handler, env, [
        { schemaVersion: 1, runId: "missing-fields" },
      ]),
    ).toEqual(["ack:0"]);
    const submitted = await handler.fetch!(
      submission("terminal-failure-01"),
      env,
      {} as ExecutionContext,
    );
    const { runId } = (await submitted.json()) as { runId: string };
    env.EXECUTION_MODE = "disabled";
    expect(await deliver(handler, env, [queued.messages[0]])).toEqual([
      "ack:0",
    ]);
    const failed = await new D1JobStore(env.DB).read(runId);
    expect(failed.state).toBe("failed");
    expect(failed.attempts[0]).toMatchObject({
      status: "failed",
      retryable: false,
      classification: "unexpected",
    });
    const inspection = await handler.fetch!(
      request(`/v1/runs/${runId}`),
      env,
      {} as ExecutionContext,
    );
    expect(await inspection.text()).not.toContain(
      "No authorized execution dispatcher",
    );
  });

  it("emits revision-bound retries and stops at the attempt limit", async () => {
    const { env, queued } = await runtime();
    const handler = createControlPlaneHandler();
    const submitted = await handler.fetch!(
      submission("bounded-retries-01"),
      env,
      {} as ExecutionContext,
    );
    const { runId } = (await submitted.json()) as { runId: string };
    env.EXECUTION_MODE = "retryable-local";

    expect(await deliver(handler, env, [queued.messages[0]])).toEqual([
      "ack:0",
    ]);
    expect(queued.messages).toHaveLength(2);
    expect(await deliver(handler, env, [queued.messages[1]])).toEqual([
      "ack:0",
    ]);
    expect(queued.messages).toHaveLength(3);
    expect(await deliver(handler, env, [queued.messages[2]])).toEqual([
      "ack:0",
    ]);
    expect(queued.messages).toHaveLength(3);

    const failed = await new D1JobStore(env.DB).read(runId);
    expect(failed.state).toBe("failed");
    expect(failed.attempts).toHaveLength(3);
    expect(failed.attempts.every((attempt) => attempt.retryable)).toBe(true);
    expect(
      failed.attempts.every(
        (attempt) => attempt.classification === "dispatch_unavailable",
      ),
    ).toBe(true);
  });

  it("repairs retry enqueue failure before acknowledging the delivery", async () => {
    const { env, queued } = await runtime();
    const handler = createControlPlaneHandler();
    const submitted = await handler.fetch!(
      submission("retry-outbox-repair-01"),
      env,
      {} as ExecutionContext,
    );
    const { runId } = (await submitted.json()) as { runId: string };
    const original = queued.messages[0];
    env.EXECUTION_MODE = "retryable-local";
    queued.failNext = true;

    expect(await deliver(handler, env, [original])).toEqual(["retry:0"]);
    expect(queued.messages).toHaveLength(1);
    const durable = await new D1JobStore(env.DB).read(runId);
    expect(durable.state).toBe("created");
    expect(durable.attempts[0]).toMatchObject({
      status: "failed",
      retryable: true,
      classification: "dispatch_unavailable",
    });

    expect(await deliver(handler, env, [original])).toEqual(["ack:0"]);
    expect(queued.messages).toHaveLength(2);
    expect(queued.messages[1]).toMatchObject({
      runId,
      expectedRevision: durable.revision,
    });
  });
});
