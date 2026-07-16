// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  d1JobStoreMigration,
  qualifyAndPlan,
} from "@roundhouse/self-development/cloudflare";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { githubPlanningDeliverySchema } from "./contracts.js";
import type { ControlPlaneEnv } from "./environment.js";
import {
  approvePlan,
  claimPlanningJob,
  failPlanningJob,
  finishPlanningJob,
  githubPlanningMigration,
  listIssuePlans,
  materializePlan,
  readIssuePlan,
  recordPlanningDecision,
  recoverablePlanningJobs,
  reservePlanningJob,
} from "./github-planning.js";

let instance: Miniflare;
let sharedEnv: ControlPlaneEnv;

async function runtime(): Promise<ControlPlaneEnv> {
  return sharedEnv;
}

beforeAll(async () => {
  instance = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "github-planning-test" },
  });
  const db = await instance.getD1Database("DB");
  for (const statement of `${d1JobStoreMigration}\n${githubPlanningMigration}`
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
  sharedEnv = {
    DB: db,
    RUN_QUEUE: { send: async () => undefined } as unknown as Queue<unknown>,
    EXECUTION_MODE: "deterministic-local",
    ALLOWED_REPOSITORY_PATH: "/workspace/roundhouse",
    ALLOWED_REMOTE_URL: "https://github.com/zorkian/roundhouse.git",
  };
});

beforeEach(async () => {
  await sharedEnv.DB.prepare("DELETE FROM github_planning_job_events").run();
  await sharedEnv.DB.prepare("DELETE FROM github_planning_jobs").run();
  await sharedEnv.DB.prepare("DELETE FROM github_plan_events").run();
  await sharedEnv.DB.prepare("DELETE FROM github_issue_plans").run();
  delete sharedEnv.EXECUTION_EVIDENCE;
});

afterAll(async () => instance.dispose());

async function proposed(issueNumber = 22) {
  return qualifyAndPlan(
    {
      issueNumber,
      issueContentSha256: "a".repeat(64),
      subject: "Improve the operator view",
      instructions: "Implement the exact requested files.",
      baseCommit: "b".repeat(40),
      requestedPaths: ["packages/domain/src/ids.ts"],
    },
    new Date("2026-07-12T00:00:00Z"),
  );
}

