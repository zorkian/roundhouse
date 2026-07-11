import type { ProfileCommand } from "@roundhouse/repository-profile";

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
