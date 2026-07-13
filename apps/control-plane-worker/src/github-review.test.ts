// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  normalizeReviewFindings,
  reviewIdentity,
  type IndependentReviewExecution,
  type IndependentReviewRequest,
} from "@roundhouse/self-development/cloudflare";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import {
  claimIndependentReview,
  completeIndependentReview,
  failIndependentReview,
  markReviewDispatched,
  readIndependentReview,
  readReviewByRemediationRun,
  recordReviewRemediation,
  recoverableReviewDeliveries,
  reserveIndependentReview,
} from "./github-review.js";

let instance: Miniflare;
let env: ControlPlaneEnv;
const resetTables = [
  "independent_review_findings",
  "independent_review_events",
  "independent_reviews",
] as const;

async function runtime(): Promise<ControlPlaneEnv> {
  return env;
}

beforeAll(async () => {
  instance = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "independent-review-test" },
  });
  const db = await instance.getD1Database("DB");
  const migration = await readFile(
    new URL("../migrations/0008_independent_review.sql", import.meta.url),
    "utf8",
  );
  for (const statement of migration
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
  for (const table of resetTables)
    await env.DB.prepare(`DELETE FROM ${table}`).run();
});

afterAll(async () => {
  await instance.dispose();
});

async function request(): Promise<IndependentReviewRequest> {
  const identity = {
    runId: "run_review_store",
    headCommit: "c".repeat(40),
    cycle: 1,
  };
  const reviewId = await reviewIdentity(identity);
  return {
    schemaVersion: 1,
    reviewId,
    attemptId: `${reviewId}-attempt-1`,
    attemptNumber: 1,
    cycle: 1,
    runId: identity.runId,
    repositoryUrl: "https://github.com/zorkian/roundhouse.git",
    issueNumber: 24,
    issueUrl: "https://github.com/zorkian/roundhouse/issues/24",
    pullRequestNumber: 25,
    pullRequestUrl: "https://github.com/zorkian/roundhouse/pull/25",
    branch: "codex/dogfood-review-loop",
    baseCommit: "b".repeat(40),
    headCommit: identity.headCommit,
    patchSha256: "d".repeat(64),
    subject: "Review exact implementation",
    instructions: "Validate the exact requested behavior.",
    allowedPaths: ["packages/domain/src/ids.ts"],
    planning: {
      planId: `plan_${"e".repeat(40)}`,
      planRevision: 1,
      planSha256: "f".repeat(64),
    },
    evidence: [
      {
        evidenceId: "evidence_implementation",
        objectKey: "runs/run_review_store/implementation.json",
        sha256: "1".repeat(64),
        size: 123,
      },
    ],
    timeoutMs: 60_000,
    maxOutputBytes: 256 * 1024,
    maxFindings: 10,
    scenario: "success",
  };
}

async function execution(
  input: IndependentReviewRequest,
): Promise<IndependentReviewExecution> {
  const findings = await normalizeReviewFindings(
    input.reviewId,
    input.headCommit,
    [
      {
        severity: "medium",
        path: input.allowedPaths[0],
        title: "Substantive defect",
        rationale: "The implementation does not enforce the contract.",
        recommendation: "Enforce the exact contract.",
      },
      {
        severity: "low",
        path: input.allowedPaths[0],
        title: "Minor naming concern",
        rationale: "A name could be clearer.",
        recommendation: "Consider a clearer name later.",
      },
    ],
    input.maxFindings,
  );
  return {
    result: {
      schemaVersion: 1,
      reviewId: input.reviewId,
      attemptId: input.attemptId,
      cycle: input.cycle,
      runId: input.runId,
      baseCommit: input.baseCommit,
      headCommit: input.headCommit,
      patchSha256: input.patchSha256,
      startedAt: "2026-07-12T00:00:01.000Z",
      completedAt: "2026-07-12T00:00:02.000Z",
      startupDurationMs: 100,
      provider: "claude-subscription",
      model: "claude-sonnet-4-6",
      summary: "One substantive and one deferred finding.",
      findings,
      outputBytes: 1_000,
      usage: { inputTokens: 100, outputTokens: 50, turns: 1 },
      network: {
        checkoutHosts: ["github.com"],
        modelHosts: ["api.anthropic.com"],
        reviewerToolsEnabled: false,
        arbitraryInternetEnabled: false,
        deniedHttpProbe: true,
        deniedTcpProbe: true,
      },
      credential: {
        installedAtRuntime: true,
        writtenToFilesystem: false,
        absentFromEvidence: true,
      },
      resources: { diskBytes: 1_000, memoryBytes: 2_000 },
    },
    evidence: {
      evidenceId: `review_evidence_${input.attemptId}`,
      attemptId: input.attemptId,
      objectKey: `reviews/${input.reviewId}/${input.attemptId}.json`,
      sha256: "2".repeat(64),
      size: 2_000,
      mediaType: "application/json",
      createdAt: "2026-07-12T00:00:02.000Z",
    },
  };
}

