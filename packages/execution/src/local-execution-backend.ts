// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { spawn } from "node:child_process";
import { once } from "node:events";

import type {
  CommandExecution,
  ExecutionBackend,
  ExecutionLimits,
} from "./types.js";
import type { ProfileCommand } from "@roundhouse/repository-profile";

type CapturedOutput = { chunks: Buffer[]; bytes: number; truncated: boolean };

function capture(
  target: CapturedOutput,
  chunk: Buffer,
  maxBytes: number,
): void {
  const remaining = maxBytes - target.bytes;
  if (remaining <= 0) {
    target.truncated = true;
    return;
  }

  target.chunks.push(chunk.subarray(0, remaining));
  target.bytes += Math.min(chunk.length, remaining);
  target.truncated ||= chunk.length > remaining;
}

export class LocalExecutionBackend implements ExecutionBackend {
  readonly name = "local";

  async run(
    command: ProfileCommand,
    cwd: string,
    limits: ExecutionLimits,
  ): Promise<CommandExecution> {
    const startedAt = new Date();
    const child = spawn(command.command, command.args, {
      cwd,
      env: { ...process.env },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: CapturedOutput = { chunks: [], bytes: 0, truncated: false };
    const stderr: CapturedOutput = { chunks: [], bytes: 0, truncated: false };

    child.stdout.on("data", (chunk: Buffer) =>
      capture(stdout, chunk, limits.maxOutputBytes),
    );
    child.stderr.on("data", (chunk: Buffer) =>
      capture(stderr, chunk, limits.maxOutputBytes),
    );

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, limits.timeoutMs);
    timer.unref();

    let exitCode: number | null = null;
    let signal: NodeJS.Signals | null = null;
    try {
      // `close` fires after the stdio streams have closed, so the recorded
      // evidence cannot omit output that was still buffered at process exit.
      [exitCode, signal] = (await once(child, "close")) as [
        number | null,
        NodeJS.Signals | null,
      ];
    } finally {
      clearTimeout(timer);
    }

    const completedAt = new Date();
    return {
      command,
      cwd,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      exitCode,
      signal,
      timedOut,
      outputTruncated: stdout.truncated || stderr.truncated,
      stdout: Buffer.concat(stdout.chunks).toString("utf8"),
      stderr: Buffer.concat(stderr.chunks).toString("utf8"),
    };
  }
}
