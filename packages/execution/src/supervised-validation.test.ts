// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { parseRepositoryProfile } from "@roundhouse/repository-profile";

import { runSupervisedValidation } from "./supervised-validation.js";
import type {
  CommandExecution,
  ExecutionBackend,
  ExecutionLimits,
} from "./types.js";

const execFileAsync = promisify(execFile);
const repositories: string[] = [];
const profile = parseRepositoryProfile(`
version: 1
runtime: { image: roundhouse/runner:dev, workspace: /workspace }
bootstrap: { command: pnpm, args: [install] }
validation:
  license: { command: pnpm, args: [license:check] }
  format: { command: pnpm, args: [format:check] }
  compile: { command: pnpm, args: [typecheck] }
  targeted: { command: pnpm, args: [test] }
  quick:
    format:
      command: pnpm
      args: [exec, prettier, --check]
      include: ["**/*.ts"]
    fullWhenChanged: [package.json]
  timeoutMinutes: 15
network: { default: deny, capabilities: [] }
protectedPaths: []
artifacts: { include: [] }
`);

async function git(repository: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
  return stdout.trim();
}

async function repository(): Promise<{ path: string; base: string }> {
  const path = await mkdtemp(join(tmpdir(), "roundhouse-validation-"));
  repositories.push(path);
  await git(path, "init", "--initial-branch=main");
  await git(path, "config", "user.name", "Roundhouse Test");
  await git(path, "config", "user.email", "roundhouse@example.invalid");
  await writeFile(join(path, "tracked.ts"), "export const before = true;\n");
  await git(path, "add", ".");
  await git(path, "commit", "-m", "base");
  return { path, base: await git(path, "rev-parse", "HEAD") };
}

class RecordingBackend implements ExecutionBackend {
  readonly name = "recording";
  readonly commands: string[] = [];

  constructor(private readonly failAt?: number) {}

  async run(
    command: { command: string; args: string[] },
    cwd: string,
    _limits: ExecutionLimits,
  ): Promise<CommandExecution> {
    this.commands.push([command.command, ...command.args].join(" "));
    const exitCode = this.commands.length === this.failAt ? 1 : 0;
    return {
      command,
      cwd,
      startedAt: "2026-07-11T00:00:00.000Z",
      completedAt: "2026-07-11T00:00:01.000Z",
      durationMs: 1000,
      exitCode,
      signal: null,
      timedOut: false,
      outputTruncated: false,
      stdout: exitCode === 0 ? "ok\n" : "",
      stderr: exitCode === 0 ? "" : "failed\n",
    };
  }
}

afterEach(async () => {
  await Promise.all(
    repositories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("runSupervisedValidation", () => {
  it("runs a quick plan and captures tracked and untracked patch evidence", async () => {
    const repo = await repository();
    await writeFile(
      join(repo.path, "tracked.ts"),
      "export const after = true;\n",
    );
    await writeFile(
      join(repo.path, "untracked.ts"),
      "export const added = true;\n",
    );
    const backend = new RecordingBackend();

    const result = await runSupervisedValidation({
      repositoryPath: repo.path,
      baseCommit: repo.base,
      level: "quick",
      profile,
      backend,
      limits: { timeoutMs: 60_000, maxOutputBytes: 1024 },
    });

    expect(result.evidence.succeeded).toBe(true);
    expect(result.evidence.commands).toHaveLength(4);
    expect(result.evidence.commands[0]?.name).toBe("license");
    expect(backend.commands[1]).toContain("tracked.ts untracked.ts");
    expect(result.patch).toContain("export const after = true;");
    expect(result.patch).toContain("export const added = true;");
    expect(result.evidence.patchBytes).toBeGreaterThan(0);
    expect(result.evidence.patchSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("stops after the first failed validation command", async () => {
    const repo = await repository();
    await writeFile(
      join(repo.path, "tracked.ts"),
      "export const after = true;\n",
    );
    const backend = new RecordingBackend(3);

    const result = await runSupervisedValidation({
      repositoryPath: repo.path,
      baseCommit: repo.base,
      level: "quick",
      profile,
      backend,
      limits: { timeoutMs: 60_000, maxOutputBytes: 1024 },
    });

    expect(result.evidence).toMatchObject({
      succeeded: false,
      failedCommand: "compile",
    });
    expect(backend.commands).toHaveLength(3);
    expect(result.evidence.commands[2]?.stderrSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
