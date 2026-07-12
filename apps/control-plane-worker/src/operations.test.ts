// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  D1JobStore,
  d1JobStoreMigration,
  type SelfDevelopmentTask,
} from "@roundhouse/self-development/cloudflare";
import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import {
  cloudOperationsMigration,
  idempotentMutation,
  MutationConflictError,
  recordAlert,
  retentionReport,
  retryFailedRun,
  runRecoveryCycle,
} from "./operations.js";

const instances: Miniflare[] = [];

async function runtime(): Promise<ControlPlaneEnv & { queued: unknown[] }> {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "roundhouse-operations-local" },
  });
  instances.push(mf);
  const db = await mf.getD1Database("DB");
  for (const statement of `${d1JobStoreMigration}
    ${cloudOperationsMigration}
    CREATE TABLE control_plane_submissions(idempotency_key TEXT PRIMARY KEY, request_hash TEXT, run_id TEXT, delivery_id TEXT, delivery_state TEXT, created_at TEXT, delivered_at TEXT);
    CREATE TABLE execution_evidence(evidence_id TEXT PRIMARY KEY);`
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
  const queued: unknown[] = [];
  return {
    DB: db,
    RUN_QUEUE: {
      send: async (value: unknown) => void queued.push(value),
    } as unknown as Queue<unknown>,
    EXECUTION_MODE: "deterministic-local",
    ALLOWED_REPOSITORY_PATH: "/workspace/roundhouse",
    ALLOWED_REMOTE_URL: "https://github.com/zorkian/roundhouse.git",
    queued,
  };
}

const task: SelfDevelopmentTask = {
  schemaVersion: 1,
  taskId: "task_operations",
  subject: "Exercise operations",
  instructions: "Run the bounded operation test.",
  repositoryPath: "/workspace/roundhouse",
  baseCommit: "a".repeat(40),
  validationLevel: "quick",
  allowedPaths: ["docs/operations.md"],
  publication: {
    remote: "origin",
    remoteUrl: "https://github.com/zorkian/roundhouse.git",
    branch: "codex/operations-test",
    expectedRemoteHead: null,
    commitMessage: "Exercise operations",
    authorName: "Roundhouse Test",
    authorEmail: "roundhouse@example.test",
  },
};

afterEach(async () => {
  await Promise.all(instances.splice(0).map((value) => value.dispose()));
});

describe("cloud operator persistence", () => {
  it("replays an identical mutation and rejects conflicting reuse", async () => {
    const env = await runtime();
    let calls = 0;
    const input = {
      key: "operator-test-01",
      action: "cancel",
      runId: "run_test",
      actorId: "operator@example.test",
      request: { expectedRevision: 1 },
      now: new Date("2026-07-12T00:00:00Z"),
    };
    const first = await idempotentMutation(env, input, async () => ({
      calls: ++calls,
    }));
    const replay = await idempotentMutation(env, input, async () => ({
      calls: ++calls,
    }));
    expect(first).toEqual({ value: { calls: 1 }, replayed: false });
    expect(replay).toEqual({ value: { calls: 1 }, replayed: true });
    expect(calls).toBe(1);
    await expect(
      idempotentMutation(
        env,
        { ...input, request: { expectedRevision: 2 } },
        async () => ({}),
      ),
    ).rejects.toBeInstanceOf(MutationConflictError);
    await expect(
      idempotentMutation(
        env,
        { ...input, key: "operator-retry-after-error" },
        async () => {
          throw new Error("transient failure");
        },
      ),
    ).rejects.toThrow("transient failure");
    await expect(
      idempotentMutation(
        env,
        { ...input, key: "operator-retry-after-error" },
        async () => ({ recovered: true }),
      ),
    ).resolves.toMatchObject({ value: { recovered: true } });
  });

  it("retries only an exact retryable failure and requeues an expired lease", async () => {
    const env = await runtime();
    const jobs = new D1JobStore(env.DB);
    const start = new Date("2026-07-12T00:00:00Z");
    await jobs.submit("run_retry", task, start);
    const claim = await jobs.claim("run_retry", "worker", start, 1_000, 1);
    await jobs.startAttempt("run_retry", claim!.token, "prepare", start);
    const failed = await jobs.failAttempt(
      "run_retry",
      claim!.token,
      "prepare",
      { retryable: true, classification: "transient", error: "retry me" },
      true,
      start,
    );
    const retried = await retryFailedRun(
      env,
      "run_retry",
      failed.revision,
      new Date(start.getTime() + 1),
    );
    expect(retried).toMatchObject({ state: "created" });
    await expect(
      retryFailedRun(env, "run_retry", failed.revision, start),
    ).rejects.toThrow("not eligible");

    await jobs.submit(
      "run_expired",
      { ...task, taskId: "task_expired" },
      start,
    );
    await jobs.claim("run_expired", "worker", start, 1_000, 1);
    await env.DB.prepare(
      "INSERT INTO self_development_runs(run_id, revision, state, updated_at, payload) VALUES ('run_malformed', 1, 'created', ?, '{')",
    )
      .bind(start.toISOString())
      .run();
    const cycle = await runRecoveryCycle(
      env,
      new Date(start.getTime() + 1_001),
    );
    expect(cycle).toMatchObject({ requeuedRuns: 1, alertsRecorded: 2 });
    expect(env.queued).toHaveLength(1);
  });

  it("deduplicates alerts and keeps retention destructive work empty", async () => {
    const env = await runtime();
    const now = new Date("2026-07-12T00:00:00Z");
    for (let index = 0; index < 2; index += 1)
      await recordAlert(env, {
        key: "alert:test",
        kind: "test",
        severity: "warning",
        detail: { index },
        now,
      });
    const alert = await env.DB.prepare(
      "SELECT occurrences FROM operational_alerts WHERE alert_key = 'alert:test'",
    ).first<{ occurrences: number }>();
    expect(alert?.occurrences).toBe(2);
    await expect(retentionReport(env)).resolves.toMatchObject({
      dryRun: true,
      activeAlerts: 1,
      deletions: [],
    });
  });
});
