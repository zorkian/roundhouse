// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { exportPKCS8, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { GitHubAppGateway } from "./github-gateway.js";

let privateKey: string;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = await exportPKCS8(pair.privateKey);
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GitHub App gateway", () => {
  it("captures an immutable enrolled issue snapshot", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/access_tokens"))
        return json({
          token: "installation-token",
          expires_at: "2026-07-12T02:00:00Z",
        });
      if (url.pathname.endsWith("/issues/7"))
        return json({
          number: 7,
          node_id: "issue-node-7",
          html_url: "https://github.com/zorkian/roundhouse/issues/7",
          title: "Dogfood task",
          body: "Change the bounded dogfood document.",
          updated_at: "2026-07-12T00:30:00Z",
        });
      return json({}, 404);
    };
    const gateway = new GitHubAppGateway(
      { appId: "1", installationId: "2", privateKey },
      fetcher,
      () => new Date("2026-07-12T01:00:00Z"),
    );
    await expect(
      gateway.fetchIssue({
        schemaVersion: 1,
        owner: "zorkian",
        repository: "roundhouse",
        number: 7,
      }),
    ).resolves.toMatchObject({
      number: 7,
      title: "Dogfood task",
      fetchedAt: "2026-07-12T01:00:00.000Z",
    });
  });

  it("reconciles an ambiguous ref response and verifies the published commit", async () => {
    const base = "a".repeat(40);
    const tree = "c".repeat(40);
    const commit = "d".repeat(40);
    let branch: string | null = null;
    let pullCreated = false;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (url.pathname.endsWith("/access_tokens"))
        return json({
          token: "installation-token",
          expires_at: "2026-07-12T02:00:00Z",
        });
      if (url.pathname.endsWith(`/git/commits/${base}`))
        return json({ tree: { sha: "b".repeat(40) } });
      if (url.pathname.endsWith("/git/blobs") && method === "POST")
        return json({ sha: "e".repeat(40) }, 201);
      if (url.pathname.endsWith("/git/trees") && method === "POST")
        return json({ sha: tree }, 201);
      if (url.pathname.endsWith("/git/commits") && method === "POST")
        return json({ sha: commit }, 201);
      if (url.pathname.includes("/git/ref/heads/"))
        return branch ? json({ object: { sha: branch } }) : json({}, 404);
      if (url.pathname.endsWith("/git/refs") && method === "POST") {
        branch = commit;
        throw new TypeError("simulated ambiguous response");
      }
      if (url.pathname.endsWith("/pulls") && method === "GET")
        return json(
          pullCreated
            ? [
                {
                  number: 11,
                  html_url: "https://github.com/zorkian/roundhouse/pull/11",
                  head: { sha: commit },
                },
              ]
            : [],
        );
      if (url.pathname.endsWith("/pulls") && method === "POST") {
        pullCreated = true;
        return json({
          number: 11,
          html_url: "https://github.com/zorkian/roundhouse/pull/11",
          head: { sha: commit },
        });
      }
      if (url.pathname.endsWith(`/git/commits/${commit}`))
        return json({
          sha: commit,
          tree: { sha: tree },
          parents: [{ sha: base }],
        });
      return json({}, 404);
    };
    const gateway = new GitHubAppGateway(
      { appId: "1", installationId: "2", privateKey },
      fetcher,
      () => new Date("2026-07-12T01:00:00Z"),
    );
    const result = await gateway.publish({
      manifest: {
        schemaVersion: 1,
        baseCommit: base,
        patchSha256: "f".repeat(64),
        files: [
          {
            path: "docs/dogfood/github-integrated-poc.md",
            operation: "upsert",
            contentBase64: btoa("dogfood\n"),
            size: 8,
            sha256: "1".repeat(64),
          },
        ],
        sha256: "2".repeat(64),
      },
      branch: "codex/dogfood-github-integrated-poc",
      commitMessage: "Record GitHub dogfood",
      pullRequestTitle: "Roundhouse GitHub dogfood",
      issueNumber: 7,
      approvedAt: "2026-07-12T00:45:00Z",
    });
    expect(result).toMatchObject({
      commit,
      tree,
      pullRequestNumber: 11,
      reconciled: true,
    });
  });
});
