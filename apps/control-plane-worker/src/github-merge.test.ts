// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import {
  automaticMergeApprovalMatches,
  automaticMergePolicy,
  blockIneligibleAutomaticMerge,
  claimAutomaticMerge,
  completeAutomaticMerge,
  completeAutomaticMergeProjection,
  failAutomaticMerge,
  recoverableAutomaticMerges,
  type AutomaticMergeIdentity,
} from "./github-merge.js";

let instance: Miniflare;
let database: D1Database;
let env: ControlPlaneEnv;

const identity: AutomaticMergeIdentity = {
  repositoryFullName: "zorkian/roundhouse",
  pullRequestNumber: 139,
  runId: "run_automatic_merge",
  issueNumber: 139,
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
};

beforeAll(async () => {
  instance = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "roundhouse-automatic-merge-test" },
  });
  database = await instance.getD1Database("DB");
  const migration = await readFile(
    new URL("../migrations/0015_github_automatic_merge.sql", import.meta.url),
    "utf8",
  );
  for (const statement of migration
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await database.prepare(statement).run();
  env = { DB: database } as ControlPlaneEnv;
});

beforeEach(async () => {
  await database.prepare("DELETE FROM github_automatic_merges").run();
});

afterAll(async () => {
  await instance.dispose();
});

