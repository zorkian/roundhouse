// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  compileWorkflow,
  defaultIssueWorkflowSource,
  type RunSnapshot,
} from "@roundhouse/core";
import { describe, expect, it } from "vitest";
import { renderWorkflowView, workflowGraphElements } from "./workflow-view.js";
import { workflowGraphClientScript } from "./workflow-client.js";

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
  it("renders the labeled graph container, editor, and GitHub proposal path", async () => {
    const run = await runFixture();
    const html = renderWorkflowView(run);
    expect(html).toContain('id="workflow-graph"');
    expect(html).toContain('aria-label="Workflow graph.');
    expect(html).toContain('id="workflow-graph-data"');
    expect(html).toContain('src="/assets/workflow-graph.js"');
    // The interactive graph replaces the static server-generated SVG.
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<script>const source=");
    expect(html).toContain("Workflow editor");
    expect(html).toContain("Validate workflow");
    expect(html).toContain("Copy YAML");
    expect(html).toContain(`data-source-commit="${"a".repeat(40)}"`);
    expect(html).toContain(
      "https://github.com/zorkian/roundhouse/edit/main/.roundhouse/workflow.yaml",
    );
    expect(html).toContain(run.profile!.workflow!.hash);
    expect(html).toContain("Existing runs keep their original snapshot.");
  });

  it("emits graph elements with node metadata and every directed edge", async () => {
    const run = await runFixture();
    const workflow = run.profile!.workflow!;
    const elements = workflowGraphElements(workflow);
    const nodes = elements.filter((element) => element.group === "nodes");
    const edges = elements.filter((element) => element.group === "edges");

    // One node per workflow node, preserving ID, executor, and authority.
    expect(nodes.map((node) => node.data["id"])).toEqual(
      Object.keys(workflow.nodes),
    );
    for (const node of nodes) {
      const compiled = workflow.nodes[node.data["id"]!]!;
      expect(node.data["executor"]).toBe(compiled.executor);
      expect(node.data["authority"]).toBe(
        compiled.capabilities.join(", ") || "no external authority",
      );
      expect(node.data["label"]).toContain(node.data["id"]!);
      expect(node.data["label"]).toContain(compiled.executor);
    }
    expect(nodes.some((node) => node.data["executor"] === "agent.write")).toBe(
      true,
    );
    expect(
      nodes.some((node) => node.data["authority"]!.includes("artifact.write")),
    ).toBe(true);
    // A capability-free node falls back to explicit no-authority text.
    const synthetic = workflowGraphElements({
      ...workflow,
      nodes: { lone: { ...workflow.nodes["plan"]!, capabilities: [] } },
    });
    expect(synthetic[0]!.data["authority"]).toBe("no external authority");

    // One directed edge per transition with a destination, with unique IDs.
    const routed = Object.values(workflow.nodes).flatMap((node) =>
      node.transitions.filter((transition) => transition.to),
    );
    expect(edges).toHaveLength(routed.length);
    expect(new Set(edges.map((edge) => edge.data["id"])).size).toBe(
      edges.length,
    );

    // The default workflow's self-cycle and backward transition survive as
    // directed edges instead of collapsing.
    const selfCycle = edges.find(
      (edge) =>
        edge.data["source"] === "integrate" &&
        edge.data["target"] === "integrate",
    );
    expect(selfCycle).toBeDefined();
    const backward = edges.find(
      (edge) =>
        edge.data["source"] === "review" && edge.data["target"] === "implement",
    );
    expect(backward).toBeDefined();
  });

  it("embeds the graph data as escaped JSON inside the page", async () => {
    const run = await runFixture();
    const html = renderWorkflowView(run);
    const match = html.match(
      /<script id="workflow-graph-data" type="application\/json">(.+?)<\/script>/,
    );
    expect(match).toBeDefined();
    expect(match![1]).not.toContain("<");
    const elements = JSON.parse(match![1]!) as ReturnType<
      typeof workflowGraphElements
    >;
    expect(elements).toEqual(workflowGraphElements(run.profile!.workflow!));
  });

  it("ships client behavior for selection highlighting and the editor actions", () => {
    // Cycle-capable force-directed layout with directed arrows.
    expect(workflowGraphClientScript).toContain('"cose"');
    expect(workflowGraphClientScript).toContain('"target-arrow-shape"');
    // Selecting a node emphasizes it and its connected edges, mutes the
    // rest, and tapping the background clears the state.
    expect(workflowGraphClientScript).toContain('"select", "node"');
    expect(workflowGraphClientScript).toContain("connectedEdges()");
    expect(workflowGraphClientScript).toContain(
      '"selected-node connected-edge muted"',
    );
    expect(workflowGraphClientScript).toContain("event.target === cy");
    // Structured timing logs at the graph initialization boundary.
    expect(workflowGraphClientScript).toContain("workflow_graph_initialized");
    expect(workflowGraphClientScript).toContain(
      "workflow_graph_layout_completed",
    );
    expect(workflowGraphClientScript).toContain("elapsedMs");
    // Validate and copy handlers moved here from the inline script.
    expect(workflowGraphClientScript).toContain('getElementById("validate")');
    expect(workflowGraphClientScript).toContain('getElementById("copy")');
    expect(workflowGraphClientScript).toContain("data-source-commit");
  });
});
