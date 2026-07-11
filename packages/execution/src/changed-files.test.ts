// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { inventoryChangedFiles } from "./changed-files.js";

const execFileAsync = promisify(execFile);
const repositories: string[] = [];

async function git(repository: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
  return stdout.trim();
}

async function createRepository(): Promise<{ path: string; base: string }> {
  const path = await mkdtemp(join(tmpdir(), "roundhouse-changes-"));
  repositories.push(path);
  await git(path, "init", "--initial-branch=main");
  await git(path, "config", "user.name", "Roundhouse Test");
  await git(path, "config", "user.email", "roundhouse@example.invalid");
  await writeFile(join(path, "modify.ts"), "before\n");
  await writeFile(join(path, "rename.ts"), "rename me\n");
  await git(path, "add", ".");
  await git(path, "commit", "-m", "base");
  return { path, base: await git(path, "rev-parse", "HEAD") };
}

afterEach(async () => {
  await Promise.all(
    repositories
      .splice(0)
      .map((repository) => rm(repository, { force: true, recursive: true })),
  );
});

describe("inventoryChangedFiles", () => {
  it("includes staged, unstaged, renamed, and untracked paths", async () => {
    const repository = await createRepository();
    await writeFile(join(repository.path, "modify.ts"), "after\n");
    await rename(
      join(repository.path, "rename.ts"),
      join(repository.path, "renamed.ts"),
    );
    await git(repository.path, "add", "renamed.ts", "rename.ts");
    await writeFile(join(repository.path, "untracked.ts"), "new\n");

    await expect(
      inventoryChangedFiles(repository.path, repository.base),
    ).resolves.toEqual([
      { path: "modify.ts", status: "modified" },
      { path: "renamed.ts", previousPath: "rename.ts", status: "renamed" },
      { path: "untracked.ts", status: "untracked" },
    ]);
  });

  it("rejects abbreviated or non-hex base commits", async () => {
    await expect(inventoryChangedFiles(".", "HEAD")).rejects.toThrow(
      "baseCommit must be a full lowercase commit SHA",
    );
  });
});
