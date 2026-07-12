// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  LocalExecutionBackend,
  type ValidationApproval,
} from "@roundhouse/execution";
import { parseRepositoryProfile } from "@roundhouse/repository-profile";

import { CodexExecAdapter, validateTimeoutMs } from "./codex-adapter.js";
import { SelfDevelopmentOrchestrator } from "./orchestrator.js";
import type { SelfDevelopmentTask } from "./task.js";

type Arguments = { command: string; values: Map<string, string> };

function parseArguments(argv: string[]): Arguments {
  const [command, ...rest] = argv;
  if (!command) throw new Error("A command is required");
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined)
      throw new Error("Arguments must be --name value pairs");
    values.set(key.slice(2), value);
  }
  return { command, values };
}

function required(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

export function parseTimeoutMs(value: string | undefined): number {
  const timeoutMs = value === undefined ? 600_000 : Number(value);
  return validateTimeoutMs(timeoutMs);
}

export async function runWalkingSkeletonCli(argv: string[]): Promise<unknown> {
  const { command, values } = parseArguments(argv);
  const root = resolve(required(values, "root"));
  const runId = required(values, "run");
  const profile = parseRepositoryProfile(
    await readFile(resolve(required(values, "profile")), "utf8"),
  );
  const orchestrator = new SelfDevelopmentOrchestrator(root, profile);
  const backend = new LocalExecutionBackend();

  if (command === "start") {
    const task = JSON.parse(
      await readFile(resolve(required(values, "task")), "utf8"),
    ) as SelfDevelopmentTask;
    await orchestrator.start(runId, task, backend);
    return orchestrator.store.read(runId);
  }
  if (command === "implement") {
    const adapter = new CodexExecAdapter({
      codexHome: resolve(values.get("codex-home") ?? `${homedir()}/.codex`),
      timeoutMs: parseTimeoutMs(values.get("timeout-ms")),
    });
    await orchestrator.implement(runId, adapter);
    return orchestrator.store.read(runId);
  }
  if (command === "validate") {
    await orchestrator.validate(runId, backend);
    return orchestrator.store.read(runId);
  }
  if (command === "approve") {
    const approval = JSON.parse(
      await readFile(resolve(required(values, "approval")), "utf8"),
    ) as ValidationApproval;
    if (approval.runId !== runId) throw new Error("Approval run ID mismatch");
    await orchestrator.approve(approval);
    return orchestrator.store.read(runId);
  }
  if (command === "commit") {
    return orchestrator.commit(runId);
  }
  if (command === "push") {
    return orchestrator.push(runId, required(values, "commit"));
  }
  if (command === "status") return orchestrator.store.read(runId);
  throw new Error(`Unknown command: ${command}`);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runWalkingSkeletonCli(process.argv.slice(2))
    .then((result) =>
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    )
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Unknown error"}\n`,
      );
      process.exitCode = 1;
    });
}
