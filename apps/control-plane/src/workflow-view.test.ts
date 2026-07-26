// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  compileWorkflow,
  defaultIssueWorkflowSource,
  type RunSnapshot,
} from "@roundhouse/core";
import { describe, expect, it } from "vitest";
import { renderWorkflowView } from "./workflow-view.js";

describe("workflow graph view", () => {
  it("renders the immutable graph, authority, editor, and GitHub proposal path", async () => {
    const workflow = await compileWorkflow(
      defaultIssueWorkflowSource,
      "a".repeat(40),
    );
    const run = {
      schemaVersion: 2,
      id: "run_workflow",
      repository: "zorkian/roundhouse",
      githubDefaultBranch: "main",
      issueNumber: 1,
      baseCommit: "a".repeat(40),
      currentHead: "b".repeat(40),
      profileVersion: "c".repeat(64),
      profile: {
        sourcePath: ".roundhouse/profile.yaml",
        sourceCommit: "a".repeat(40),
        version: 2,
        hash: "c".repeat(64),
        workflow,
        paths: { allowed: ["**"], protected: [] },
      },
      workflowHash: workflow.hash,
      currentNodeId: "implement",
      status: "active",
      stage: "implement",
      revision: 4,
    } satisfies RunSnapshot;
    const html = renderWorkflowView(run);
    expect(html).toContain('aria-label="Workflow graph"');
    expect(html).toContain("agent.write");
    expect(html).toContain("artifact.write");
    expect(html).toContain("Workflow editor");
    expect(html).toContain("Validate workflow");
    expect(html).toContain(
      "https://github.com/zorkian/roundhouse/edit/main/.roundhouse/workflow.yaml",
    );
    expect(html).toContain(workflow.hash);
    expect(html).toContain("Existing runs keep their original snapshot.");
  });
});
