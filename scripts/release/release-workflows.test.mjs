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
  it("ships the durable async-planning tables as a deployment migration", async () => {
    const migration = await repositoryFile(
      "apps/control-plane-worker/migrations/0014_async_github_planning.sql",
    );
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS github_planning_jobs",
    );
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS github_planning_job_events",
    );
    expect(migration).toContain("roundhouse_environment TEXT NOT NULL");
  });

  it("starts new attempts on the new image without interrupting active attempts", async () => {
    const [development, production, dockerfile] = await Promise.all([
      repositoryFile(".github/workflows/release-development.yml"),
      repositoryFile(".github/workflows/promote-production.yml"),
      repositoryFile("containers/roundhouse-execution/Dockerfile"),
    ]);

    expect(development).toContain("--containers-rollout immediate");
    expect(production).toContain("--containers-rollout immediate");
    expect(development).not.toContain("--containers-rollout gradual");
    expect(production).not.toContain("--containers-rollout gradual");
    expect(development).toContain("ROUNDHOUSE_RELEASE_COMMIT=${GITHUB_SHA}");
    expect(development).toContain("/v1/releases/${GITHUB_SHA}/canary");
    expect(production).toContain("/v1/releases/${source_commit}/canary");
    expect(development).toMatch(
      /canary_status="\$\(curl \\\n\s+--fail-with-body \\\n[\s\S]*?--retry-all-errors/,
    );
    expect(production).toMatch(
      /canary_status="\$\(curl \\\n\s+--fail-with-body \\\n[\s\S]*?--retry-all-errors/,
    );
    expect(development).toContain("development-canary.json");
    expect(production).toContain("production-canary.json");
    expect(development).not.toContain("development-fleet.json");
    expect(production).not.toContain("production-fleet.json");
    expect(development).not.toContain("wrangler containers list --json");
    expect(production).not.toContain("wrangler containers list --json");
    expect(development).toContain("--retry 60");
    expect(production).toContain("--retry 60");
    expect(development).toContain("while waiting for the new image");
    expect(production).toContain("while waiting for the new image");
    expect(dockerfile).toContain("ARG ROUNDHOUSE_RELEASE_COMMIT=unknown");
    expect(dockerfile).toContain(
      "ENV ROUNDHOUSE_RELEASE_COMMIT=${ROUNDHOUSE_RELEASE_COMMIT}",
    );
  });
});
