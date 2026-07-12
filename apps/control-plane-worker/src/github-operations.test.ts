// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import {
  durableGitHubPublication,
  GitHubPublicationPendingError,
  githubPocMigration,
} from "./github-operations.js";

const instances: Miniflare[] = [];
const publication = {
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

async function runtime(): Promise<{ env: ControlPlaneEnv }> {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: `github-publication-${crypto.randomUUID()}` },
  });
  instances.push(mf);
  const db = await mf.getD1Database("DB");
  for (const statement of githubPocMigration
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
  return { env: { DB: db } as ControlPlaneEnv };
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((value) => value.dispose()));
});

describe("durable GitHub publication intent", () => {
  it("replays the retained result without repeating GitHub writes", async () => {
    const { env } = await runtime();
    let writes = 0;
    const publish = async () => {
      writes += 1;
      return publication;
    };
    await expect(
      durableGitHubPublication(
        env,
        "run_github",
        { expectedRevision: 6 },
        publish,
      ),
    ).resolves.toEqual(publication);
    await expect(
      durableGitHubPublication(
        env,
        "run_github",
        { expectedRevision: 6 },
        publish,
      ),
    ).resolves.toEqual(publication);
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

  it("allows only one concurrent GitHub publication leader", async () => {
    const { env } = await runtime();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const publishing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const request = { actorId: "operator@example.test", revision: 7 };
    const first = durableGitHubPublication(
      env,
      "run_concurrent",
      request,
      async () => {
        started();
        await blocked;
        return publication;
      },
    );
    await publishing;
    await expect(
      durableGitHubPublication(env, "run_concurrent", request, async () => {
        throw new Error("concurrent request must not publish");
      }),
    ).rejects.toBeInstanceOf(GitHubPublicationPendingError);
    release();
    await expect(first).resolves.toEqual(publication);
    await expect(
      durableGitHubPublication(env, "run_concurrent", request, async () => {
        throw new Error("completed request must replay");
      }),
    ).resolves.toEqual(publication);
  });
});