describe("automatic GitHub merge reservation", () => {
  it("requires a non-vacuous exact approval binding", () => {
    expect(automaticMergeApprovalMatches("maintainer", "maintainer")).toBe(
      true,
    );
    expect(automaticMergeApprovalMatches(undefined, undefined)).toBe(false);
    expect(automaticMergeApprovalMatches("", "")).toBe(false);
    expect(automaticMergeApprovalMatches("maintainer", undefined)).toBe(false);
    expect(automaticMergeApprovalMatches("maintainer", "other")).toBe(false);
  });

  it("allows only materialized approved low-risk development runs", () => {
    const eligible = {
      environment: "development" as const,
      enabled: true,
      sourceEnvironment: "development" as const,
      risk: "low" as const,
      planMaterialized: true,
      runBoundToPlan: true,
      approvalMatches: true,
    };
    expect(automaticMergePolicy(eligible)).toBe(true);
    expect(
      automaticMergePolicy({ ...eligible, environment: "production" }),
    ).toBe(false);
    expect(
      automaticMergePolicy({
        ...eligible,
        sourceEnvironment: "production",
      }),
    ).toBe(false);
    expect(
      automaticMergePolicy({ ...eligible, sourceEnvironment: undefined }),
    ).toBe(false);
    expect(automaticMergePolicy({ ...eligible, risk: "medium" })).toBe(false);
    expect(automaticMergePolicy({ ...eligible, enabled: false })).toBe(false);
    expect(automaticMergePolicy({ ...eligible, planMaterialized: false })).toBe(
      false,
    );
    expect(automaticMergePolicy({ ...eligible, runBoundToPlan: false })).toBe(
      false,
    );
    expect(automaticMergePolicy({ ...eligible, approvalMatches: false })).toBe(
      false,
    );
  });

  it("claims once and reconciles the durable merge result", async () => {
    const first = await claimAutomaticMerge(
      env,
      identity,
      new Date("2026-07-15T00:00:00Z"),
    );
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") return;
    const duplicate = await claimAutomaticMerge(
      env,
      identity,
      new Date("2026-07-15T00:00:30Z"),
    );
    expect(duplicate).toEqual({ kind: "in_progress" });

    await completeAutomaticMerge(
      env,
      first.claim,
      "c".repeat(40),
      new Date("2026-07-15T00:00:45Z"),
    );
    await expect(
      claimAutomaticMerge(env, identity, new Date("2026-07-15T00:01:00Z")),
    ).resolves.toEqual({
      kind: "merged",
      mergeCommitSha: "c".repeat(40),
      projectionComplete: false,
    });
    await expect(
      recoverableAutomaticMerges(env, new Date("2026-07-15T00:03:00Z")),
    ).resolves.toEqual([identity]);
    await completeAutomaticMergeProjection(
      env,
      identity,
      "c".repeat(40),
      new Date("2026-07-15T00:03:01Z"),
    );
    await expect(
      completeAutomaticMergeProjection(
        env,
        identity,
        "c".repeat(40),
        new Date("2026-07-15T00:03:02Z"),
      ),
    ).resolves.toBeUndefined();
    await expect(
      claimAutomaticMerge(env, identity, new Date("2026-07-15T00:03:03Z")),
    ).resolves.toEqual({
      kind: "merged",
      mergeCommitSha: "c".repeat(40),
      projectionComplete: true,
    });
    await expect(
      recoverableAutomaticMerges(env, new Date("2026-07-15T00:03:02Z")),
    ).resolves.toEqual([]);
  });

  it("recovers an expired lease and stops after three failures", async () => {
    let now = new Date("2026-07-15T00:00:00Z");
    const first = await claimAutomaticMerge(env, identity, now);
    expect(first.kind).toBe("claimed");
    await expect(
      recoverableAutomaticMerges(env, new Date("2026-07-15T00:02:01Z")),
    ).resolves.toEqual([identity]);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      now = new Date(`2026-07-15T00:0${attempt * 3}:00Z`);
      const reservation = await claimAutomaticMerge(env, identity, now);
      expect(reservation.kind).toBe("claimed");
      if (reservation.kind !== "claimed") return;
      await failAutomaticMerge(
        env,
        reservation.claim,
        {
          code: "transport_failed",
          retryable: true,
          nextAction: "No action needed; retry retained.",
        },
        now,
      );
    }
    await expect(
      claimAutomaticMerge(env, identity, new Date("2026-07-15T00:20:00Z")),
    ).resolves.toEqual({ kind: "blocked" });
    await expect(
      recoverableAutomaticMerges(env, new Date("2026-07-15T00:20:00Z")),
    ).resolves.toEqual([]);
  });

  it("blocks a retained pending merge that is no longer eligible", async () => {
    const now = "2026-07-15T00:00:00.000Z";
    await database
      .prepare(
        "INSERT INTO github_automatic_merges(repository_full_name, pull_request_number, run_id, issue_number, base_sha, head_sha, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
      )
      .bind(
        identity.repositoryFullName,
        identity.pullRequestNumber,
        identity.runId,
        identity.issueNumber,
        identity.baseSha,
        identity.headSha,
        now,
        now,
      )
      .run();
    await blockIneligibleAutomaticMerge(
      env,
      identity,
      new Date("2026-07-15T00:01:00Z"),
    );
    await expect(
      claimAutomaticMerge(env, identity, new Date("2026-07-15T00:02:00Z")),
    ).resolves.toEqual({ kind: "blocked" });
    await expect(
      recoverableAutomaticMerges(env, new Date("2026-07-15T00:02:00Z")),
    ).resolves.toEqual([]);
  });

  it("keeps an active merge claim but blocks it once expired and ineligible", async () => {
    await claimAutomaticMerge(env, identity, new Date("2026-07-15T00:00:00Z"));
    await blockIneligibleAutomaticMerge(
      env,
      identity,
      new Date("2026-07-15T00:01:00Z"),
    );
    await expect(
      claimAutomaticMerge(env, identity, new Date("2026-07-15T00:01:01Z")),
    ).resolves.toEqual({ kind: "in_progress" });
    await blockIneligibleAutomaticMerge(
      env,
      identity,
      new Date("2026-07-15T00:02:01Z"),
    );
    await expect(
      claimAutomaticMerge(env, identity, new Date("2026-07-15T00:02:02Z")),
    ).resolves.toEqual({ kind: "blocked" });
  });

  it("keeps an active third claim and blocks it after lease expiry", async () => {
    let now = new Date("2026-07-15T01:00:00Z");
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const reservation = await claimAutomaticMerge(env, identity, now);
      expect(reservation.kind).toBe("claimed");
      if (reservation.kind !== "claimed") return;
      if (attempt < 3)
        await failAutomaticMerge(
          env,
          reservation.claim,
          {
            code: "transport_failed",
            retryable: true,
            nextAction: "No action needed; retry retained.",
          },
          now,
        );
      now = new Date(now.getTime() + 3 * 60_000);
    }
    await expect(
      claimAutomaticMerge(env, identity, new Date("2026-07-15T01:06:30Z")),
    ).resolves.toEqual({ kind: "in_progress" });
    await expect(
      recoverableAutomaticMerges(env, new Date("2026-07-15T01:08:01Z")),
    ).resolves.toEqual([identity]);
    await expect(
      claimAutomaticMerge(env, identity, new Date("2026-07-15T01:08:01Z")),
    ).resolves.toEqual({ kind: "blocked" });
    await expect(
      recoverableAutomaticMerges(env, new Date("2026-07-15T01:08:02Z")),
    ).resolves.toEqual([]);
  });

  it("rejects a conflicting run identity for the same exact head", async () => {
    await claimAutomaticMerge(env, identity);
    await expect(
      claimAutomaticMerge(env, { ...identity, runId: "run_conflict" }),
    ).rejects.toThrow("Automatic merge identity conflict");
  });
});
