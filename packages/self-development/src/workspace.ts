// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

export async function createIsolatedWorkspace(input: {
  sourceRepository: string;
  baseCommit: string;
  workspaceRoot: string;
  runId: string;
}): Promise<string> {
  if (!/^[a-f0-9]{40}$/.test(input.baseCommit))
    throw new Error("Base must be a full lowercase commit SHA");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(input.runId))
    throw new Error("Invalid run ID");
  const workspace = join(input.workspaceRoot, "runs", input.runId, "workspace");
  await mkdir(dirname(workspace), { recursive: true, mode: 0o700 });
  await git([
    "clone",
    "--no-checkout",
    "--no-local",
    "--",
    input.sourceRepository,
    workspace,
  ]);
  await git(["cat-file", "-e", `${input.baseCommit}^{commit}`], workspace);
  await git(["checkout", "--detach", input.baseCommit], workspace);
  if ((await git(["rev-parse", "HEAD"], workspace)) !== input.baseCommit)
    throw new Error("Workspace HEAD does not match requested base commit");
  return workspace;
}
