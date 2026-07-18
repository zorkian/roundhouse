// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  completionRequest,
  createCheckpoint,
  runnerIdentity,
  runnerResponse,
  validateCheckpoint,
} from "./runner.mjs";

const testRoot = resolve(process.cwd(), ".runner-test-workspaces");
afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

describe("V2 agent runner", () => {
  it("reports only its versioned runner identity", () => {
    expect(runnerResponse("GET", "/health")).toEqual({
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ ...runnerIdentity, ok: true }),
    });
  });

  it("rejects undeclared routes and mutating health requests", () => {
    expect(runnerResponse("POST", "/health")).toMatchObject({
      status: 405,
      headers: { allow: "GET" },
    });
    expect(runnerResponse("GET", "/v1/execute")).toMatchObject({
      status: 404,
      body: JSON.stringify({ error: "not_found" }),
    });
  });

  it("accepts an immutable assignment promptly and deduplicates replay", () => {
    const assignment = {
      id: "attempt_1",
      runId: "run_1",
      runRevision: 1,
      deadlineAt: Date.now() + 60_000,
      baseCommit: "a".repeat(40),
      expectedHead: "a".repeat(40),
      artifact: {
        repositoryId: "repo-id",
        repository: "v2-run-1",
        remote: "https://artifacts.invalid/v2-run-1",
        tokenId: "token-id",
        token: "secret-token",
        access: "write",
        ref: "refs/heads/roundhouse/run_1",
      },
    };
    expect(runnerResponse("POST", "/assign", assignment)).toMatchObject({
      status: 202,
      body: JSON.stringify({
        accepted: true,
        attemptId: "attempt_1",
        duplicate: false,
      }),
    });
    expect(runnerResponse("POST", "/assign", assignment)).toMatchObject({
      status: 202,
      body: JSON.stringify({
        accepted: true,
        attemptId: "attempt_1",
        duplicate: true,
      }),
    });
  });

  it("builds an attempt-bound asynchronous completion callback", async () => {
    const assignment = {
      id: "attempt_callback",
      runId: "run_1",
      runRevision: 3,
      deadlineAt: Date.now() + 60_000,
      baseCommit: "a".repeat(40),
      expectedHead: "a".repeat(40),
      artifact: { tokenId: "token-id", access: "write" },
    };
    const checkpoint = {
      repositoryId: "repo-id",
      repository: "v2-run-1",
      baseCommit: assignment.baseCommit,
      inputHead: assignment.expectedHead,
      outputHead: "b".repeat(40),
      ref: "refs/heads/roundhouse/run_1",
      changedPaths: ["src/fix.ts"],
    };
    const request = completionRequest(
      assignment,
      checkpoint,
      "https://v2.invalid/attempts/callback",
      "attempt-secret",
    );
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/attempts/callback");
    await expect(request.json()).resolves.toMatchObject({
      attemptId: assignment.id,
      expectedRevision: 3,
      checkpoint,
      artifactTokenId: "token-id",
      result: { checkpoint: checkpoint.outputHead },
      signature: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("pushes one deterministic checkpoint and resumes it from a replacement clone", async () => {
    process.env.ROUNDHOUSE_WORKSPACE_ROOT = resolve(testRoot, "runner");
    const source = resolve(testRoot, "fake-github"),
      remote = resolve(testRoot, "artifact.git");
    await mkdir(source, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: source });
    await writeFile(resolve(source, "README.md"), "fake GitHub baseline\n");
    execFileSync("git", ["add", "README.md"], { cwd: source });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@invalid",
        "commit",
        "-m",
        "baseline",
      ],
      {
        cwd: source,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
          GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
        },
      },
    );
    const baseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: source,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["clone", "--bare", source, remote]);
    const assignment = {
      id: "run_git_rev_1",
      runId: "run_git",
      runRevision: 1,
      deadlineAt: Date.now() + 60_000,
      baseCommit,
      expectedHead: baseCommit,
      protectedPaths: [".github/workflows"],
      artifact: {
        repositoryId: "artifact-repo-id",
        repository: "v2-run-git",
        remote,
        tokenId: "write-token-id",
        token: "ephemeral-write-token",
        access: "write",
        ref: "refs/heads/roundhouse/run_git",
      },
    };
    const first = await createCheckpoint(assignment);
    const replacement = await createCheckpoint(assignment);
    expect(replacement).toEqual(first);
    expect(first.inputHead).toBe(baseCommit);
    expect(first.outputHead).toMatch(/^[a-f0-9]{40}$/);
    expect(first.changedPaths).toEqual([
      ".roundhouse/checkpoints/run_git_rev_1.json",
    ]);
    await expect(
      validateCheckpoint({
        ...assignment,
        id: "run_git_rev_1_validation",
        checkpoint: first,
        artifact: { ...assignment.artifact, access: "read" },
      }),
    ).resolves.toBeUndefined();
  });
});
