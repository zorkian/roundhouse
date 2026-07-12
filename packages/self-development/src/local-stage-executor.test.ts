// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentMessage,
  AgentRunInput,
} from "@roundhouse/domain";
import {
  recordValidationApproval,
  type CommandExecution,
  type ExecutionBackend,
  type ExecutionLimits,
} from "@roundhouse/execution";
import { parseRepositoryProfile } from "@roundhouse/repository-profile";

import { LocalJobStageExecutor } from "./local-stage-executor.js";
import { ResumableCoordinator } from "./resumable-coordinator.js";
import { FileRunStore } from "./run-store.js";
import type { SelfDevelopmentTask } from "./task.js";

const execFileAsync = promisify(execFile);
const paths: string[] = [];
const profile = parseRepositoryProfile(`
version: 1
runtime: { image: roundhouse/runner:dev, workspace: /workspace }
bootstrap: { command: "true", args: [] }
validation:
  license: { command: "true", args: [] }
  format: { command: "true", args: [] }
  compile: { command: "true", args: [] }
  targeted: { command: "true", args: [] }
  quick:
    format: { command: "true", args: [], include: ["**/*.md"] }
    fullWhenChanged: []
  timeoutMinutes: 1
network: { default: deny, capabilities: [] }
protectedPaths: []
artifacts: { include: [] }
`);

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

class EditingAgent implements AgentAdapter {
  readonly name = "editing-agent";
  async capabilities(): Promise<AgentCapabilities> {
    return new Set(["structured-events"]);
  }
  async *start(input: AgentRunInput): AsyncIterable<AgentEvent> {
    await writeFile(join(input.workspace, "change.md"), "implemented\n");
    yield { type: "completed", outcome: "succeeded" };
  }
  async *resume(
    _sessionId: string,
    _input: AgentMessage,
  ): AsyncIterable<AgentEvent> {
    throw new Error("unsupported");
  }
  async cancel(_attemptId: string): Promise<void> {}
}

class PassingBackend implements ExecutionBackend {
  readonly name = "passing";
  async run(
    command: { command: string; args: string[] },
    cwd: string,
    _limits: ExecutionLimits,
  ): Promise<CommandExecution> {
    return {
      command,
      cwd,
      startedAt: "2026-07-12T00:00:00.000Z",
      completedAt: "2026-07-12T00:00:01.000Z",
      durationMs: 1_000,
      exitCode: 0,
      signal: null,
      timedOut: false,
      outputTruncated: false,
      stdout: "ok\n",
      stderr: "",
    };
  }
}

afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("LocalJobStageExecutor", () => {
  it("runs the port-based coordinator through exact approval and verified push", async () => {
    const source = await temporary("roundhouse-local-source-");
    const remote = await temporary("roundhouse-local-remote-");
    const root = await temporary("roundhouse-local-runs-");
    await git(remote, "init", "--bare");
    await git(source, "init", "--initial-branch=main");
    await git(source, "config", "user.name", "Roundhouse Test");
    await git(source, "config", "user.email", "roundhouse@example.invalid");
    await writeFile(join(source, "README.md"), "base\n");
    await git(source, "add", ".");
    await git(source, "commit", "-m", "base");
    const base = await git(source, "rev-parse", "HEAD");
    const task: SelfDevelopmentTask = {
      schemaVersion: 1,
      taskId: "task_local",
      subject: "Local port test",
      instructions: "Create change.md.",
      repositoryPath: source,
      baseCommit: base,
      validationLevel: "quick",
      allowedPaths: ["change.md"],
      publication: {
        remote: "origin",
        remoteUrl: remote,
        branch: "roundhouse/output",
        expectedRemoteHead: null,
        commitMessage: "Add port change",
        authorName: "Roundhouse Test",
        authorEmail: "roundhouse@example.invalid",
      },
    };
    const store = new FileRunStore(root);
    const worker = new ResumableCoordinator(
      store,
      new LocalJobStageExecutor(
        root,
        profile,
        new PassingBackend(),
        new EditingAgent(),
      ),
      { now: () => new Date() },
      { workerId: "worker-local" },
    );
    await worker.submit("run_local", task);
    await worker.workOnce();
    await worker.workOnce();
    expect((await worker.workOnce())?.state).toBe("awaiting_approval");
    const manifest = JSON.parse(
      await readFile(
        join(root, "runs/run_local/validation/manifest.json"),
        "utf8",
      ),
    ) as { patch: { sha256: string } };
    await recordValidationApproval(root, {
      schemaVersion: 1,
      runId: "run_local",
      actorId: "operator",
      baseCommit: base,
      patchSha256: manifest.patch.sha256,
      approvedAt: new Date().toISOString(),
    });
    await store.transition("run_local", "approved", "approval.recorded");
    await worker.workOnce();
    await worker.workOnce();
    expect((await worker.workOnce())?.state).toBe("completed");
    expect(await git(remote, "rev-parse", "refs/heads/roundhouse/output")).toBe(
      (await store.read("run_local")).commit,
    );
  }, 20_000);
});
