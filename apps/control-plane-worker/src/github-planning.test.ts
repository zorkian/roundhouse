// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { qualifyAndPlan } from "@roundhouse/self-development/cloudflare";
import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import {
  approvePlan,
  githubPlanningMigration,
  listIssuePlans,
  materializePlan,
  readIssuePlan,
  recordPlanningDecision,
} from "./github-planning.js";

const instances: Miniflare[] = [];

async function runtime(): Promise<ControlPlaneEnv> {
  const instance = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "github-planning-test" },
  });
  instances.push(instance);
  const db = await instance.getD1Database("DB");
  for (const statement of githubPlanningMigration
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
  it("records one immutable issue plan and replays exact writes", async () => {
    const env = await runtime();
    const decision = await proposed();
    const first = await recordPlanningDecision(env, decision, "github:zorkian");
    const replay = await recordPlanningDecision(
      env,
      decision,
      "github:zorkian",
    );
    expect(replay).toEqual(first);
    expect(await readIssuePlan(env, 22)).toEqual(first);
    expect(await listIssuePlans(env)).toEqual([first]);

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
    ).rejects.toThrow("Rejected plan cannot run");
  });
});
