// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createIsolatedWorkspace } from "./workspace.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function git(repository: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
  return stdout.trim();
}

async function temporary(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("createIsolatedWorkspace", () => {
  it("checks out the exact requested commit into an independent clone", async () => {
    const source = await temporary("roundhouse-source-");
    await git(source, "init", "--initial-branch=main");
    await git(source, "config", "user.name", "Roundhouse Test");
    await git(source, "config", "user.email", "roundhouse@example.invalid");
    await writeFile(join(source, "value.txt"), "base\n");
    await git(source, "add", ".");
    await git(source, "commit", "-m", "base");
    const base = await git(source, "rev-parse", "HEAD");
    await writeFile(join(source, "value.txt"), "later\n");
    await git(source, "commit", "-am", "later");

    const workspaceRoot = await temporary("roundhouse-workspaces-");
    const workspace = await createIsolatedWorkspace({
      sourceRepository: source,
      baseCommit: base,
      workspaceRoot,
      runId: "run_test",
    });

    expect(await git(workspace, "rev-parse", "HEAD")).toBe(base);
    expect(await readFile(join(workspace, "value.txt"), "utf8")).toBe("base\n");
    expect(await git(workspace, "rev-parse", "--is-shallow-repository")).toBe(
      "false",
    );
  });
});
