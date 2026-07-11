// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileRunStore } from "./run-store.js";
import type { SelfDevelopmentTask } from "./task.js";

const roots: string[] = [];
const task: SelfDevelopmentTask = {
  schemaVersion: 1,
  taskId: "task_test",
  subject: "Change Roundhouse",
  instructions: "Make a bounded test change.",
  repositoryPath: "/repository",
  baseCommit: "a".repeat(40),
  validationLevel: "quick",
  allowedPaths: ["packages/**"],
  publication: {
    remote: "origin",
    remoteUrl: "https://github.com/example/roundhouse.git",
    branch: "roundhouse/test",
    expectedRemoteHead: null,
    commitMessage: "Apply test change",
    authorName: "Roundhouse",
    authorEmail: "roundhouse@example.invalid",
  },
};

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "roundhouse-runs-"));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("FileRunStore", () => {
  it("survives a new store instance and retains ordered transitions", async () => {
    const path = await root();
    const first = new FileRunStore(path);
    await first.create("run_test", task, "2026-07-11T00:00:00.000Z");
    await first.transition(
      "run_test",
      "workspace_ready",
      "workspace.created",
      { baseCommit: task.baseCommit },
      { workspacePath: "/workspace" },
      "2026-07-11T00:00:01.000Z",
    );

    const recovered = await new FileRunStore(path).read("run_test");
    expect(recovered).toMatchObject({
      state: "workspace_ready",
      workspacePath: "/workspace",
    });
    expect(recovered.events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("rejects invalid transitions", async () => {
    const store = new FileRunStore(await root());
    await store.create("run_test", task);
    await expect(
      store.transition("run_test", "approved", "approval.recorded"),
    ).rejects.toThrow("Invalid run transition: created -> approved");
  });
});
