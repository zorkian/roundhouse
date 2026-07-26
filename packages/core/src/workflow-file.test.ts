// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compileWorkflow, defaultIssueWorkflowSource } from "./workflow.js";

describe("Roundhouse repository workflow", () => {
  it("compiles the checked-in issue-to-merge graph", async () => {
    const source = await readFile(".roundhouse/workflow.yaml", "utf8");
    const workflow = await compileWorkflow(source, "a".repeat(40));
    const compatibilityWorkflow = await compileWorkflow(
      defaultIssueWorkflowSource,
      "a".repeat(40),
    );
    expect(compatibilityWorkflow.hash).toBe(workflow.hash);
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
  });
});
