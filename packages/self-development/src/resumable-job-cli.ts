// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { LocalExecutionBackend } from "@roundhouse/execution";
import { parseRepositoryProfile } from "@roundhouse/repository-profile";

import { CodexExecAdapter } from "./codex-adapter.js";
import { FileRunStore } from "./run-store.js";
import { LocalJobStageExecutor } from "./local-stage-executor.js";
import { ResumableCoordinator } from "./resumable-coordinator.js";
import type { SelfDevelopmentTask } from "./task.js";

type Parsed = { command: string; values: Map<string, string> };

function parse(argv: string[]): Parsed {
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

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error("Expected a positive integer");
  return parsed;
}

export async function runResumableJobCli(argv: string[]): Promise<unknown> {
  const { command, values } = parse(argv);
  const root = resolve(required(values, "root"));
  const runId = values.get("run");
  const store = new FileRunStore(root);
  if (command === "status") return store.read(required(values, "run"));

  const profile = parseRepositoryProfile(
    await readFile(resolve(required(values, "profile")), "utf8"),
  );
  const clock = { now: () => new Date() };
  const coordinator = new ResumableCoordinator(
    store,
    new LocalJobStageExecutor(
      root,
      profile,
      new LocalExecutionBackend(),
      new CodexExecAdapter({
        codexHome: resolve(values.get("codex-home") ?? `${homedir()}/.codex`),
        timeoutMs: positiveInteger(values.get("agent-timeout-ms"), 600_000),
      }),
    ),
    clock,
    {
      workerId: values.get("worker") ?? `worker-${process.pid}`,
      leaseMs: positiveInteger(values.get("lease-ms"), 1_800_000),
      maxAttemptsPerStage: positiveInteger(values.get("max-attempts"), 3),
    },
  );

  if (command === "submit") {
    const task = JSON.parse(
      await readFile(resolve(required(values, "task")), "utf8"),
    ) as SelfDevelopmentTask;
    await coordinator.submit(required(values, "run"), task);
    return store.read(required(values, "run"));
  }
  if (command === "work-once") return coordinator.workOnce();
  if (command === "work-until-blocked") {
    const completed = [];
    const maximum = positiveInteger(values.get("max-steps"), 20);
    for (let index = 0; index < maximum; index += 1) {
      const run = await coordinator.workOnce();
      if (!run) break;
      completed.push({
        runId: run.runId,
        state: run.state,
        revision: run.revision,
      });
      if (
        ["awaiting_approval", "completed", "failed", "cancelled"].includes(
          run.state,
        )
      )
        break;
    }
    return { completed, run: runId ? await store.read(runId) : undefined };
  }
  throw new Error(`Unknown command: ${command}`);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  runResumableJobCli(process.argv.slice(2))
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
