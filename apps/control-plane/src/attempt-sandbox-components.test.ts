// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ExecResult, Process } from "@cloudflare/sandbox";
import { describe, expect, it, vi } from "vitest";
import type { SandboxComponentHost } from "./attempt-sandbox-components.js";
import { NestedContainerRuntime } from "./nested-container-runtime.js";
import { PreviewTransport } from "./preview-transport.js";
import { WorkspaceLifecycle } from "./workspace-lifecycle.js";

function successful(command: string, stdout = ""): ExecResult {
  return {
    success: true,
    exitCode: 0,
    stdout,
    stderr: "",
    command,
    duration: 1,
    timestamp: new Date(0).toISOString(),
  };
}

function successfulRuntimeCommand(command: string): ExecResult {
  if (command.startsWith("sha256sum "))
    return successful(command, "matching-ca  /etc/cloudflare/ca.crt\n");
  if (command.includes(" sha256sum /etc/buildkit/certs/"))
    return successful(command, "matching-ca  /etc/buildkit/ca.crt\n");
  if (command.includes(" cat /etc/buildkit/buildkitd.toml"))
    return successful(command, "[registry.'ghcr.io']\n");
  if (command.includes("docker info"))
    return successful(command, "fuse-overlayfs\n");
  return successful(command);
}

function runningProcess(): Process {
  return {
    id: "roundhouse-docker",
    pid: 42,
    command: "dockerd",
    status: "running",
    startTime: new Date(0),
    kill: async () => undefined,
    getStatus: async () => "running",
    getLogs: async () => ({ stdout: "", stderr: "" }),
    waitForLog: async () => ({ line: "" }),
    waitForPort: async () => undefined,
    waitForExit: async () => ({
      type: "complete",
      timestamp: new Date(0).toISOString(),
      exitCode: 0,
    }),
  };
}

function componentHost(
  overrides: Partial<SandboxComponentHost> = {},
): SandboxComponentHost {
  const process = runningProcess();
  return {
    trace: async () => undefined,
    exec: async (command) => successful(command),
    getProcess: async () => process,
    startProcess: async () => process,
    getProcessLogs: async (processId) => ({
      stdout: "",
      stderr: "",
      processId,
    }),
    exists: async () => ({ exists: true }),
    killAllProcesses: async () => 0,
    createBackup: async (options) => ({
      id: "backup_1",
      dir: options.dir,
    }),
    restoreBackup: async (backup) => ({
      success: true,
      id: backup.id,
      dir: backup.dir,
    }),
    containerFetch: async () => new Response("ok"),
    awaitWithHeartbeat: async <T>(
      _attemptId: string,
      _phase: string,
      operation: Promise<T>,
    ) => operation,
    ...overrides,
  };
}

describe("attempt Sandbox components", () => {
  it("transports private preview responses with observable boundaries", async () => {
    const phases: string[] = [];
    const transport = new PreviewTransport(
      componentHost({
        trace: async (_attemptId, phase) => {
          phases.push(phase);
        },
        containerFetch: async () =>
          new Response("styled", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      }),
    );

    const response = await transport.fetch(
      "attempt_1",
      "http://preview.local/page",
      8080,
    );

    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(response.body)).toBe("styled");
    expect(phases).toEqual([
      "preview_fetch_started",
      "preview_fetch_completed",
    ]);
  });

  it("backs up a stopped workspace through the lifecycle component", async () => {
    const phases: string[] = [];
    const killAllProcesses = vi.fn(async () => 0);
    const lifecycle = new WorkspaceLifecycle(
      componentHost({
        trace: async (_attemptId, phase) => {
          phases.push(phase);
        },
        exec: async (command) =>
          successful(command, command === "docker ps -q" ? "" : undefined),
        killAllProcesses,
      }),
      async () => undefined,
    );

    await expect(lifecycle.backup("attempt_1", "run_1")).resolves.toEqual({
      id: "backup_1",
      dir: "/workspace/roundhouse",
    });
    expect(killAllProcesses).toHaveBeenCalledOnce();
    expect(phases).toContain("workspace_backup_creation_started");
    expect(phases.at(-1)).toBe("workspace_backup_completed");
  });

  it("releases stale nested mounts before restoring a workspace", async () => {
    const phases: string[] = [];
    const commands: string[] = [];
    const lifecycle = new WorkspaceLifecycle(
      componentHost({
        trace: async (_attemptId, phase) => {
          phases.push(phase);
        },
        exec: async (command) => {
          commands.push(command);
          return successful(command);
        },
      }),
      async () => undefined,
    );

    await expect(
      lifecycle.restore("attempt_1", {
        id: "backup_1",
        dir: "/workspace/roundhouse",
      }),
    ).resolves.toBeUndefined();

    const nestedRelease = commands.findIndex((command) =>
      command.includes("/proc/self/mountinfo"),
    );
    const backupMaterialization = commands.findIndex((command) =>
      command.startsWith("cp -a /workspace/roundhouse/."),
    );
    expect(nestedRelease).toBeGreaterThanOrEqual(0);
    expect(backupMaterialization).toBeGreaterThan(nestedRelease);
    expect(phases).toContain("workspace_nested_mount_release_completed");
    expect(phases.at(-1)).toBe("workspace_restore_completed");
  });

  it("owns Docker and BuildKit readiness in the nested runtime component", async () => {
    const phases: string[] = [];
    const process = runningProcess();
    const runtime = new NestedContainerRuntime(
      componentHost({
        trace: async (_attemptId, phase) => {
          phases.push(phase);
        },
        getProcess: async () => process,
        exec: async (command) => successfulRuntimeCommand(command),
      }),
    );

    await expect(runtime.ensure("attempt_1")).resolves.toBe(process);
    expect(phases).toContain("docker_daemon_ready");
    expect(phases.at(-1)).toBe("docker_builder_ready");
  });

  it("reconciles a restored builder that no longer satisfies its registry CA contract", async () => {
    const phases: string[] = [];
    const commands: string[] = [];
    const process = runningProcess();
    let recreated = false;
    const runtime = new NestedContainerRuntime(
      componentHost({
        trace: async (_attemptId, phase) => {
          phases.push(phase);
        },
        getProcess: async () => process,
        exec: async (command) => {
          commands.push(command);
          if (command.startsWith("docker buildx create")) recreated = true;
          if (command.includes(" sha256sum /etc/buildkit/certs/") && !recreated)
            return {
              ...successful(command),
              success: false,
              exitCode: 127,
              stderr: "sha256sum: not found",
            };
          return successfulRuntimeCommand(command);
        },
      }),
    );

    await expect(runtime.ensure("attempt_1")).resolves.toBe(process);
    expect(commands).toContain(
      "docker buildx rm --force --keep-state roundhouse-host-v1",
    );
    expect(
      commands.some((command) => command.startsWith("docker buildx create")),
    ).toBe(true);
    expect(phases).toContain("docker_builder_reconciliation_started");
    expect(phases).toContain("docker_builder_reconciliation_completed");
    expect(phases.at(-1)).toBe("docker_builder_ready");
  });
});
