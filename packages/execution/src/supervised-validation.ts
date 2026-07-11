// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RepositoryProfile } from "@roundhouse/repository-profile";

import { inventoryChangedFiles } from "./changed-files.js";
import type { ChangedFile } from "./changed-files.js";
import type {
  CommandExecution,
  ExecutionBackend,
  ExecutionLimits,
  ValidationLevel,
} from "./types.js";
import {
  planValidation,
  type ValidationCommandName,
} from "./validation-plan.js";

const maxPatchBytes = 20 * 1024 * 1024;

export type SupervisedValidationInput = {
  repositoryPath: string;
  baseCommit: string;
  level: ValidationLevel;
  profile: RepositoryProfile;
  backend: ExecutionBackend;
  limits: ExecutionLimits;
};

export type ValidationCommandEvidence = {
  name: ValidationCommandName;
  command: { command: string; args: string[] };
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  outputTruncated: boolean;
  stdoutSha256: string;
  stderrSha256: string;
};

export type ValidationEvidence = {
  schemaVersion: 1;
  baseCommit: string;
  requestedLevel: ValidationLevel;
  effectiveLevel: ValidationLevel;
  changedFiles: Awaited<ReturnType<typeof inventoryChangedFiles>>;
  reasons: string[];
  commands: ValidationCommandEvidence[];
  succeeded: boolean;
  failedCommand?: ValidationCommandName;
  patchSha256: string;
  patchBytes: number;
};

export type SupervisedValidationResult = {
  evidence: ValidationEvidence;
  executions: CommandExecution[];
  patch: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(
  repositoryPath: string,
  args: string[],
  acceptedExitCodes: number[] = [0],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: repositoryPath,
        encoding: "utf8",
        maxBuffer: maxPatchBytes,
        env,
      },
      (error, stdout) => {
        const exitCode =
          error && "code" in error && typeof error.code === "number"
            ? error.code
            : 0;
        if (error && !acceptedExitCodes.includes(exitCode)) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export async function captureRepositoryPatch(
  repositoryPath: string,
  baseCommit: string,
  changedFiles: ChangedFile[],
): Promise<string> {
  if (changedFiles.length === 0) return "";
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "roundhouse-git-index-"),
  );
  const env = {
    ...process.env,
    GIT_INDEX_FILE: join(temporaryDirectory, "index"),
  };
  const paths = [
    ...new Set(
      changedFiles.flatMap((change) =>
        change.previousPath
          ? [change.previousPath, change.path]
          : [change.path],
      ),
    ),
  ];
  try {
    await git(repositoryPath, ["read-tree", baseCommit], [0], env);
    await git(repositoryPath, ["add", "--all", "--", ...paths], [0], env);
    return await git(
      repositoryPath,
      ["diff", "--cached", "--binary", "--no-ext-diff", baseCommit, "--"],
      [0],
      env,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function commandEvidence(
  name: ValidationCommandName,
  execution: CommandExecution,
): ValidationCommandEvidence {
  return {
    name,
    command: execution.command,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    durationMs: execution.durationMs,
    exitCode: execution.exitCode,
    signal: execution.signal,
    timedOut: execution.timedOut,
    outputTruncated: execution.outputTruncated,
    stdoutSha256: sha256(execution.stdout),
    stderrSha256: sha256(execution.stderr),
  };
}

export async function runSupervisedValidation(
  input: SupervisedValidationInput,
): Promise<SupervisedValidationResult> {
  const changedFiles = await inventoryChangedFiles(
    input.repositoryPath,
    input.baseCommit,
  );
  const plan = planValidation(input.profile, {
    baseCommit: input.baseCommit,
    changedFiles,
    level: input.level,
  });
  const executions: CommandExecution[] = [];
  const commands: ValidationCommandEvidence[] = [];
  let failedCommand: ValidationCommandName | undefined;

  for (const planned of plan.commands) {
    const execution = await input.backend.run(
      planned.command,
      input.repositoryPath,
      input.limits,
    );
    executions.push(execution);
    commands.push(commandEvidence(planned.name, execution));
    if (execution.timedOut || execution.exitCode !== 0) {
      failedCommand = planned.name;
      break;
    }
  }

  const patch = await captureRepositoryPatch(
    input.repositoryPath,
    input.baseCommit,
    changedFiles,
  );
  const succeeded = failedCommand === undefined;
  return {
    executions,
    patch,
    evidence: {
      schemaVersion: 1,
      baseCommit: input.baseCommit,
      requestedLevel: plan.requestedLevel,
      effectiveLevel: plan.effectiveLevel,
      changedFiles,
      reasons: plan.reasons,
      commands,
      succeeded,
      ...(failedCommand ? { failedCommand } : {}),
      patchSha256: sha256(patch),
      patchBytes: Buffer.byteLength(patch),
    },
  };
}
