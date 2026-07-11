// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { publishApprovedPatch } from "./approved-publication.js";
import { inventoryChangedFiles } from "./changed-files.js";
import {
  captureRepositoryPatch,
  type SupervisedValidationResult,
} from "./supervised-validation.js";
import {
  persistValidationArtifacts,
  recordValidationApproval,
} from "./validation-artifacts.js";

const execFileAsync = promisify(execFile);
const temporaryPaths: string[] = [];

async function git(repository: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
  return stdout.trim();
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryPaths.push(path);
  return path;
}

async function createRepository(): Promise<{ path: string; base: string }> {
  const path = await temporaryDirectory("roundhouse-publication-");
  await git(path, "init", "--initial-branch=main");
  await git(path, "config", "user.name", "Roundhouse Test");
  await git(path, "config", "user.email", "roundhouse@example.invalid");
  await writeFile(join(path, "tracked.ts"), "export const before = true;\n");
  await git(path, "add", ".");
  await git(path, "commit", "-m", "base");
  return { path, base: await git(path, "rev-parse", "HEAD") };
}

async function prepareApproval(repository: {
  path: string;
  base: string;
}): Promise<{ artifactRoot: string; patchSha256: string }> {
  await writeFile(
    join(repository.path, "tracked.ts"),
    "export const after = true;\n",
  );
  await writeFile(
    join(repository.path, "untracked.ts"),
    "export const added = true;\n",
  );
  const changedFiles = await inventoryChangedFiles(
    repository.path,
    repository.base,
  );
  const patch = await captureRepositoryPatch(
    repository.path,
    repository.base,
    changedFiles,
  );
  const patchSha256 = createHash("sha256").update(patch).digest("hex");
  const result: SupervisedValidationResult = {
    patch,
    executions: [],
    evidence: {
      schemaVersion: 1,
      baseCommit: repository.base,
      requestedLevel: "quick",
      effectiveLevel: "quick",
      changedFiles,
      reasons: [],
      commands: [],
      succeeded: true,
      patchSha256,
      patchBytes: Buffer.byteLength(patch),
    },
  };
  const artifactRoot = await temporaryDirectory("roundhouse-artifacts-");
  await persistValidationArtifacts(artifactRoot, "run_publish", result);
  await recordValidationApproval(artifactRoot, {
    schemaVersion: 1,
    runId: "run_publish",
    actorId: "mark",
    baseCommit: repository.base,
    patchSha256,
    approvedAt: "2026-07-11T00:00:00.000Z",
  });
  return { artifactRoot, patchSha256 };
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("publishApprovedPatch", () => {
  it("commits only the exact approved patch", async () => {
    const repository = await createRepository();
    const approved = await prepareApproval(repository);

    const result = await publishApprovedPatch({
      repositoryPath: repository.path,
      artifactRoot: approved.artifactRoot,
      runId: "run_publish",
      message: "Apply approved change",
    });

    expect(result.patchSha256).toBe(approved.patchSha256);
    expect(result.baseCommit).toBe(repository.base);
    expect(await git(repository.path, "status", "--porcelain")).toBe("");
    expect(
      await git(repository.path, "show", "--format=%s", "--no-patch"),
    ).toBe("Apply approved change");
  });

  it("rejects publication when HEAD moved after approval", async () => {
    const repository = await createRepository();
    const approved = await prepareApproval(repository);
    await git(repository.path, "commit", "--allow-empty", "-m", "advance");

    await expect(
      publishApprovedPatch({
        repositoryPath: repository.path,
        artifactRoot: approved.artifactRoot,
        runId: "run_publish",
        message: "Apply approved change",
      }),
    ).rejects.toThrow("HEAD does not match the approved base commit");
  });

  it("rejects a pre-existing staged change", async () => {
    const repository = await createRepository();
    const approved = await prepareApproval(repository);
    await git(repository.path, "add", "tracked.ts");

    await expect(
      publishApprovedPatch({
        repositoryPath: repository.path,
        artifactRoot: approved.artifactRoot,
        runId: "run_publish",
        message: "Apply approved change",
      }),
    ).rejects.toThrow("The Git index contains pre-existing staged changes");
  });
});
