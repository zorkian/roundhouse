// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  compileWorkflow,
  defaultIssueWorkflowSource,
  serializeWorkflow,
} from "./workflow.js";

describe("Roundhouse repository workflow", () => {
  it("compiles the checked-in issue-to-merge graph", async () => {
    const source = await readFile(".roundhouse/workflow.yaml", "utf8");
    const workflow = await compileWorkflow(source, "a".repeat(40), (path) =>
      readFile(path, "utf8"),
    );
    const compatibilityWorkflow = await compileWorkflow(
      defaultIssueWorkflowSource,
      "a".repeat(40),
    );
    expect(
      Object.fromEntries(
        Object.entries(compatibilityWorkflow.nodes).map(([id, node]) => [
          id,
          { executor: node.executor, transitions: node.transitions },
        ]),
      ),
    ).toEqual(
      Object.fromEntries(
        Object.entries(workflow.nodes).map(([id, node]) => [
          id,
          { executor: node.executor, transitions: node.transitions },
        ]),
      ),
    );
    expect(workflow.triggers["github.issue.started"]).toBe("qualify");
    expect(Object.keys(workflow.nodes)).toEqual([
      "qualify",
      "investigate",
      "plan",
      "implement",
      "review",
      "integrate",
      "checks",
      "merge",
    ]);
    const roundTripped = await compileWorkflow(
      serializeWorkflow(workflow),
      "a".repeat(40),
      (path) => readFile(path, "utf8"),
    );
    expect(roundTripped).toEqual(workflow);
  });
});
