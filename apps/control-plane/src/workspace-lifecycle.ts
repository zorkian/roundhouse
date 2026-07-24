// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { DirectoryBackup } from "@cloudflare/sandbox";
import type { WorkspaceLifecycleHost } from "./attempt-sandbox-components.js";

export class WorkspaceLifecycle {
  constructor(
    private readonly host: WorkspaceLifecycleHost,
    private readonly ensureRuntime: (attemptId?: string) => Promise<unknown>,
  ) {}

  async restore(attemptId: string, backup: DirectoryBackup): Promise<void> {
    const startedAt = Date.now();
    await this.host.trace(attemptId, "workspace_restore_started", undefined, {
      backupId: backup.id,
    });
    try {
      const traceRuntimeFiles = async (phase: string): Promise<void> => {
        const stepStartedAt = Date.now();
        await this.host.trace(attemptId, `${phase}_started`);
        const paths = [
          "/bin/bash",
          "/lib/ld-musl-x86_64.so.1",
          "/usr/bin/curl",
          "/usr/bin/fusermount3",
          "/usr/bin/squashfuse",
          "/usr/bin/fuse-overlayfs",
        ];
        const results = await Promise.all(
          paths.map(async (path) => ({
            path,
            exists: (await this.host.exists(path)).exists,
          })),
        );
        await this.host.trace(attemptId, `${phase}_completed`, stepStartedAt, {
          files: results,
        });
      };
      await traceRuntimeFiles("workspace_restore_files_before_cleanup");
      let stepStartedAt = Date.now();
      await this.host.trace(attemptId, "workspace_process_cleanup_started");
      await this.host.killAllProcesses();
      await this.host.trace(
        attemptId,
        "workspace_process_cleanup_completed",
        stepStartedAt,
      );
      await traceRuntimeFiles("workspace_restore_files_after_cleanup");
      stepStartedAt = Date.now();
      await this.host.trace(
        attemptId,
        "workspace_restore_capability_check_started",
      );
      const capabilities = await this.host.exec(
        'for tool in curl fusermount3 squashfuse fuse-overlayfs; do command -v "$tool" || exit 1; done',
        {
          cwd: "/",
          origin: "internal",
          timeout: 5_000,
        },
      );
      await this.host.trace(
        attemptId,
        "workspace_restore_capability_check_completed",
        stepStartedAt,
        {
          success: capabilities.success,
          exitCode: capabilities.exitCode,
          tools: capabilities.stdout.trim().split(/\s+/).filter(Boolean),
          detail: capabilities.stderr.slice(-1_000),
        },
      );
      if (!capabilities.success)
        throw new Error("workspace_restore_capability_check_failed");
      stepStartedAt = Date.now();
      await this.host.trace(
        attemptId,
        "workspace_backup_restore_started",
        undefined,
        { backupId: backup.id },
      );
      await this.host.awaitWithHeartbeat(
        attemptId,
        "workspace_backup_restore",
        this.host.restoreBackup(backup),
      );
      await this.host.trace(
        attemptId,
        "workspace_backup_restore_completed",
        stepStartedAt,
        { backupId: backup.id },
      );
      const materializeStartedAt = Date.now();
      const stagingDir = "/workspace/.roundhouse-restored-workspace";
      stepStartedAt = Date.now();
      await this.host.trace(
        attemptId,
        "workspace_restore_staging_prepare_started",
        undefined,
        { stagingDir },
      );
      const prepared = await this.host.exec(
        `rm -rf ${stagingDir} && mkdir -p ${stagingDir}`,
        {
          cwd: "/",
          origin: "internal",
          timeout: 30_000,
        },
      );
      await this.host.trace(
        attemptId,
        "workspace_restore_staging_prepare_completed",
        stepStartedAt,
        {
          stagingDir,
          success: prepared.success,
          exitCode: prepared.exitCode,
          detail: prepared.stderr.slice(-1_000),
        },
      );
      if (!prepared.success)
        throw new Error("workspace_restore_staging_prepare_failed");
      stepStartedAt = Date.now();
      await this.host.trace(
        attemptId,
        "workspace_restore_materialize_copy_started",
        undefined,
        { stagingDir },
      );
      const copied = await this.host.awaitWithHeartbeat(
        attemptId,
        "workspace_restore_materialize_copy",
        this.host.exec(`cp -a /workspace/roundhouse/. ${stagingDir}/`, {
          cwd: "/",
          origin: "internal",
          timeout: 30 * 60_000,
        }),
      );
      await this.host.trace(
        attemptId,
        "workspace_restore_materialize_copy_completed",
        stepStartedAt,
        {
          stagingDir,
          success: copied.success,
          exitCode: copied.exitCode,
          detail: copied.stderr.slice(-1_000),
        },
      );
      if (!copied.success)
        throw new Error("workspace_restore_materialize_copy_failed");
      stepStartedAt = Date.now();
      await this.host.trace(
        attemptId,
        "workspace_restore_mount_release_started",
      );
      const unmounted = await this.host.exec(
        "/usr/bin/fusermount3 -u /workspace/roundhouse",
        {
          cwd: "/",
          origin: "internal",
          timeout: 30_000,
        },
      );
      await this.host.trace(
        attemptId,
        "workspace_restore_mount_release_completed",
        stepStartedAt,
        {
          success: unmounted.success,
          exitCode: unmounted.exitCode,
          detail: unmounted.stderr.slice(-1_000),
        },
      );
      if (!unmounted.success)
        throw new Error("workspace_restore_mount_release_failed");
      stepStartedAt = Date.now();
      await this.host.trace(
        attemptId,
        "workspace_restore_native_activation_started",
        undefined,
        { stagingDir },
      );
      const activated = await this.host.exec(
        `rm -rf /workspace/roundhouse && mv ${stagingDir} /workspace/roundhouse`,
        {
          cwd: "/",
          origin: "internal",
          timeout: 30_000,
        },
      );
      await this.host.trace(
        attemptId,
        "workspace_restore_native_activation_completed",
        stepStartedAt,
        {
          stagingDir,
          success: activated.success,
          exitCode: activated.exitCode,
          detail: activated.stderr.slice(-1_000),
        },
      );
      if (!activated.success)
        throw new Error("workspace_restore_native_activation_failed");
      await this.host.trace(
        attemptId,
        "workspace_restore_materialization_completed",
        materializeStartedAt,
        { stagingDir },
      );
      stepStartedAt = Date.now();
      await this.host.trace(attemptId, "workspace_docker_restore_started");
      await this.ensureRuntime(attemptId);
      await this.host.trace(
        attemptId,
        "workspace_docker_restore_completed",
        stepStartedAt,
      );
      await this.host.trace(
        attemptId,
        "workspace_restore_completed",
        startedAt,
        { backupId: backup.id },
      );
    } catch (error) {
      await this.host.trace(attemptId, "workspace_restore_failed", startedAt, {
        backupId: backup.id,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async backup(attemptId: string, runId: string): Promise<DirectoryBackup> {
    const startedAt = Date.now();
    await this.host.trace(attemptId, "workspace_backup_started", undefined, {
      runId,
    });
    try {
      let stepStartedAt = Date.now();
      await this.host.trace(attemptId, "workspace_container_list_started");
      const running = await this.host.exec("docker ps -q", {
        origin: "internal",
        timeout: 5_000,
      });
      const containerIds = running.success
        ? running.stdout
            .split(/\s+/)
            .filter((id) => /^[a-f0-9]{12,64}$/.test(id))
        : [];
      await this.host.trace(
        attemptId,
        "workspace_container_list_completed",
        stepStartedAt,
        {
          success: running.success,
          exitCode: running.exitCode,
          containerCount: containerIds.length,
          detail: running.stderr.slice(-1_000),
        },
      );
      for (const containerId of containerIds) {
        stepStartedAt = Date.now();
        await this.host.trace(
          attemptId,
          "workspace_container_stop_started",
          undefined,
          { containerId },
        );
        const stopped = await this.host.exec(`docker stop ${containerId}`, {
          origin: "internal",
          timeout: 30_000,
        });
        await this.host.trace(
          attemptId,
          "workspace_container_stop_completed",
          stepStartedAt,
          {
            containerId,
            success: stopped.success,
            exitCode: stopped.exitCode,
            detail: stopped.stderr.slice(-1_000),
          },
        );
        if (!stopped.success)
          throw new Error("workspace_container_stop_failed");
      }
      stepStartedAt = Date.now();
      await this.host.trace(attemptId, "workspace_process_cleanup_started");
      await this.host.killAllProcesses();
      await this.host.trace(
        attemptId,
        "workspace_process_cleanup_completed",
        stepStartedAt,
      );
      stepStartedAt = Date.now();
      await this.host.trace(attemptId, "workspace_backup_creation_started");
      const backup = await this.host.awaitWithHeartbeat(
        attemptId,
        "workspace_backup_creation",
        this.host.createBackup({
          dir: "/workspace/roundhouse",
          name: `roundhouse-${runId}`,
          gitignore: false,
          ttl: 30 * 24 * 60 * 60,
        }),
      );
      await this.host.trace(
        attemptId,
        "workspace_backup_creation_completed",
        stepStartedAt,
        { backupId: backup.id },
      );
      await this.host.trace(
        attemptId,
        "workspace_backup_completed",
        startedAt,
        { runId, backupId: backup.id },
      );
      return backup;
    } catch (error) {
      await this.host.trace(attemptId, "workspace_backup_failed", startedAt, {
        runId,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
