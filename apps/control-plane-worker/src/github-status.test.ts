// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import {
  claimPendingReviewChecks,
  enqueueReviewCheck,
  githubReviewCheckMigration,
  markReviewCheckSent,
} from "./github-status.js";

const instances: Miniflare[] = [];

async function runtime(): Promise<ControlPlaneEnv> {
  const instance = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "github-status-test" },
  });
  instances.push(instance);
  const db = await instance.getD1Database("DB");
  for (const statement of githubReviewCheckMigration
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

function projection(revision: number) {
  return {
    repositoryFullName: "zorkian/roundhouse",
    reviewId: `review_${"a".repeat(40)}`,
    pullRequestNumber: 25,
    headSha: "b".repeat(40),
    revision,
    status: "completed" as const,
    conclusion: "success" as const,
    title: `Independent review revision ${revision}`,
    summary: "No substantive findings.",
    detailsUrl: `https://roundhouse-dev.rm-rf.rip/reviews/review_${"a".repeat(40)}`,
  };
}

describe("durable GitHub review Check projection", () => {
  it("keeps repository identity explicit and ignores stale revisions", async () => {
    const env = await runtime();
    await enqueueReviewCheck(env, projection(2));
    await enqueueReviewCheck(env, projection(1));
    await expect(
      enqueueReviewCheck(env, {
        ...projection(2),
        repositoryFullName: "another/roundhouse",
      }),
    ).resolves.toBeUndefined();
    const rows = await env.DB.prepare(
      "SELECT repository_full_name, revision, title FROM github_review_check_outbox ORDER BY repository_full_name",
    ).all<{
      repository_full_name: string;
      revision: number;
      title: string;
    }>();
    expect(rows.results).toEqual([
      {
        repository_full_name: "another/roundhouse",
        revision: 2,
        title: "Independent review revision 2",
      },
      {
        repository_full_name: "zorkian/roundhouse",
        revision: 2,
        title: "Independent review revision 2",
      },
    ]);
  });

  it("grants one delivery claim and records the exact GitHub Check", async () => {
    const env = await runtime();
    await enqueueReviewCheck(env, projection(1));
    const claims = await Promise.all([
      claimPendingReviewChecks(env),
      claimPendingReviewChecks(env),
    ]);
    expect(claims.flat()).toHaveLength(1);
    const claim = claims.flat()[0]!;
    await markReviewCheckSent(
      env,
      claim.repositoryFullName,
      claim.reviewId,
      claim.revision,
      claim.claimId,
      {
        id: 91,
        url: "https://github.com/zorkian/roundhouse/runs/91",
      },
    );
    await expect(claimPendingReviewChecks(env)).resolves.toEqual([]);
    const row = await env.DB.prepare(
      "SELECT status, check_run_id, check_run_url FROM github_review_check_outbox",
    ).first<{
      status: string;
      check_run_id: number;
      check_run_url: string;
    }>();
    expect(row).toEqual({
      status: "sent",
      check_run_id: 91,
      check_run_url: "https://github.com/zorkian/roundhouse/runs/91",
    });
  });
});
