// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import {
  durableGitHubPublication,
  githubPocMigration,
} from "./github-operations.js";

const instances: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map((value) => value.dispose()));
});

describe("durable GitHub publication intent", () => {
  it("replays the retained result without repeating GitHub writes", async () => {
    const mf = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok') } }",
      d1Databases: { DB: "github-publication-local" },
    });
    instances.push(mf);
    const db = await mf.getD1Database("DB");
    for (const statement of githubPocMigration
      .split(";")
      .map((value) => value.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
    const env = { DB: db } as ControlPlaneEnv;
    const result = {
      schemaVersion: 1 as const,
      repository: "zorkian/roundhouse" as const,
      baseCommit: "a".repeat(40),
      patchSha256: "b".repeat(64),
      tree: "c".repeat(40),
      commit: "d".repeat(40),
      branch: "codex/dogfood-issue-7",
      pullRequestNumber: 11,
      pullRequestUrl: "https://github.com/zorkian/roundhouse/pull/11",
      verifiedAt: "2026-07-12T00:00:00.000Z",
      reconciled: false,
    };
    let writes = 0;
    const publish = async () => {
      writes += 1;
      return result;
    };
    await expect(
      durableGitHubPublication(
        env,
        "run_github",
        { expectedRevision: 6 },
        publish,
      ),
    ).resolves.toEqual(result);
    await expect(
      durableGitHubPublication(
        env,
        "run_github",
        { expectedRevision: 6 },
        publish,
      ),
    ).resolves.toEqual(result);
    expect(writes).toBe(1);
    await expect(
      durableGitHubPublication(
        env,
        "run_github",
        { expectedRevision: 7 },
        publish,
      ),
    ).rejects.toThrow("conflicts with durable intent");
  });
});
