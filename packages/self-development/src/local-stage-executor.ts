// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, matchesGlob } from "node:path";

import type { AgentAdapter, AgentEvent } from "@roundhouse/domain";
import {
  inventoryChangedFiles,
  persistValidationArtifacts,
  publishApprovedPatch,
  runSupervisedValidation,
  type ExecutionBackend,
} from "@roundhouse/execution";
import type { RepositoryProfile } from "@roundhouse/repository-profile";

import type { JobStageExecutor, StageResult } from "./job-ports.js";
import { StageFailure } from "./resumable-coordinator.js";
import type { JobStage, SelfDevelopmentRun } from "./task.js";
import { pushVerifiedCommit } from "./verified-push.js";
import {
  createIsolatedWorkspace,
  resetIsolatedWorkspace,
} from "./workspace.js";

function localPath(reference: string | undefined): string {
  if (!reference?.startsWith("local:"))
    throw new StageFailure(
      "Run has no local workspace reference",
      "state",
      false,
    );
  return reference.slice("local:".length);
}

export class LocalJobStageExecutor implements JobStageExecutor {
  constructor(
    private readonly root: string,
    private readonly profile: RepositoryProfile,
    private readonly backend: ExecutionBackend,
    private readonly agent: AgentAdapter,
  ) {}

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

  async execute(
    stage: JobStage,
    run: SelfDevelopmentRun,
  ): Promise<StageResult> {
    switch (stage) {
      case "prepare":
        return this.prepare(run);
      case "implement":
        return this.implement(run);
      case "validate":
        return this.validate(run);
      case "commit":
        return this.commit(run);
      case "push":
        return this.push(run);
      case "complete":
        return { state: "completed", detail: { commit: run.commit } };
    }
  }

  private async prepare(run: SelfDevelopmentRun): Promise<StageResult> {
    const workspace = await createIsolatedWorkspace({
      sourceRepository: run.task.repositoryPath,
      baseCommit: run.task.baseCommit,
      workspaceRoot: this.root,
      runId: run.runId,
      remoteUrl: run.task.publication.remoteUrl,
      authorName: run.task.publication.authorName,
      authorEmail: run.task.publication.authorEmail,
    });
    const bootstrap = await this.backend.run(
      this.profile.bootstrap,
      workspace,
      {
        timeoutMs: this.profile.validation.timeoutMinutes * 60_000,
        maxOutputBytes: 1024 * 1024,
      },
    );
    if (bootstrap.timedOut || bootstrap.exitCode !== 0)
      throw new StageFailure(
        "Repository bootstrap failed",
        "infrastructure",
        true,
      );
    return {
      state: "workspace_ready",
      updates: { workspaceRef: `local:${workspace}`, workspacePath: workspace },
      detail: {
        baseCommit: run.task.baseCommit,
        bootstrapExitCode: bootstrap.exitCode,
      },
    };
  }

  private async implement(run: SelfDevelopmentRun): Promise<StageResult> {
    const workspace = localPath(run.workspaceRef);
    await resetIsolatedWorkspace(workspace, run.task.baseCommit);
    const events: AgentEvent[] = [];
    for await (const event of this.agent.start({
      attemptId: `${run.runId}-implementation-${run.attempts.filter((value) => value.stage === "implement").length}`,
      prompt: run.task.instructions,
      workspace,
      allowedTools: ["shell", "apply_patch"],
    }))
      events.push(event);
    await this.persistAgentEvents(run.runId, events);
    const completion = [...events]
      .reverse()
      .find((event) => event.type === "completed");
    if (
      !completion ||
      completion.type !== "completed" ||
      completion.outcome !== "succeeded"
    )
      throw new StageFailure("Implementation adapter failed", "agent", true);
    const changedFiles = await inventoryChangedFiles(
      workspace,
      run.task.baseCommit,
    );
    if (changedFiles.length === 0)
      throw new StageFailure(
        "Implementation produced no changes",
        "agent",
        true,
      );
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
      throw new StageFailure(
        `Implementation changed disallowed path: ${disallowed.path}`,
        "policy",
        false,
      );
    return {
      state: "validating",
      detail: { changedFiles, eventCount: events.length },
    };
  }

  private async validate(run: SelfDevelopmentRun): Promise<StageResult> {
    const result = await runSupervisedValidation({
      repositoryPath: localPath(run.workspaceRef),
      baseCommit: run.task.baseCommit,
      level: run.task.validationLevel,
      profile: this.profile,
      backend: this.backend,
      limits: {
        timeoutMs: this.profile.validation.timeoutMinutes * 60_000,
        maxOutputBytes: 1024 * 1024,
      },
    });
    const manifest = await persistValidationArtifacts(
      this.root,
      run.runId,
      result,
    );
    if (!result.evidence.succeeded)
      throw new StageFailure(
        `Validation failed at ${result.evidence.failedCommand ?? "unknown"}`,
        "validation",
        false,
      );
    return {
      state: "awaiting_approval",
      detail: {
        patchSha256: manifest.patch.sha256,
        patchBytes: manifest.patch.bytes,
      },
    };
  }

  private async commit(run: SelfDevelopmentRun): Promise<StageResult> {
    const publication = await publishApprovedPatch({
      repositoryPath: localPath(run.workspaceRef),
      artifactRoot: this.root,
      runId: run.runId,
      message: run.task.publication.commitMessage,
    });
    return {
      state: "committed",
      updates: { commit: publication.commit },
      detail: publication,
    };
  }

  private async push(run: SelfDevelopmentRun): Promise<StageResult> {
    if (!run.commit)
      throw new StageFailure("Run has no approved commit", "state", false);
    const pushed = await pushVerifiedCommit({
      repositoryPath: localPath(run.workspaceRef),
      remote: run.task.publication.remote,
      expectedRemoteUrl: run.task.publication.remoteUrl,
      branch: run.task.publication.branch,
      expectedRemoteHead: run.task.publication.expectedRemoteHead,
      commit: run.commit,
    });
    return { state: "pushed", detail: pushed };
  }
}
