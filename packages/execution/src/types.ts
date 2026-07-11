// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ProfileCommand } from "@roundhouse/repository-profile";

import type { ChangedFile } from "./changed-files.js";

export type ValidationLevel = "quick" | "full" | "release";

export type ValidationRequest = {
  baseCommit: string;
  changedFiles: ChangedFile[];
  level: ValidationLevel;
};

export type ExecutionLimits = {
  timeoutMs: number;
  maxOutputBytes: number;
};

export type CommandExecution = {
  command: ProfileCommand;
  cwd: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  outputTruncated: boolean;
  stdout: string;
  stderr: string;
};

export interface ExecutionBackend {
  readonly name: string;
  run(
    command: ProfileCommand,
    cwd: string,
    limits: ExecutionLimits,
  ): Promise<CommandExecution>;
}