describe("durable independent review coordination", () => {
  it("reserves and replays one exact review intent", async () => {
    const env = await runtime();
    const input = await request();
    const first = await reserveIndependentReview(
      env,
      input,
      new Date("2026-07-12T00:00:00Z"),
    );
    const replay = await reserveIndependentReview(
      env,
      input,
      new Date("2026-07-12T00:00:01Z"),
    );

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.review).toEqual(first.review);
    await expect(
      reserveIndependentReview(
        env,
        { ...input, subject: "Conflicting review" },
        new Date("2026-07-12T00:00:02Z"),
      ),
    ).rejects.toThrow("conflicts with durable intent");
  });

  it("grants one lease and safely reclaims the same expired attempt", async () => {
    const env = await runtime();
    const input = await request();
    await reserveIndependentReview(
      env,
      input,
      new Date("2026-07-12T00:00:00Z"),
    );
    const first = await claimIndependentReview(
      env,
      input.reviewId,
      "worker-a",
      new Date("2026-07-12T00:00:01Z"),
      1_000,
    );
    const duplicate = await claimIndependentReview(
      env,
      input.reviewId,
      "worker-b",
      new Date("2026-07-12T00:00:01.500Z"),
      1_000,
    );
    const reclaimed = await claimIndependentReview(
      env,
      input.reviewId,
      "worker-b",
      new Date("2026-07-12T00:00:03Z"),
      1_000,
    );

    expect(first?.review.attemptCount).toBe(1);
    expect(duplicate).toBeNull();
    expect(reclaimed?.review.attemptCount).toBe(1);
    expect(reclaimed?.review.reclaimCount).toBe(1);
    expect(reclaimed?.review.activeAttemptId).toBe(
      first?.review.activeAttemptId,
    );
    expect(reclaimed?.token).not.toBe(first?.token);
  });

  it("fails durably after the bounded same-attempt reclaim budget", async () => {
    const env = await runtime();
    const input = await request();
    await reserveIndependentReview(
      env,
      input,
      new Date("2026-07-12T00:00:00Z"),
    );
    let claim = await claimIndependentReview(
      env,
      input.reviewId,
      "worker-a",
      new Date("2026-07-12T00:00:01Z"),
      1_000,
    );
    claim = await claimIndependentReview(
      env,
      input.reviewId,
      "worker-b",
      new Date("2026-07-12T00:00:03Z"),
      1_000,
    );
    claim = await claimIndependentReview(
      env,
      input.reviewId,
      "worker-c",
      new Date("2026-07-12T00:00:05Z"),
      1_000,
    );
    expect(claim?.review).toMatchObject({
      attemptCount: 1,
      reclaimCount: 2,
      activeAttemptId: `${input.reviewId}-attempt-1`,
    });
    await expect(
      claimIndependentReview(
        env,
        input.reviewId,
        "worker-d",
        new Date("2026-07-12T00:00:07Z"),
        1_000,
      ),
    ).resolves.toBeNull();
    await expect(
      readIndependentReview(env, input.reviewId),
    ).resolves.toMatchObject({
      status: "failed",
      attemptCount: 1,
      reclaimCount: 2,
      failureClassification: "review_lease_reclaim_exhausted",
    });
  });

  it("retains findings, dispositions, evidence, and remediation identity", async () => {
    const env = await runtime();
    const input = await request();
    await reserveIndependentReview(
      env,
      input,
      new Date("2026-07-12T00:00:00Z"),
    );
    const claim = await claimIndependentReview(
      env,
      input.reviewId,
      "worker-a",
      new Date("2026-07-12T00:00:01Z"),
      60_000,
    );
    const completed = await completeIndependentReview(
      env,
      input.reviewId,
      claim!.token,
      await execution(claim!.review.request),
      new Date("2026-07-12T00:00:02Z"),
    );

    expect(completed.status).toBe("remediation_pending");
    expect(
      completed.dispositions.map((value) => value.disposition).sort(),
    ).toEqual(["accepted", "deferred"]);
    expect(completed.execution?.evidence.sha256).toBe("2".repeat(64));
    const remediated = await recordReviewRemediation(
      env,
      input.reviewId,
      "run_remediation_1",
      new Date("2026-07-12T00:00:03Z"),
    );
    expect(remediated).toMatchObject({
      status: "remediated",
      remediationRunId: "run_remediation_1",
    });
    await expect(
      readReviewByRemediationRun(env, "run_remediation_1"),
    ).resolves.toMatchObject({ request: { reviewId: input.reviewId } });
  });

  it("defers otherwise accepted findings at the bounded second cycle", async () => {
    const env = await runtime();
    const original = await request();
    const reviewId = await reviewIdentity({
      runId: "run_review_cycle_2",
      headCommit: "9".repeat(40),
      cycle: 2,
    });
    const input = {
      ...original,
      reviewId,
      attemptId: `${reviewId}-attempt-1`,
      cycle: 2 as const,
      runId: "run_review_cycle_2",
      headCommit: "9".repeat(40),
    };
    await reserveIndependentReview(
      env,
      input,
      new Date("2026-07-12T00:00:00Z"),
    );
    const claim = await claimIndependentReview(
      env,
      reviewId,
      "worker-a",
      new Date("2026-07-12T00:00:01Z"),
      60_000,
    );
    const completed = await completeIndependentReview(
      env,
      reviewId,
      claim!.token,
      await execution(claim!.review.request),
      new Date("2026-07-12T00:00:02Z"),
    );
    expect(completed.status).toBe("completed");
    expect(
      completed.dispositions.every((value) => value.disposition === "deferred"),
    ).toBe(true);
  });

  it("bounds retry attempts and exposes stranded or expired delivery", async () => {
    const env = await runtime();
    const input = await request();
    await reserveIndependentReview(
      env,
      input,
      new Date("2026-07-12T00:00:00Z"),
    );
    await expect(
      recoverableReviewDeliveries(env, new Date("2026-07-12T00:00:00.500Z")),
    ).resolves.toHaveLength(1);
    await markReviewDispatched(env, input.reviewId);
    await expect(
      recoverableReviewDeliveries(env, new Date("2026-07-12T00:00:00.500Z")),
    ).resolves.toEqual([]);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claim = await claimIndependentReview(
        env,
        input.reviewId,
        "worker-a",
        new Date(`2026-07-12T00:00:0${attempt}Z`),
        500,
      );
      const failed = await failIndependentReview(
        env,
        input.reviewId,
        claim!.token,
        {
          retryable: true,
          classification: "container_interrupted",
          reason: "simulated interruption",
        },
        new Date(`2026-07-12T00:00:0${attempt}.250Z`),
      );
      expect(failed.status).toBe(attempt < 3 ? "pending" : "failed");
    }
    expect(
      (await readIndependentReview(env, input.reviewId))?.attemptCount,
    ).toBe(3);
  });
});
