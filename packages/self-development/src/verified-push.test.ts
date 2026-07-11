// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { pushVerifiedCommit } from "./verified-push.js";

const execFileAsync = promisify(execFile);
const paths: string[] = [];

async function temporary(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  paths.push(path);
  return path;
}

async function git(repository: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
  return stdout.trim();
}

async function fixture(): Promise<{
  repository: string;
  remote: string;
  base: string;
  commit: string;
}> {
  const repository = await temporary("roundhouse-push-work-");
  const remote = await temporary("roundhouse-push-remote-");
  await git(remote, "init", "--bare");
  await git(repository, "init", "--initial-branch=main");
  await git(repository, "config", "user.name", "Roundhouse Test");
  await git(repository, "config", "user.email", "roundhouse@example.invalid");
  await writeFile(join(repository, "value.txt"), "base\n");
  await git(repository, "add", ".");
  await git(repository, "commit", "-m", "base");
  const base = await git(repository, "rev-parse", "HEAD");
  await git(repository, "remote", "add", "origin", remote);
  await git(repository, "push", "origin", `${base}:refs/heads/output`);
  await writeFile(join(repository, "value.txt"), "changed\n");
  await git(repository, "commit", "-am", "change");
  return {
    repository,
    remote,
    base,
    commit: await git(repository, "rev-parse", "HEAD"),
  };
}

afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("pushVerifiedCommit", () => {
  it("updates only the expected remote head and verifies the result", async () => {
    const value = await fixture();
    const result = await pushVerifiedCommit({
      repositoryPath: value.repository,
      remote: "origin",
      expectedRemoteUrl: value.remote,
      branch: "output",
      expectedRemoteHead: value.base,
      commit: value.commit,
    });
    expect(result).toMatchObject({
      previousHead: value.base,
      head: value.commit,
    });
  });

  it("refuses a stale remote-head expectation", async () => {
    const value = await fixture();
    await expect(
      pushVerifiedCommit({
        repositoryPath: value.repository,
        remote: "origin",
        expectedRemoteUrl: value.remote,
        branch: "output",
        expectedRemoteHead: null,
        commit: value.commit,
      }),
    ).rejects.toThrow("Remote branch moved from its expected head");
  });

  it("refuses an unexpected remote URL", async () => {
    const value = await fixture();
    await expect(
      pushVerifiedCommit({
        repositoryPath: value.repository,
        remote: "origin",
        expectedRemoteUrl: "https://example.invalid/wrong.git",
        branch: "output",
        expectedRemoteHead: value.base,
        commit: value.commit,
      }),
    ).rejects.toThrow("Configured remote URL does not match the task");
  });
});
