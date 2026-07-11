// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
import type {
  CommandExecution,
  ExecutionBackend,
  ExecutionLimits,
} from "@roundhouse/execution";
import { parseRepositoryProfile } from "@roundhouse/repository-profile";

import { SelfDevelopmentOrchestrator } from "./orchestrator.js";
import type { SelfDevelopmentTask } from "./task.js";

const execFileAsync = promisify(execFile);
const paths: string[] = [];
const profile = parseRepositoryProfile(`
version: 1
runtime: { image: roundhouse/runner:dev, workspace: /workspace }
bootstrap: { command: "true", args: [] }
validation:
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
  readonly name = "editing-test-agent";
  async capabilities(): Promise<AgentCapabilities> {
    return new Set(["structured-events"]);
  }
  async *start(input: AgentRunInput): AsyncIterable<AgentEvent> {
    await writeFile(join(input.workspace, "change.md"), "implemented\n");
    yield { type: "session.started", sessionId: "session-test" };
    yield { type: "completed", outcome: "succeeded" };
  }
  async *resume(
    _sessionId: string,
    _input: AgentMessage,
  ): AsyncIterable<AgentEvent> {
    throw new Error("not supported");
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
      startedAt: "2026-07-11T00:00:00.000Z",
      completedAt: "2026-07-11T00:00:01.000Z",
      durationMs: 1000,
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

describe("SelfDevelopmentOrchestrator", () => {
  it("runs a restart-safe task through verified push", async () => {
    const source = await temporary("roundhouse-orchestrator-source-");
    const remote = await temporary("roundhouse-orchestrator-remote-");
    const root = await temporary("roundhouse-orchestrator-runs-");
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
      taskId: "task_test",
      subject: "Add a file",
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
        commitMessage: "Add generated change",
        authorName: "Roundhouse Test",
        authorEmail: "roundhouse@example.invalid",
      },
    };
    const orchestrator = new SelfDevelopmentOrchestrator(root, profile);
    await orchestrator.start("run_test", task, new PassingBackend());
    await orchestrator.implement("run_test", new EditingAgent());
    const manifest = await orchestrator.validate(
      "run_test",
      new PassingBackend(),
    );
    await orchestrator.approve({
      schemaVersion: 1,
      runId: "run_test",
      actorId: "mark",
      baseCommit: base,
      patchSha256: manifest.patch.sha256,
      approvedAt: "2026-07-11T00:01:00.000Z",
    });
    const publication = await orchestrator.commit("run_test");
    const pushed = await orchestrator.push("run_test", publication.commit);

    expect(pushed.head).toBe(publication.commit);
    const recovered = await new SelfDevelopmentOrchestrator(
      root,
      profile,
    ).store.read("run_test");
    expect(recovered.state).toBe("completed");
    expect(recovered.events.map((event) => event.state)).toEqual([
      "created",
      "workspace_ready",
      "implementing",
      "validating",
      "awaiting_approval",
      "approved",
      "committed",
      "pushed",
      "completed",
    ]);
  }, 15_000);
});
