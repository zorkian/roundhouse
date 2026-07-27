// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  compileWorkflow,
  defaultIssueWorkflowSource,
  type RunSnapshot,
} from "@roundhouse/core";
import { describe, expect, it } from "vitest";
import { renderWorkflowView } from "./workflow-view.js";

async function runFixture(): Promise<RunSnapshot> {
  const workflow = await compileWorkflow(
    defaultIssueWorkflowSource,
    "a".repeat(40),
  );
  return {
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
  };
}

describe("workflow graph view", () => {
  it("renders the immutable graph, authority, editor, and GitHub proposal path", async () => {
    const run = await runFixture();
    const html = renderWorkflowView(run);
    expect(html).toContain('aria-label="Workflow graph"');
    expect(html).toContain("agent.write");
    expect(html).toContain("artifact.write");
    expect(html).toContain("Workflow editor");
    expect(html).toContain("Validate workflow");
    expect(html).toContain(
      "https://github.com/zorkian/roundhouse/edit/main/.roundhouse/workflow.yaml",
    );
    expect(html).toContain(run.profile!.workflow!.hash);
    expect(html).toContain("Existing runs keep their original snapshot.");
  });

  it("routes edges around nodes with arrowed paths instead of center-to-center lines", async () => {
    const run = await runFixture();
    const workflow = run.profile!.workflow!;
    const html = renderWorkflowView(run);
    const svg = html.slice(html.indexOf("<svg"), html.indexOf("</svg>"));
    // No straight center-to-center lines remain; every edge is a routed path
    // with a direction marker.
    expect(svg).not.toContain("<line");
    const edgePaths =
      svg.match(
        /<path class="edge" d="[^"]+" marker-end="url\(#arrow\)"><title>[^<]+<\/title><\/path>/g,
      ) ?? [];
    const routed = Object.entries(workflow.nodes).flatMap(([from, node]) =>
      node.transitions.filter((transition) => transition.to),
    );
    expect(edgePaths).toHaveLength(routed.length);
    // The default workflow crosses columns and rows, so at least one edge
    // must use a multi-segment routed path rather than a direct segment.
    expect(
      edgePaths.some((path) => (path.match(/ L /g) ?? []).length >= 3),
    ).toBe(true);
    // The integrate → integrate self-transition renders as a nonzero loop
    // outside its node instead of a zero-length line.
    const selfLoop = edgePaths.find((path) =>
      path.includes("<title>integrate → integrate</title>"),
    );
    expect(selfLoop).toBeDefined();
    const selfNumbers = (selfLoop!.match(/-?\d+/g) ?? []).map(Number);
    expect(Math.max(...selfNumbers) - Math.min(...selfNumbers)).toBeGreaterThan(
      0,
    );
    expect(selfLoop).toContain("L");
    // The backward review → implement route terminates on node boundaries,
    // not box centers.
    const backward = edgePaths.find((path) =>
      path.includes("<title>review → implement</title>"),
    );
    expect(backward).toBeDefined();
    expect(backward).not.toMatch(/M 490 175 L 150 175/);
    // Every edge carries a visible direction marker.
    expect(
      edgePaths.every((path) => path.includes('marker-end="url(#arrow)"')),
    ).toBe(true);
    expect(html).toContain('aria-label="Workflow graph"');
  });
});
