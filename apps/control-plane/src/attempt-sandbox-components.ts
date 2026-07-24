// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type {
  BackupOptions,
  DirectoryBackup,
  ExecOptions,
  ExecResult,
  Process,
  ProcessOptions,
} from "@cloudflare/sandbox";

export type SandboxTrace = (
  attemptId: string | undefined,
  phase: string,
  startedAt?: number,
  detail?: Readonly<Record<string, unknown>>,
) => Promise<void>;

export interface SandboxComponentHost {
  readonly trace: SandboxTrace;
  readonly exec: (
    command: string,
    options?: ExecOptions,
  ) => Promise<ExecResult>;
  readonly getProcess: (processId: string) => Promise<Process | null>;
  readonly startProcess: (
    command: string,
    options?: ProcessOptions,
  ) => Promise<Process>;
  readonly getProcessLogs: (processId: string) => Promise<{
    stdout: string;
    stderr: string;
    processId: string;
  }>;
  readonly exists: (path: string) => Promise<{ exists: boolean }>;
  readonly killAllProcesses: () => Promise<unknown>;
  readonly createBackup: (options: BackupOptions) => Promise<DirectoryBackup>;
  readonly restoreBackup: (backup: DirectoryBackup) => Promise<unknown>;
  readonly containerFetch: (
    url: string,
    init: RequestInit,
    port: number,
  ) => Promise<Response>;
  readonly awaitWithHeartbeat: <T>(
    attemptId: string,
    phase: string,
    operation: Promise<T>,
  ) => Promise<T>;
}

export type NestedContainerRuntimeHost = Pick<
  SandboxComponentHost,
  "exec" | "getProcess" | "getProcessLogs" | "startProcess" | "trace"
>;

export type PreviewTransportHost = Pick<
  SandboxComponentHost,
  "containerFetch" | "trace"
>;

export type WorkspaceLifecycleHost = Pick<
  SandboxComponentHost,
  | "awaitWithHeartbeat"
  | "createBackup"
  | "exec"
  | "exists"
  | "killAllProcesses"
  | "restoreBackup"
  | "trace"
>;
