// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

async function repositoryFile(path) {
  return readFile(join(root, path), "utf8");
}

describe("release workflow handoff", () => {
  it("uses gradual rollouts and exact-image Container canaries", async () => {
    const [development, production, dockerfile] = await Promise.all([
      repositoryFile(".github/workflows/release-development.yml"),
      repositoryFile(".github/workflows/promote-production.yml"),
      repositoryFile("containers/roundhouse-execution/Dockerfile"),
    ]);

    expect(development).toContain("--containers-rollout gradual");
    expect(production).toContain("--containers-rollout gradual");
    expect(development).not.toContain("--containers-rollout immediate");
    expect(production).not.toContain("--containers-rollout immediate");
    expect(development).toContain("ROUNDHOUSE_RELEASE_COMMIT=${GITHUB_SHA}");
    expect(development).toContain("/v1/releases/${GITHUB_SHA}/canary");
    expect(production).toContain("/v1/releases/${source_commit}/canary");
    expect(development).toContain("development-canary.json");
    expect(production).toContain("production-canary.json");
    expect(development).toContain("development-fleet.json");
    expect(production).toContain("production-fleet.json");
    expect(development).toContain("wrangler containers list --json");
    expect(production).toContain("wrangler containers list --json");
    expect(development).toContain('.state == "ready"');
    expect(production).toContain('.state == "ready"');
    expect(development).toContain("--retry 60");
    expect(production).toContain("--retry 60");
    expect(development).toContain("after waiting for the gradual rollout");
    expect(production).toContain("after waiting for the gradual rollout");
    expect(dockerfile).toContain("ARG ROUNDHOUSE_RELEASE_COMMIT=unknown");
    expect(dockerfile).toContain(
      "ENV ROUNDHOUSE_RELEASE_COMMIT=${ROUNDHOUSE_RELEASE_COMMIT}",
    );
  });
});
