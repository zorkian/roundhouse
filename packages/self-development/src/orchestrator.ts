// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, matchesGlob } from "node:path";

import type { AgentAdapter, AgentEvent } from "@roundhouse/domain";
import {
  inventoryChangedFiles,
  persistValidationArtifacts,
  publishApprovedPatch,
  recordValidationApproval,
  runSupervisedValidation,
  type ExecutionBackend,
  type ValidationApproval,
} from "@roundhouse/execution";
import type { RepositoryProfile } from "@roundhouse/repository-profile";

import { FileRunStore } from "./run-store.js";
import { selfDevelopmentTaskSchema, type SelfDevelopmentTask } from "./task.js";
import { pushVerifiedCommit } from "./verified-push.js";
import { createIsolatedWorkspace } from "./workspace.js";

export class SelfDevelopmentOrchestrator {
  readonly store: FileRunStore;

  constructor(
    private readonly root: string,
    private readonly profile: RepositoryProfile,
  ) {
    this.store = new FileRunStore(root);
  }

  async start(
    runId: string,
    rawTask: SelfDevelopmentTask,
    backend?: ExecutionBackend,
  ): Promise<void> {
    const task = selfDevelopmentTaskSchema.parse(rawTask);
    await this.store.create(runId, task);
    try {
      const workspace = await createIsolatedWorkspace({
        sourceRepository: task.repositoryPath,
        baseCommit: task.baseCommit,
        workspaceRoot: this.root,
        runId,
        remoteUrl: task.publication.remoteUrl,
        authorName: task.publication.authorName,
        authorEmail: task.publication.authorEmail,
      });
      const bootstrap = backend
        ? await backend.run(this.profile.bootstrap, workspace, {
            timeoutMs: this.profile.validation.timeoutMinutes * 60_000,
            maxOutputBytes: 1024 * 1024,
          })
        : undefined;
      if (bootstrap && bootstrap.exitCode !== 0)
        throw new Error("Repository bootstrap failed");
      await this.store.transition(
        runId,
        "workspace_ready",
        "workspace.created",
        {
          baseCommit: task.baseCommit,
          bootstrap: bootstrap
            ? { exitCode: bootstrap.exitCode, durationMs: bootstrap.durationMs }
            : null,
        },
        { workspacePath: workspace },
      );
    } catch (error) {
      await this.store.transition(runId, "failed", "workspace.failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  private async persistAgentEvents(
    runId: string,
    events: AgentEvent[],
  ): Promise<void> {
    const directory = join(this.root, "runs", runId, "agent");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "events.json");
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(events, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, path);
  }

  async implement(runId: string, adapter: AgentAdapter): Promise<AgentEvent[]> {
    let run = await this.store.read(runId);
    if (run.state !== "workspace_ready" || !run.workspacePath)
      throw new Error("Run is not ready for implementation");
    run = await this.store.transition(
      runId,
      "implementing",
      "implementation.started",
      {
        adapter: adapter.name,
      },
    );
    const events: AgentEvent[] = [];
    try {
      for await (const event of adapter.start({
        attemptId: `${runId}-implementation-1`,
        prompt: run.task.instructions,
        workspace: run.workspacePath!,
        allowedTools: ["shell", "apply_patch"],
      }))
        events.push(event);
      await this.persistAgentEvents(runId, events);
      const completion = [...events]
        .reverse()
        .find((event) => event.type === "completed");
      if (
        !completion ||
        completion.type !== "completed" ||
        completion.outcome !== "succeeded"
      )
        throw new Error("Implementation adapter did not complete successfully");
      const changedFiles = await inventoryChangedFiles(
        run.workspacePath!,
        run.task.baseCommit,
      );
      if (changedFiles.length === 0)
        throw new Error("Implementation produced no changes");
      const disallowed = changedFiles.find((change) =>
        [change.path, change.previousPath]
          .filter((path): path is string => path !== undefined)
          .some(
            (path) =>
              !run.task.allowedPaths.some((pattern) =>
                matchesGlob(path, pattern),
              ),
          ),
      );
      if (disallowed)
        throw new Error(
          `Implementation changed disallowed path: ${disallowed.path}`,
        );
      await this.store.transition(
        runId,
        "validating",
        "implementation.completed",
        {
          changedFiles,
          eventCount: events.length,
        },
      );
      return events;
    } catch (error) {
      await this.persistAgentEvents(runId, events);
      await this.store.transition(runId, "failed", "implementation.failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  async validate(runId: string, backend: ExecutionBackend) {
    const run = await this.store.read(runId);
    if (run.state !== "validating" || !run.workspacePath)
      throw new Error("Run is not ready for validation");
    const result = await runSupervisedValidation({
      repositoryPath: run.workspacePath,
      baseCommit: run.task.baseCommit,
      level: run.task.validationLevel,
      profile: this.profile,
      backend,
      limits: {
        timeoutMs: this.profile.validation.timeoutMinutes * 60_000,
        maxOutputBytes: 1024 * 1024,
      },
    });
    if (!result.evidence.succeeded) {
      await this.store.transition(runId, "failed", "validation.failed", {
        failedCommand: result.evidence.failedCommand,
      });
      throw new Error(
        `Validation failed at ${result.evidence.failedCommand ?? "unknown"}`,
      );
    }
    const manifest = await persistValidationArtifacts(this.root, runId, result);
    await this.store.transition(
      runId,
      "awaiting_approval",
      "validation.completed",
      {
        patchSha256: manifest.patch.sha256,
        patchBytes: manifest.patch.bytes,
      },
    );
    return manifest;
  }

  async approve(approval: ValidationApproval): Promise<void> {
    const run = await this.store.read(approval.runId);
    if (run.state !== "awaiting_approval")
      throw new Error("Run is not awaiting approval");
    await recordValidationApproval(this.root, approval);
    await this.store.transition(
      approval.runId,
      "approved",
      "approval.recorded",
      {
        actorId: approval.actorId,
        patchSha256: approval.patchSha256,
      },
    );
  }

  async commit(runId: string) {
    const run = await this.store.read(runId);
    if (run.state !== "approved" || !run.workspacePath)
      throw new Error("Run is not approved");
    const publication = await publishApprovedPatch({
      repositoryPath: run.workspacePath,
      artifactRoot: this.root,
      runId,
      message: run.task.publication.commitMessage,
    });
    await this.store.transition(runId, "committed", "commit.created", {
      commit: publication.commit,
    });
    return publication;
  }

  async push(runId: string, commit: string) {
    const run = await this.store.read(runId);
    if (run.state !== "committed" || !run.workspacePath)
      throw new Error("Run is not committed");
    const pushed = await pushVerifiedCommit({
      repositoryPath: run.workspacePath,
      remote: run.task.publication.remote,
      expectedRemoteUrl: run.task.publication.remoteUrl,
      branch: run.task.publication.branch,
      expectedRemoteHead: run.task.publication.expectedRemoteHead,
      commit,
    });
    await this.store.transition(runId, "pushed", "commit.pushed", pushed);
    await this.store.transition(runId, "completed", "run.completed", {
      commit,
    });
    return pushed;
  }
}
