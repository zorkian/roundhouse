// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  selfDevelopmentRunSchema,
  type SelfDevelopmentRun,
  type SelfDevelopmentRunState,
  type SelfDevelopmentTask,
} from "./task.js";

const transitions: Record<
  SelfDevelopmentRunState,
  readonly SelfDevelopmentRunState[]
> = {
  created: ["workspace_ready", "failed", "cancelled"],
  workspace_ready: ["implementing", "failed", "cancelled"],
  implementing: ["validating", "failed", "cancelled"],
  validating: ["awaiting_approval", "failed", "cancelled"],
  awaiting_approval: ["approved", "cancelled"],
  approved: ["committed", "cancelled"],
  committed: ["pushed", "failed"],
  pushed: ["completed", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export class FileRunStore {
  constructor(private readonly root: string) {}

  private path(runId: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(runId))
      throw new Error("Invalid run ID");
    return join(this.root, "runs", runId, "run.json");
  }

  private async write(run: SelfDevelopmentRun): Promise<void> {
    const path = this.path(run.runId);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  }

  async create(
    runId: string,
    task: SelfDevelopmentTask,
    now = new Date().toISOString(),
  ): Promise<SelfDevelopmentRun> {
    const run = selfDevelopmentRunSchema.parse({
      schemaVersion: 1,
      runId,
      task,
      state: "created",
      createdAt: now,
      updatedAt: now,
      events: [
        {
          sequence: 1,
          type: "run.created",
          state: "created",
          occurredAt: now,
          detail: {},
        },
      ],
    });
    try {
      await readFile(this.path(runId), "utf8");
      throw new Error(`Run already exists: ${runId}`);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
    }
    await this.write(run);
    return run;
  }

  async read(runId: string): Promise<SelfDevelopmentRun> {
    return selfDevelopmentRunSchema.parse(
      JSON.parse(await readFile(this.path(runId), "utf8")),
    );
  }

  async transition(
    runId: string,
    state: SelfDevelopmentRunState,
    type: string,
    detail: Record<string, unknown> = {},
    updates: Partial<Pick<SelfDevelopmentRun, "workspacePath">> = {},
    now = new Date().toISOString(),
  ): Promise<SelfDevelopmentRun> {
    const current = await this.read(runId);
    if (!(transitions[current.state] ?? []).includes(state))
      throw new Error(`Invalid run transition: ${current.state} -> ${state}`);
    const run = selfDevelopmentRunSchema.parse({
      ...current,
      ...updates,
      state,
      updatedAt: now,
      events: [
        ...current.events,
        {
          sequence: current.events.length + 1,
          type,
          state,
          occurredAt: now,
          detail,
        },
      ],
    });
    await this.write(run);
    return run;
  }
}
