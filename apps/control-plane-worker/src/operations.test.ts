// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  D1JobStore,
  d1JobStoreMigration,
  type SelfDevelopmentTask,
} from "@roundhouse/self-development/cloudflare";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import { githubPlanningMigration } from "./github-planning.js";
import {
  cloudOperationsMigration,
  idempotentMutation,
  MutationConflictError,
  recordAlert,
  retentionReport,
  retryFailedRun,
  runRecoveryCycle,
} from "./operations.js";
import { trustedExecutionWorkflowMigration } from "./trusted-execution-workflow.js";

let instance: Miniflare;
let sharedDb: D1Database;

async function runtime(): Promise<ControlPlaneEnv & { queued: unknown[] }> {
  const queued: unknown[] = [];
  return {
    DB: sharedDb,
    RUN_QUEUE: {
      send: async (value: unknown) => void queued.push(value),
    } as unknown as Queue<unknown>,
    EXECUTION_MODE: "deterministic-local",
    ALLOWED_REPOSITORY_PATH: "/workspace/roundhouse",
    ALLOWED_REMOTE_URL: "https://github.com/zorkian/roundhouse.git",
    queued,
  };
}

beforeAll(async () => {
  instance = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "roundhouse-operations-local" },
  });
  sharedDb = await instance.getD1Database("DB");
  for (const statement of `${d1JobStoreMigration}
    ${cloudOperationsMigration}
    ${githubPlanningMigration}
    ${trustedExecutionWorkflowMigration}
    CREATE TABLE control_plane_submissions(idempotency_key TEXT PRIMARY KEY, request_hash TEXT, run_id TEXT, delivery_id TEXT, delivery_state TEXT, created_at TEXT, delivered_at TEXT);
    CREATE TABLE execution_evidence(evidence_id TEXT PRIMARY KEY);`
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await sharedDb.prepare(statement).run();
});

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

beforeEach(async () => {
  for (const table of [
    "operator_mutations",
    "operational_alerts",
    "recovery_cycles",
    "control_plane_submissions",
    "execution_evidence",
    "trusted_execution_workflows",
    "github_issue_plans",
    "self_development_runs",
  ])
    await sharedDb.prepare(`DELETE FROM ${table}`).run();
});

