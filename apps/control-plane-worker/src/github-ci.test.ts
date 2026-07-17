// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import {
  classifyCiFailure,
  exactHeadIsReady,
  githubCiMigration,
  isRoundhouseReviewCheck,
  readCiRemediation,
  recordCiOutcome,
  recordCiRecovery,
  reserveCiRecovery,
  resolveCiRecoveriesForHead,
} from "./github-ci.js";
import { githubReviewCheckMigration } from "./github-status.js";

let instance: Miniflare;
let env: ControlPlaneEnv;

beforeAll(async () => {
  instance = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "github-ci-test" },
  });
  const db = await instance.getD1Database("DB");
  for (const statement of `${githubReviewCheckMigration}\n${githubCiMigration}`
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
  env = {
    DB: db,
    RUN_QUEUE: { send: async () => undefined } as unknown as Queue<unknown>,
    EXECUTION_MODE: "deterministic-local",
    ALLOWED_REPOSITORY_PATH: "/workspace/roundhouse",
    ALLOWED_REMOTE_URL: "https://github.com/zorkian/roundhouse.git",
  };
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM github_ci_remediations").run();
  await env.DB.prepare("DELETE FROM github_ci_outcomes").run();
  await env.DB.prepare("DELETE FROM github_review_check_outbox").run();
});

afterAll(async () => instance.dispose());

const observation = {
  repositoryFullName: "zorkian/roundhouse",
  pullRequestNumber: 76,
  headSha: "a".repeat(40),
  checkRunId: 91,
  appId: 15368,
  actionsJobId: 123,
  name: "CI",
  status: "completed",
  conclusion: "failure",
};

describe("GitHub CI coordination", () => {
  it("excludes an exact App identity or persisted review Check identity", async () => {
    await expect(
      isRoundhouseReviewCheck(env, observation, 15368),
    ).resolves.toBe(false);
    await env.DB.prepare(
      "INSERT INTO github_review_check_outbox(repository_full_name, review_id, pull_request_number, head_sha, revision, check_status, conclusion, title, summary, details_url, status, check_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'completed', 'success', 'passed', 'passed', ?, 'sent', ?, ?, ?)",
    )
      .bind(
        observation.repositoryFullName,
        `review_${"b".repeat(40)}`,
        observation.pullRequestNumber,
        observation.headSha,
        `https://roundhouse-dev.rm-rf.rip/reviews/review_${"b".repeat(40)}`,
        observation.checkRunId,
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();
    await expect(isRoundhouseReviewCheck(env, observation, 999)).resolves.toBe(
      false,
    );
    await expect(
      isRoundhouseReviewCheck(env, observation, observation.appId),
    ).resolves.toBe(true);
  });

  it("reserves exactly one recovery for duplicate deliveries", async () => {
    await expect(reserveCiRecovery(env, observation)).resolves.toBe("reserved");
    await expect(reserveCiRecovery(env, observation)).resolves.toBe(
      "duplicate",
    );
    await expect(
      reserveCiRecovery(env, { ...observation, checkRunId: 92 }),
    ).resolves.toBe("exhausted");
    await resolveCiRecoveriesForHead(env, {
      ...observation,
      checkRunId: 92,
      conclusion: "success",
    });
    await expect(
      env.DB.prepare(
        "SELECT disposition, classification, next_action FROM github_ci_remediations ORDER BY check_run_id",
      ).all(),
    ).resolves.toMatchObject({
      results: [
        {
          disposition: "resolved",
          classification: "ci_passed",
          next_action: "No action is needed.",
        },
        {
          disposition: "resolved",
          classification: "ci_passed",
          next_action: "No action is needed.",
        },
      ],
    });
  });

  it("retains the exact remediation authority binding", async () => {
    await expect(reserveCiRecovery(env, observation)).resolves.toBe("reserved");
    await recordCiRecovery(env, observation, {
      disposition: "remediation_started",
      classification: "actionable",
      evidenceSha256: "b".repeat(64),
      remediationRunId: "run_ci_remediation",
    });
    await expect(readCiRemediation(env, observation)).resolves.toMatchObject({
      repositoryFullName: observation.repositoryFullName,
      pullRequestNumber: observation.pullRequestNumber,
      headSha: observation.headSha,
      checkRunId: observation.checkRunId,
      disposition: "remediation_started",
      attemptCount: 1,
      evidenceSha256: "b".repeat(64),
      remediationRunId: "run_ci_remediation",
    });
    await expect(
      readCiRemediation(env, { ...observation, checkRunId: 999 }),
    ).resolves.toBeNull();
  });

  it("keeps review and CI separate when calculating exact-head readiness", async () => {
    await recordCiOutcome(env, { ...observation, conclusion: "success" });
    await expect(
      exactHeadIsReady(
        env,
        observation.repositoryFullName,
        observation.pullRequestNumber,
        observation.headSha,
      ),
    ).resolves.toBe(false);
    await env.DB.prepare(
      "INSERT INTO github_review_check_outbox(repository_full_name, review_id, pull_request_number, head_sha, revision, check_status, conclusion, title, summary, details_url, status, check_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 'completed', 'success', 'passed', 'passed', ?, 'sent', 92, ?, ?)",
    )
      .bind(
        observation.repositoryFullName,
        `review_${"c".repeat(40)}`,
        observation.pullRequestNumber,
        observation.headSha,
        `https://roundhouse-dev.rm-rf.rip/reviews/review_${"c".repeat(40)}`,
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();
    await expect(
      exactHeadIsReady(
        env,
        observation.repositoryFullName,
        observation.pullRequestNumber,
        observation.headSha,
      ),
    ).resolves.toBe(true);
  });

  it("classifies bounded transient evidence conservatively", () => {
    expect(classifyCiFailure("runner was lost during test execution")).toBe(
      "transient",
    );
    expect(classifyCiFailure("AssertionError: expected 1 to equal 2")).toBe(
      "actionable",
    );
  });
});
