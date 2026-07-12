// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import {
  cloudOperationsMigration,
  idempotentMutation,
  MutationConflictError,
  recordAlert,
  retentionReport,
} from "./operations.js";

const instances: Miniflare[] = [];

async function runtime(): Promise<ControlPlaneEnv> {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "roundhouse-operations-local" },
  });
  instances.push(mf);
  const db = await mf.getD1Database("DB");
  for (const statement of `${cloudOperationsMigration}
    CREATE TABLE self_development_runs(run_id TEXT PRIMARY KEY, revision INTEGER, state TEXT, updated_at TEXT, payload TEXT);
    CREATE TABLE execution_evidence(evidence_id TEXT PRIMARY KEY);`
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
  return {
    DB: db,
    RUN_QUEUE: { send: async () => undefined } as unknown as Queue<unknown>,
    EXECUTION_MODE: "deterministic-local",
    ALLOWED_REPOSITORY_PATH: "/workspace/roundhouse",
    ALLOWED_REMOTE_URL: "https://github.com/zorkian/roundhouse.git",
  };
}

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