describe("durable issue planning", () => {
  it("reclaims interrupted planning after the five-minute lease without overlapping healthy work", async () => {
    const env = await runtime();
    const now = new Date("2026-07-16T05:03:01Z");
    const reservation = await reservePlanningJob(env, {
      requestKey: "c".repeat(64),
      jobId: `planning_job_${"c".repeat(40)}`,
      roundhouseEnvironment: "development",
      repositoryFullName: "zorkian/roundhouse",
      issueNumber: 139,
      actorId: "github:zorkian",
      command: { kind: "start" },
      now,
    });
    const binding = {
      roundhouseEnvironment: "development" as const,
      repositoryFullName: "zorkian/roundhouse",
    };
    expect(
      await claimPlanningJob(
        env,
        reservation.job.jobId,
        binding,
        now,
        5 * 60_000,
      ),
    ).toBeDefined();
    expect(
      await recoverablePlanningJobs(
        env,
        binding,
        new Date("2026-07-16T05:08:00Z"),
      ),
    ).toEqual([]);
    expect(
      await recoverablePlanningJobs(
        env,
        binding,
        new Date("2026-07-16T05:08:01Z"),
      ),
    ).toEqual([reservation.job.jobId]);
    await expect(
      claimPlanningJob(
        env,
        reservation.job.jobId,
        binding,
        new Date("2026-07-16T05:08:01Z"),
        5 * 60_000,
      ),
    ).resolves.toMatchObject({ attemptCount: 2, status: "running" });
  });

  it.each([
    ["failed", false],
    ["timed_out", true],
  ] as const)(
    "creates one fresh planning generation after %s terminal work",
    async (_status, timedOut) => {
      const env = await runtime();
      const requestKey = (timedOut ? "b" : "a").repeat(64);
      const input = {
        requestKey,
        jobId: `planning_job_${requestKey.slice(0, 40)}`,
        roundhouseEnvironment: "development" as const,
        repositoryFullName: "zorkian/roundhouse",
        issueNumber: 49,
        actorId: "github:zorkian",
        command: { kind: "replan" as const, planId: "plan_49" },
        now: new Date("2026-07-15T00:00:00Z"),
      };
      const first = await reservePlanningJob(env, input);
      expect(first).toMatchObject({
        created: true,
        job: { generation: 1, status: "queued" },
      });
      const firstClaim = await claimPlanningJob(
        env,
        first.job.jobId,
        {
          roundhouseEnvironment: "development",
          repositoryFullName: "zorkian/roundhouse",
        },
        input.now,
        30_000,
      );
      await failPlanningJob(
        env,
        first.job.jobId,
        firstClaim!.claimId,
        "planner configuration rejected the request",
        false,
        timedOut,
        input.now,
      );

      const [retry, duplicate] = await Promise.all([
        reservePlanningJob(env, {
          ...input,
          now: new Date("2026-07-15T00:01:00Z"),
        }),
        reservePlanningJob(env, {
          ...input,
          now: new Date("2026-07-15T00:01:00Z"),
        }),
      ]);
      expect([retry.created, duplicate.created].filter(Boolean)).toHaveLength(
        1,
      );
      expect(retry.job.jobId).toBe(duplicate.job.jobId);
      expect(retry.job.jobId).not.toContain("_g2");
      expect(() =>
        githubPlanningDeliverySchema.parse({
          schemaVersion: 1,
          kind: "github_issue_planning",
          jobId: retry.job.jobId,
        }),
      ).not.toThrow();
      expect(retry.job).toMatchObject({
        generation: 2,
        priorJobId: first.job.jobId,
        priorFailureReason: "planner configuration rejected the request",
        attemptCount: 0,
        status: "queued",
        roundhouseEnvironment: input.roundhouseEnvironment,
        repositoryFullName: input.repositoryFullName,
        issueNumber: input.issueNumber,
        actorId: input.actorId,
        command: input.command,
      });

      const activeRepeat = await reservePlanningJob(env, {
        ...input,
        now: new Date("2026-07-15T00:01:30Z"),
      });
      expect(activeRepeat).toMatchObject({
        created: false,
        job: { jobId: retry.job.jobId, generation: 2, status: "queued" },
      });
      const retryClaim = await claimPlanningJob(
        env,
        retry.job.jobId,
        {
          roundhouseEnvironment: "development",
          repositoryFullName: "zorkian/roundhouse",
        },
        new Date("2026-07-15T00:02:00Z"),
        30_000,
      );
      await finishPlanningJob(
        env,
        retry.job.jobId,
        retryClaim!.claimId,
        { corrected: true },
        new Date("2026-07-15T00:03:00Z"),
      );
      const completedRepeat = await reservePlanningJob(env, {
        ...input,
        now: new Date("2026-07-15T00:04:00Z"),
      });
      expect(completedRepeat).toMatchObject({
        created: false,
        job: { jobId: retry.job.jobId, generation: 2, status: "completed" },
      });

      const missingProjectionRestart = await reservePlanningJob(env, {
        ...input,
        restartCompleted: true,
        now: new Date("2026-07-15T00:05:00Z"),
      });
      expect(missingProjectionRestart).toMatchObject({
        created: true,
        job: {
          generation: 3,
          status: "queued",
          priorJobId: retry.job.jobId,
          priorFailureReason:
            "completed without durable plan or run projection",
        },
      });
    },
  );

  it("records one immutable issue plan and replays exact writes", async () => {
    const env = await runtime();
    const decision = await proposed();
    const retained = new Map<string, string>();
    let puts = 0;
    env.EXECUTION_EVIDENCE = {
      put: async (
        key: string,
        value: ArrayBuffer | ArrayBufferView | string,
      ) => {
        puts += 1;
        if (retained.has(key)) throw new Error("precondition failed");
        retained.set(
          key,
          typeof value === "string"
            ? value
            : new TextDecoder().decode(
                value instanceof ArrayBuffer
                  ? value
                  : new Uint8Array(
                      value.buffer,
                      value.byteOffset,
                      value.byteLength,
                    ),
              ),
        );
        return {} as R2Object;
      },
      get: async (key: string) =>
        retained.has(key)
          ? ({
              text: async () => retained.get(key)!,
            } as unknown as R2ObjectBody)
          : null,
    } as unknown as R2Bucket;
    const first = await recordPlanningDecision(env, decision, "github:zorkian");
    const replay = await recordPlanningDecision(
      env,
      decision,
      "github:zorkian",
    );
    expect(replay).toEqual(first);
    expect(await readIssuePlan(env, 22)).toEqual(first);
    expect(await listIssuePlans(env)).toEqual([first]);
    expect(puts).toBe(2);

    const conflicting = await qualifyAndPlan(
      {
        issueNumber: 22,
        issueContentSha256: "c".repeat(64),
        subject: "Changed issue",
        instructions: "Different immutable input.",
        baseCommit: "b".repeat(40),
        requestedPaths: ["packages/domain/src/ids.ts"],
      },
      new Date("2026-07-12T00:01:00Z"),
    );
    await expect(
      recordPlanningDecision(env, conflicting, "github:zorkian"),
    ).rejects.toThrow("different immutable plan");
  });

  it("preserves an evidence upload failure when no replay exists", async () => {
    const env = await runtime();
    const uploadFailure = new Error("simulated R2 outage");
    env.EXECUTION_EVIDENCE = {
      put: async () => {
        throw uploadFailure;
      },
      get: async () => null,
    } as unknown as R2Bucket;

    await expect(
      recordPlanningDecision(env, await proposed(), "github:zorkian"),
    ).rejects.toBe(uploadFailure);
    await expect(readIssuePlan(env, 22)).resolves.toBeNull();
  });

  it("binds approval and materialization to exact revisions", async () => {
    const env = await runtime();
    const decision = await proposed();
    await recordPlanningDecision(env, decision, "github:zorkian");
    const approved = await approvePlan(env, {
      planId: decision.planId,
      expectedRevision: 1,
      planSha256: decision.planSha256,
      actorId: "github:zorkian",
      now: new Date("2026-07-12T00:02:00Z"),
    });
    expect(approved).toMatchObject({
      revision: 2,
      status: "approved",
      approvedBy: "github:zorkian",
    });
    await expect(
      approvePlan(env, {
        planId: decision.planId,
        expectedRevision: 1,
        planSha256: decision.planSha256,
        actorId: "github:zorkian",
        now: new Date("2026-07-12T00:02:30Z"),
      }),
    ).resolves.toEqual(approved);
    await expect(
      approvePlan(env, {
        planId: decision.planId,
        expectedRevision: 1,
        planSha256: "f".repeat(64),
        actorId: "github:zorkian",
        now: new Date(),
      }),
    ).rejects.toThrow("binding does not match");
    const materialized = await materializePlan(
      env,
      decision.planId,
      "run_plan_22",
      "github:zorkian",
      new Date("2026-07-12T00:03:00Z"),
    );
    expect(materialized).toMatchObject({
      revision: 3,
      status: "materialized",
      runId: "run_plan_22",
    });
    await expect(
      materializePlan(
        env,
        decision.planId,
        "another_run",
        "github:zorkian",
        new Date(),
      ),
    ).rejects.toThrow("binding conflict");
  });

  it("retains a policy rejection that can never be approved", async () => {
    const env = await runtime();
    const decision = await qualifyAndPlan(
      {
        issueNumber: 23,
        issueContentSha256: "d".repeat(64),
        subject: "Change CI",
        instructions: "Change a protected path.",
        baseCommit: "b".repeat(40),
        requestedPaths: [".github/workflows/ci.yml"],
      },
      new Date("2026-07-12T00:00:00Z"),
    );
    await recordPlanningDecision(env, decision, "github:zorkian");
    await expect(
      approvePlan(env, {
        planId: decision.planId,
        expectedRevision: 1,
        planSha256: decision.planSha256,
        actorId: "github:zorkian",
        now: new Date(),
      }),
    ).rejects.toThrow("Qualification cannot run");
  });

  it("revises a clarification after the issue content changes", async () => {
    const env = await runtime();
    const clarification = await qualifyAndPlan(
      {
        issueNumber: 24,
        issueContentSha256: "d".repeat(64),
        subject: "Improve status",
        instructions: "Improve the status experience.",
        baseCommit: "b".repeat(40),
        requestedPaths: [],
        planningAttemptId: `planning_${"e".repeat(40)}`,
        understanding: "The intended status surface is ambiguous.",
        acceptanceCriteria: ["The selected status surface is improved."],
        clarificationQuestions: ["Should this change the issue or run page?"],
        suggestedRisk: "low",
      },
      new Date("2026-07-12T00:00:00Z"),
    );
    const first = await recordPlanningDecision(
      env,
      clarification,
      "github:zorkian",
    );
    expect(first).toMatchObject({
      revision: 1,
      status: "needs_clarification",
    });

    const answered = await qualifyAndPlan(
      {
        issueNumber: 24,
        issueContentSha256: "d".repeat(64),
        subject: "Improve issue status",
        instructions: "Improve the issue status page.",
        baseCommit: "b".repeat(40),
        requestedPaths: ["apps/control-plane-worker/src/operator-ui.ts"],
        planningAttemptId: `planning_${"f".repeat(40)}`,
        understanding: "Improve the issue status page.",
        acceptanceCriteria: ["The issue status page shows the new detail."],
        clarificationQuestions: [],
        suggestedRisk: "medium",
        planningEvidence: ["Operator answer: change the issue status page."],
      },
      new Date("2026-07-12T00:04:00Z"),
    );
    const answeredPlan = await recordPlanningDecision(
      env,
      answered,
      "github:zorkian",
      {
        planId: first.plan.planId,
        revision: first.revision,
        planSha256: first.plan.planSha256,
        allowSameIssueContent: true,
      },
    );
    expect(answeredPlan).toMatchObject({ revision: 2, status: "proposed" });

    const revised = await qualifyAndPlan(
      {
        issueNumber: 24,
        issueContentSha256: "f".repeat(64),
        subject: "Improve issue status",
        instructions: "Improve the issue status page.",
        baseCommit: "b".repeat(40),
        requestedPaths: ["apps/control-plane-worker/src/operator-ui.ts"],
        planningAttemptId: `planning_${"a".repeat(40)}`,
        understanding: "Improve the issue status page.",
        acceptanceCriteria: ["The issue status page shows the new detail."],
        clarificationQuestions: [],
        suggestedRisk: "medium",
      },
      new Date("2026-07-12T00:05:00Z"),
    );
    await expect(
      recordPlanningDecision(env, revised, "github:zorkian", {
        planId: answeredPlan.plan.planId,
        revision: answeredPlan.revision,
        planSha256: answeredPlan.plan.planSha256,
      }),
    ).resolves.toMatchObject({ revision: 3, status: "proposed" });
    await expect(readIssuePlan(env, 24)).resolves.toMatchObject({
      revision: 3,
      plan: { issueContentSha256: "f".repeat(64) },
    });
  });
});
