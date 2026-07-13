// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  normalizeReviewFindings,
  type IndependentReviewRequest,
  type IndependentReviewResult,
} from "@roundhouse/self-development/cloudflare";
import { describe, expect, it, vi } from "vitest";

import type {
  EvidenceBucketPort,
  ExecutionContainerPort,
} from "./cloudflare-execution.js";
import { CloudflareIndependentReviewBackend } from "./cloudflare-review.js";

const token = `setup-token-${"s".repeat(80)}`;

function request(): IndependentReviewRequest {
  return {
    schemaVersion: 1,
    reviewId: `review_${"a".repeat(40)}`,
    attemptId: "review_attempt_1",
    attemptNumber: 1,
    cycle: 1,
    runId: "run_review_1",
    repositoryUrl: "https://github.com/zorkian/roundhouse.git",
    issueNumber: 24,
    issueUrl: "https://github.com/zorkian/roundhouse/issues/24",
    pullRequestNumber: 25,
    pullRequestUrl: "https://github.com/zorkian/roundhouse/pull/25",
    branch: "codex/dogfood-review-loop",
    baseCommit: "b".repeat(40),
    headCommit: "c".repeat(40),
    patchSha256: "d".repeat(64),
    subject: "Review the exact implementation",
    instructions: "Check the exact approved behavior.",
    allowedPaths: ["packages/domain/src/ids.ts"],
    planning: {
      planId: `plan_${"e".repeat(40)}`,
      planRevision: 1,
      planSha256: "f".repeat(64),
    },
    evidence: [
      {
        evidenceId: "evidence_implementation",
        objectKey: "runs/run_review_1/implementation.json",
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

async function result(
  input: IndependentReviewRequest,
): Promise<IndependentReviewResult> {
  return {
    schemaVersion: 1,
    reviewId: input.reviewId,
    attemptId: input.attemptId,
    cycle: input.cycle,
    runId: input.runId,
    baseCommit: input.baseCommit,
    headCommit: input.headCommit,
    patchSha256: input.patchSha256,
    startedAt: "2026-07-12T00:00:00.000Z",
    completedAt: "2026-07-12T00:00:01.000Z",
    startupDurationMs: 100,
    provider: "claude-subscription",
    model: "claude-sonnet-4-6",
    summary: "One material finding.",
    findings: await normalizeReviewFindings(
      input.reviewId,
      input.headCommit,
      [
        {
          severity: "high",
          path: "packages/domain/src/ids.ts",
          line: 12,
          title: "Reject malformed identity",
          rationale: "The predicate accepts an invalid value.",
          recommendation: "Validate the complete identity syntax.",
        },
      ],
      input.maxFindings,
    ),
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
  };
}

function bucket() {
  const retained = new Map<string, string>();
  return {
    retained,
    port: {
      get: async (key: string) =>
        retained.has(key) ? { text: async () => retained.get(key)! } : null,
      put: async (key: string, bytes: Uint8Array) => {
        if (retained.has(key)) return null;
        retained.set(key, new TextDecoder().decode(bytes));
        return {};
      },
    } as EvidenceBucketPort,
  };
}

describe("Cloudflare independent review backend", () => {
  it("retains one exact result and replays it without another Container", async () => {
    const input = request();
    const expected = await result(input);
    const runReviewJob = vi.fn(async () => expected);
    const container = {
      runReviewJob,
      destroy: vi.fn(async () => undefined),
    } as unknown as ExecutionContainerPort;
    const evidence = bucket();
    const backend = new CloudflareIndependentReviewBackend(
      { getByName: () => container },
      evidence.port,
      JSON.stringify({ oauthToken: token }),
    );

    const first = await backend.execute(input);
    const replay = await backend.execute(input);

    expect(replay).toEqual(first);
    expect(runReviewJob).toHaveBeenCalledTimes(1);
    expect(first.evidence.objectKey).toBe(
      `reviews/${input.reviewId}/attempts/${input.attemptId}/review.json`,
    );
    expect(first.evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a retained object containing the active Claude credential", async () => {
    const input = request();
    const retained = await result(input);
    retained.summary = `unsafe retained credential: ${token}`;
    const evidence = bucket();
    evidence.retained.set(
      `reviews/${input.reviewId}/attempts/${input.attemptId}/review.json`,
      JSON.stringify(retained),
    );
    const runReviewJob = vi.fn();
    const backend = new CloudflareIndependentReviewBackend(
      {
        getByName: () =>
          ({
            runJob: vi.fn(),
            runReviewJob,
            destroy: vi.fn(),
          }) as unknown as ExecutionContainerPort,
      },
      evidence.port,
      JSON.stringify({ oauthToken: token }),
    );
    await expect(backend.execute(input)).rejects.toThrow(
      "Claude review credential leaked into evidence",
    );
    expect(runReviewJob).not.toHaveBeenCalled();
  });

  it("rejects a result for another exact head", async () => {
    const input = request();
    const mismatched = { ...(await result(input)), headCommit: "9".repeat(40) };
    const container = {
      runReviewJob: async () => mismatched,
      destroy: async () => undefined,
    } as unknown as ExecutionContainerPort;
    const evidence = bucket();
    const backend = new CloudflareIndependentReviewBackend(
      { getByName: () => container },
      evidence.port,
      JSON.stringify({ oauthToken: token }),
    );

    await expect(backend.execute(input)).rejects.toThrow(
      "Independent review execution failed",
    );
    expect(evidence.retained.size).toBe(0);
  });

  it("refuses to retain the Claude token as evidence", async () => {
    const input = request();
    const leaked = { ...(await result(input)), summary: `leak ${token}` };
    const container = {
      runReviewJob: async () => leaked,
      destroy: async () => undefined,
    } as unknown as ExecutionContainerPort;
    const evidence = bucket();
    const backend = new CloudflareIndependentReviewBackend(
      { getByName: () => container },
      evidence.port,
      JSON.stringify({ oauthToken: token }),
    );

    await expect(backend.execute(input)).rejects.toThrow(
      "credential leaked into evidence",
    );
    expect(evidence.retained.size).toBe(0);
  });
});