afterAll(async () => instance.dispose());

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
    expect(cycle).toMatchObject({ requeuedRuns: 2, alertsRecorded: 3 });
    expect(env.queued).toHaveLength(2);
  });

  it("does not requeue a lease-less run owned by an active Workflow", async () => {
    const env = await runtime();
    const jobs = new D1JobStore(env.DB);
    const start = new Date("2026-07-12T00:00:00Z");
    await jobs.submit("run_workflow_owned", task, start);
    await env.DB.prepare(
      "INSERT INTO trusted_execution_workflows(workflow_instance_id, run_id, delivery_id, expected_revision, status, created_at) VALUES (?, ?, ?, ?, 'running', ?)",
    )
      .bind(
        `trusted-${"a".repeat(64)}`,
        "run_workflow_owned",
        "delivery_workflow_owned",
        1,
        start.toISOString(),
      )
      .run();

    const cycle = await runRecoveryCycle(
      env,
      new Date(start.getTime() + 60_000),
    );

    expect(cycle.requeuedRuns).toBe(0);
    expect(env.queued).toEqual([]);
  });

  it("recovers only stranded auto-publication runs bound to an approved low-risk plan", async () => {
    const env = await runtime();
    const jobs = new D1JobStore(env.DB);
    const start = new Date("2026-07-12T00:00:00Z");
    const planId = `plan_${"a".repeat(40)}`;
    const planSha256 = "b".repeat(64);
    const approvedBy = "github:zorkian";
    const plannedTask = {
      ...task,
      taskId: "task_low_risk_recovery",
      planning: {
        planId,
        planSha256,
        profileId: "roundhouse-self-development-v1" as const,
        profileVersion: 1 as const,
        issueContentSha256: "c".repeat(64),
        exactPathsSha256: "d".repeat(64),
        approvedBy,
        approvedAt: start.toISOString(),
      },
    };
    await jobs.submit("run_low_risk_recovery", plannedTask, start);
    await jobs.submit(
      "run_manual_approval",
      { ...task, taskId: "task_manual_approval" },
      start,
    );
    for (const runId of ["run_low_risk_recovery", "run_manual_approval"]) {
      const run = await jobs.read(runId);
      const evidence = {
        schemaVersion: 1 as const,
        evidenceId: `evidence_${runId}`,
        attemptId: `attempt_${runId}`,
        objectKey: `runs/${runId}/evidence.json`,
        sha256: "e".repeat(64),
        size: 1,
        mediaType: "application/json" as const,
        approvalEligible: true,
        createdAt: start.toISOString(),
      };
      const stranded = {
        ...run,
        state: "awaiting_approval" as const,
        evidence: [evidence],
        implementation: {
          patchSha256: "f".repeat(64),
          patchBytes: 1,
          changedFiles: ["docs/operations.md"],
          evidenceId: evidence.evidenceId,
          objectKey: evidence.objectKey,
        },
      };
      await env.DB.prepare(
        "UPDATE self_development_runs SET state = ?, payload = ? WHERE run_id = ?",
      )
        .bind(stranded.state, JSON.stringify(stranded), runId)
        .run();
    }
    await env.DB.prepare(
      `INSERT INTO github_issue_plans(plan_id, issue_number, revision, status, plan_sha256, plan_json, evidence_object_key, evidence_sha256, evidence_size, approved_by, approved_at, run_id, created_at, updated_at)
       VALUES (?, 171, 3, 'materialized', ?, ?, 'plans/171.json', ?, 1, ?, ?, 'run_low_risk_recovery', ?, ?)`,
    )
      .bind(
        planId,
        planSha256,
        JSON.stringify({
          schemaVersion: 1,
          planId,
          revision: 1,
          status: "proposed",
          profileId: "roundhouse-self-development-v1",
          profileVersion: 1,
          issueNumber: 171,
          issueContentSha256: "c".repeat(64),
          subject: "Recover a stranded run",
          instructionsSha256: "2".repeat(64),
          baseCommit: "a".repeat(40),
          exactPaths: ["docs/operations.md"],
          validationLevel: "full",
          risk: "low",
          acceptanceCriteria: [],
          planningEvidence: [],
          limits: {
            maxPatchBytes: 1024,
            maxFiles: 1,
            agentTimeoutSeconds: 60,
            modelRequestLimit: 1,
            automaticAttemptLimit: 3,
            operatorAttemptLimit: 10,
          },
          createdAt: start.toISOString(),
          planSha256,
        }),
        "1".repeat(64),
        approvedBy,
        start.toISOString(),
        start.toISOString(),
        start.toISOString(),
      )
      .run();

    const cycle = await runRecoveryCycle(
      env,
      new Date(start.getTime() + 60_000),
    );

    expect(cycle).toMatchObject({ requeuedRuns: 1, alertsRecorded: 1 });
    expect(env.queued).toEqual([
      {
        schemaVersion: 1,
        runId: "run_low_risk_recovery",
        deliveryId: "recovery_run_low_risk_recovery_1",
        expectedRevision: 1,
      },
    ]);
    const alert = await env.DB.prepare(
      "SELECT kind, severity, detail_json FROM operational_alerts WHERE run_id = 'run_low_risk_recovery'",
    ).first<{ kind: string; severity: string; detail_json: string }>();
    expect(alert).toMatchObject({
      kind: "low_risk_auto_publication_requeued",
      severity: "warning",
    });
    expect(JSON.parse(alert!.detail_json)).toEqual({
      revision: 1,
      state: "awaiting_approval",
    });

    await env.DB.prepare(
      "UPDATE github_issue_plans SET plan_json = ? WHERE plan_id = ?",
    )
      .bind(JSON.stringify({ status: "proposed", risk: "low" }), planId)
      .run();
    const malformedCycle = await runRecoveryCycle(
      env,
      new Date(start.getTime() + 120_000),
    );
    expect(malformedCycle.requeuedRuns).toBe(0);
    expect(env.queued).toHaveLength(1);
    const malformedAlert = await env.DB.prepare(
      "SELECT kind, severity, detail_json FROM operational_alerts WHERE alert_key = ?",
    )
      .bind("invalid_recovery_plan:run_low_risk_recovery:1")
      .first<{ kind: string; severity: string; detail_json: string }>();
    expect(malformedAlert).toMatchObject({
      kind: "invalid_recovery_plan",
      severity: "warning",
    });
    expect(JSON.parse(malformedAlert!.detail_json)).toEqual({
      revision: 1,
      planId,
    });
  });

  it("allows an exact operator retry for a validation failure without making it automatic", async () => {
    const env = await runtime();
    const jobs = new D1JobStore(env.DB);
    const start = new Date("2026-07-12T00:00:00Z");
    await jobs.submit("run_validation_retry", task, start);
    const claim = await jobs.claim(
      "run_validation_retry",
      "worker",
      start,
      1_000,
      1,
    );
    await jobs.startAttempt(
      "run_validation_retry",
      claim!.token,
      "prepare",
      start,
    );
    const failed = await jobs.failAttempt(
      "run_validation_retry",
      claim!.token,
      "prepare",
      {
        retryable: false,
        classification: "validation_failed",
        error: "implementation checks failed",
      },
      true,
      start,
    );

    const exhausted = {
      ...failed,
      attempts: Array.from({ length: 10 }, (_, index) => ({
        ...failed.attempts.at(-1)!,
        attemptId: `run_validation_retry-prepare-${index + 1}`,
        number: index + 1,
      })),
    };
    await env.DB.prepare(
      "UPDATE self_development_runs SET payload = ? WHERE run_id = 'run_validation_retry'",
    )
      .bind(JSON.stringify(exhausted))
      .run();
    await expect(
      retryFailedRun(
        env,
        "run_validation_retry",
        failed.revision,
        new Date(start.getTime() + 1),
      ),
    ).rejects.toThrow("not eligible");
    await runRecoveryCycle(env, new Date(start.getTime() + 2));
    const alert = await env.DB.prepare(
      "SELECT kind, detail_json FROM operational_alerts WHERE alert_key = ?",
    )
      .bind(`retries_exhausted:run_validation_retry:${failed.revision}`)
      .first<{ kind: string; detail_json: string }>();
    expect(alert?.kind).toBe("retries_exhausted");
    expect(JSON.parse(alert!.detail_json)).toMatchObject({
      attempts: 10,
      limit: 10,
      classification: "validation_failed",
    });
    await env.DB.prepare(
      "UPDATE self_development_runs SET payload = ? WHERE run_id = 'run_validation_retry'",
    )
      .bind(JSON.stringify(failed))
      .run();

    const retried = await retryFailedRun(
      env,
      "run_validation_retry",
      failed.revision,
      new Date(start.getTime() + 1),
    );
    expect(retried).toMatchObject({ state: "created" });
    expect(retried.events.at(-1)).toMatchObject({
      type: "operator.retry_requested",
      detail: { failedAttemptId: failed.attempts.at(-1)?.attemptId },
    });
    await expect(
      retryFailedRun(env, "run_validation_retry", failed.revision, start),
    ).rejects.toThrow("not eligible");
  });

  it("does not count deploy interruptions toward normal retry exhaustion", async () => {
    const env = await runtime();
    const jobs = new D1JobStore(env.DB);
    const start = new Date("2026-07-12T00:00:00Z");
    await jobs.submit("run_deploy_churn", task, start);
    const claim = await jobs.claim(
      "run_deploy_churn",
      "worker",
      start,
      1_000,
      1,
    );
    await jobs.startAttempt("run_deploy_churn", claim!.token, "prepare", start);
    const failed = await jobs.failAttempt(
      "run_deploy_churn",
      claim!.token,
      "prepare",
      { retryable: true, classification: "transient", error: "retry me" },
      true,
      start,
    );
    const latest = failed.attempts.at(-1)!;
    const interrupted = {
      ...latest,
      classification: "container_interrupted" as const,
      error: "deployment interrupted the container",
    };
    const deployChurnFailure = {
      ...failed,
      attempts: [
        { ...interrupted, attemptId: "deploy-interruption-1", number: 1 },
        { ...interrupted, attemptId: "deploy-interruption-2", number: 2 },
        { ...latest, attemptId: "normal-failure-1", number: 3 },
      ],
    };
    await env.DB.prepare(
      "UPDATE self_development_runs SET payload = ? WHERE run_id = 'run_deploy_churn'",
    )
      .bind(JSON.stringify(deployChurnFailure))
      .run();

    await runRecoveryCycle(env, new Date(start.getTime() + 1));

    const alert = await env.DB.prepare(
      "SELECT kind FROM operational_alerts WHERE alert_key = ?",
    )
      .bind(`retries_exhausted:run_deploy_churn:${failed.revision}`)
      .first<{ kind: string }>();
    expect(alert).toBeNull();
  });

  it("deduplicates alerts and keeps retention destructive work empty", async () => {
    const env = await runtime();
    const now = new Date("2026-07-12T00:00:00Z");
    await recordAlert(env, {
      key: "alert:test",
      kind: "initial",
      severity: "warning",
      detail: { index: 0 },
      now,
    });
    await env.DB.prepare(
      "UPDATE operational_alerts SET resolved_at = ? WHERE alert_key = 'alert:test'",
    )
      .bind(now.toISOString())
      .run();
    await recordAlert(env, {
      key: "alert:test",
      kind: "updated",
      severity: "error",
      runId: "run_updated",
      detail: { index: 1 },
      now,
    });
    const alert = await env.DB.prepare(
      "SELECT occurrences, kind, severity, run_id, resolved_at FROM operational_alerts WHERE alert_key = 'alert:test'",
    ).first<{
      occurrences: number;
      kind: string;
      severity: string;
      run_id: string | null;
      resolved_at: string | null;
    }>();
    expect(alert).toMatchObject({
      occurrences: 2,
      kind: "updated",
      severity: "error",
      run_id: "run_updated",
      resolved_at: null,
    });
    await expect(retentionReport(env)).resolves.toMatchObject({
      dryRun: true,
      activeAlerts: 1,
      deletions: [],
    });
  });

  it("records exhausted retry, missing evidence, and publication ambiguity alerts", async () => {
    const env = await runtime();
    const jobs = new D1JobStore(env.DB);
    const start = new Date("2026-07-12T00:00:00Z");
    await jobs.submit("run_exhausted", task, start);
    const claim = await jobs.claim("run_exhausted", "worker", start, 1_000, 1);
    await jobs.startAttempt("run_exhausted", claim!.token, "prepare", start);
    const failed = await jobs.failAttempt(
      "run_exhausted",
      claim!.token,
      "prepare",
      { retryable: true, classification: "transient", error: "retry me" },
      true,
      start,
    );
    const exhausted = {
      ...failed,
      attempts: [1, 2, 3].map((number) => ({
        ...failed.attempts[0]!,
        attemptId: `run_exhausted-prepare-${number}`,
        number,
      })),
    };
    await env.DB.prepare(
      "UPDATE self_development_runs SET payload = ? WHERE run_id = 'run_exhausted'",
    )
      .bind(JSON.stringify(exhausted))
      .run();
    await jobs.submit(
      "run_missing_evidence",
      { ...task, taskId: "task_missing_evidence" },
      start,
    );
    const missing = await jobs.read("run_missing_evidence");
    await env.DB.prepare(
      "UPDATE self_development_runs SET state = 'awaiting_approval', payload = ? WHERE run_id = 'run_missing_evidence'",
    )
      .bind(JSON.stringify({ ...missing, state: "awaiting_approval" }))
      .run();
    await env.DB.prepare(
      "INSERT INTO operator_mutations(idempotency_key, request_hash, action, run_id, actor_id, status, created_at) VALUES ('ambiguous-publication-01', 'hash', 'publish', 'run_missing_evidence', 'operator@example.test', 'pending', ?)",
    )
      .bind(start.toISOString())
      .run();

    const cycle = await runRecoveryCycle(
      env,
      new Date(start.getTime() + 600_000),
    );
    expect(cycle.alertsRecorded).toBeGreaterThanOrEqual(3);
    const alerts = await env.DB.prepare(
      "SELECT kind FROM operational_alerts WHERE kind IN ('retries_exhausted', 'missing_evidence', 'publication_ambiguous') ORDER BY kind",
    ).all<{ kind: string }>();
    expect(alerts.results.map((alert) => alert.kind)).toEqual([
      "missing_evidence",
      "publication_ambiguous",
      "retries_exhausted",
    ]);
  });
});
