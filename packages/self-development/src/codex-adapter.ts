// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentMessage,
  AgentRunInput,
} from "@roundhouse/domain";

export type CodexExecAdapterOptions = {
  binary?: string;
  binaryPrefixArgs?: string[];
  codexHome: string;
  timeoutMs?: number;
  maxEventBytes?: number;
};

const maximumTimerMilliseconds = 2_147_483_647;

export function validateTimeoutMs(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximumTimerMilliseconds
  )
    throw new Error("timeoutMs must be a positive supported integer");
  return value;
}

type CodexJsonEvent = {
  type?: string;
  thread_id?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  item?: {
    id?: string;
    type?: string;
    text?: string;
    command?: string;
    aggregated_output?: string;
  };
};

function environment(home: string, codexHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) {
    if (
      /(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/i.test(name) ||
      /^(GH|GITHUB|CLOUDFLARE)_/i.test(name)
    )
      delete env[name];
  }
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: codexHome,
  });
  return env;
}

function prompt(input: AgentRunInput): string {
  const allowed = input.allowedTools.join(", ");
  return [
    "You are a bounded implementation agent operating inside an isolated checkout.",
    "Do not access credentials, external services, or paths outside this workspace.",
    `Allowed tool categories: ${allowed}.`,
    "Make only the requested code changes. Do not commit, push, or create branches.",
    "Finish with a concise summary of changes and tests run.",
    "",
    input.prompt,
  ].join("\n");
}

function normalize(event: CodexJsonEvent): AgentEvent[] {
  if (event.type === "thread.started" && event.thread_id)
    return [{ type: "session.started", sessionId: event.thread_id }];
  if (event.type === "item.started" && event.item?.id && event.item.type)
    return [
      {
        type: "tool.started",
        name: event.item.type,
        callId: event.item.id,
        input: event.item.command ?? null,
      },
    ];
  if (event.type === "item.completed" && event.item?.type === "agent_message")
    return [
      { type: "message", role: "assistant", text: event.item.text ?? "" },
    ];
  if (event.type === "item.completed" && event.item?.id)
    return [
      {
        type: "tool.completed",
        callId: event.item.id,
        output: event.item.aggregated_output ?? event.item.text ?? null,
        durationMs: 0,
      },
    ];
  if (event.type === "turn.completed" && event.usage)
    return [
      {
        type: "usage",
        inputTokens: event.usage.input_tokens,
        outputTokens: event.usage.output_tokens,
      },
    ];
  return [];
}

export class CodexExecAdapter implements AgentAdapter {
  readonly name = "codex-exec";
  private readonly children = new Map<string, ChildProcess>();
  private readonly options: CodexExecAdapterOptions;

  constructor(options: CodexExecAdapterOptions) {
    if (options.timeoutMs !== undefined) validateTimeoutMs(options.timeoutMs);
    this.options = options;
  }

  async capabilities(): Promise<AgentCapabilities> {
    return new Set([
      "cancel",
      "structured-events",
      "tool-restrictions",
      "usage-reporting",
    ]);
  }

  async *start(input: AgentRunInput): AsyncIterable<AgentEvent> {
    const unsupported = input.allowedTools.filter(
      (tool) => !["shell", "apply_patch"].includes(tool),
    );
    if (unsupported.length > 0)
      throw new Error(`Unsupported Codex tool category: ${unsupported[0]}`);

    const temporaryHome = await mkdtemp(
      join(tmpdir(), "roundhouse-codex-home-"),
    );
    const args = [
      ...(this.options.binaryPrefixArgs ?? []),
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--sandbox",
      "workspace-write",
      "-c",
      "sandbox_workspace_write.network_access=false",
      "-c",
      'shell_environment_policy.inherit="none"',
      "--json",
      "-C",
      input.workspace,
      prompt(input),
    ];
    const child = spawn(this.options.binary ?? "codex", args, {
      cwd: input.workspace,
      env: environment(temporaryHome, this.options.codexHome),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exitPromise = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    this.children.set(input.attemptId, child);
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-16 * 1024);
    });
    const timer = setTimeout(
      () => child.kill("SIGTERM"),
      this.options.timeoutMs ?? 10 * 60_000,
    );
    const lines = createInterface({ input: child.stdout! });
    let eventBytes = 0;

    try {
      for await (const line of lines) {
        eventBytes += Buffer.byteLength(line);
        if (eventBytes > (this.options.maxEventBytes ?? 5 * 1024 * 1024)) {
          child.kill("SIGTERM");
          throw new Error("Codex event output exceeded its limit");
        }
        let event: CodexJsonEvent;
        try {
          event = JSON.parse(line) as CodexJsonEvent;
        } catch {
          child.kill("SIGTERM");
          throw new Error("Codex emitted invalid JSONL");
        }
        for (const normalized of normalize(event)) yield normalized;
      }
      const exit = await exitPromise;
      yield {
        type: "completed",
        outcome: exit.code === 0 ? "succeeded" : "failed",
        ...(exit.code === 0
          ? {}
          : {
              detail: `Codex exited with ${exit.code ?? exit.signal}: ${stderr}`,
            }),
      };
    } finally {
      clearTimeout(timer);
      this.children.delete(input.attemptId);
      await rm(temporaryHome, { recursive: true, force: true });
    }
  }

  async *resume(
    _sessionId: string,
    _input: AgentMessage,
  ): AsyncIterable<AgentEvent> {
    throw new Error("Codex resume is not enabled for the walking skeleton");
  }

  async cancel(attemptId: string): Promise<void> {
    this.children.get(attemptId)?.kill("SIGTERM");
  }
}
