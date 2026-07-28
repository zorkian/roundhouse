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
  it("preselects the run's current node through data-select", async () => {
    const run = await runFixture();
    const html = renderWorkflowView(run);
    expect(html).toContain('id="workflow-graph" data-select="implement"');
    const { renderWorkflowView: render } = await import("./workflow-view.js");
    const unselected = render({ ...run, currentNodeId: undefined });
    expect(unselected).not.toContain("data-select");
    const unknown = render({ ...run, currentNodeId: 'missing"><script>' });
    expect(unknown).not.toContain("data-select");
  });

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
      // The compact primary label shows only the stage name and summary.
      expect(node.data["name"]).toBeTruthy();
      expect(node.data["summary"]).toBeTruthy();
      expect(node.data["label"]).toBe(
        `${node.data["name"]}\n${node.data["summary"]}`,
      );
      expect(node.data["label"]).not.toContain(node.data["authority"]!);
      expect(node.data["outputs"]).toBeTruthy();
    }
    expect(nodes.some((node) => node.data["executor"] === "agent.write")).toBe(
      true,
    );
    expect(
      nodes.some((node) => node.data["authority"]!.includes("artifact.write")),
    ).toBe(true);
    // Detail metadata travels with the node data for the details panel.
    const implement = nodes.find((node) => node.data["id"] === "implement")!;
    expect(implement.data["task"]).toBe("implementation");
    expect(implement.data["role"]).toBeTruthy();
    const review = nodes.find((node) => node.data["id"] === "review")!;
    expect(review.data["reviewers"]).toBeTruthy();
    expect(review.data["summary"]).toContain("reviewer");
    // A capability-free node falls back to explicit no-authority text.
    const synthetic = workflowGraphElements({
      ...workflow,
      nodes: {
        lone: {
          ...workflow.nodes["plan"]!,
          capabilities: [],
          outputs: [],
        },
      },
    });
    expect(synthetic[0]!.data["authority"]).toBe("no external authority");
    expect(synthetic[0]!.data["outputs"]).toBe("none");

    // Long names and summaries are truncated so the wrapped label always
    // stays inside the fixed 240x110 node box vertically as well as
    // horizontally.
    const longName = "a-very-long-stage-".repeat(8);
    const longEvent = "very.long.external.event.".repeat(8);
    const longLabeled = workflowGraphElements({
      ...workflow,
      nodes: {
        lone: {
          ...workflow.nodes["implement"]!,
          role: `${longName} stage`,
          agent: undefined,
          external: { adapter: "pagerduty", event: longEvent, resultKey: "r" },
        },
      },
    });
    const longData = longLabeled[0]!.data;
    expect(longData["name"]!.length).toBeLessThanOrEqual(48);
    expect(longData["name"]!.endsWith("…")).toBe(true);
    const labelLines = longData["label"]!.split("\n");
    expect(labelLines).toHaveLength(2);
    expect(labelLines[0]!.length).toBeLessThanOrEqual(48);
    expect(labelLines[1]!.length).toBeLessThanOrEqual(96);
    // The full untruncated text remains available in the detail fields.
    expect(longData["external"]).toContain(longEvent);

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

  it("renders an accessible stage selector and details panel", async () => {
    const run = await runFixture();
    const workflow = run.profile!.workflow!;
    const html = renderWorkflowView(run);
    expect(html).toContain('id="workflow-stages"');
    expect(html).toContain('aria-label="Workflow stages"');
    expect(html).toContain('id="stage-details"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Stage details");
    expect(html).toContain(
      "Select a stage in the graph or the stage list to see its details.",
    );
    for (const id of Object.keys(workflow.nodes)) {
      expect(html).toContain(`data-stage="${id}"`);
    }
    expect(html).toContain('aria-pressed="false"');
    // Layout keeps the graph and details readable at both breakpoints.
    expect(html).toContain("#workflow-layout{display:flex");
    expect(html).toContain("#stage-details");
    expect(html).toContain("@media(max-width:700px)");
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
    // Overflow-safe node labels and the selection/details synchronization.
    expect(workflowGraphClientScript).toContain('"text-overflow-wrap"');
    expect(workflowGraphClientScript).toContain('"text-max-width"');
    expect(workflowGraphClientScript).toContain("selectStage");
    expect(workflowGraphClientScript).toContain("renderDetails");
    expect(workflowGraphClientScript).toContain("syncStageButtons");
    expect(workflowGraphClientScript).toContain('"aria-pressed"');
    expect(workflowGraphClientScript).toContain("workflow_stage_selected");
    expect(workflowGraphClientScript).toContain(
      "workflow_stage_details_rendered",
    );
    expect(workflowGraphClientScript).toContain(".stage-button[data-stage]");
    expect(workflowGraphClientScript).toContain("stage-details-status");
    // Validate and copy handlers moved here from the inline script.
    expect(workflowGraphClientScript).toContain('getElementById("validate")');
    expect(workflowGraphClientScript).toContain('getElementById("copy")');
    expect(workflowGraphClientScript).toContain("data-source-commit");
  });

  it("switches stage-button selection back and forth (A \u2192 B \u2192 A)", () => {
    // Minimal DOM + Cytoscape harness that preserves the real selection
    // semantics: selecting an already-selected node fires no select event.
    class FakeElement {
      attributes: Record<string, string> = {};
      children: FakeElement[] = [];
      listeners: Record<string, Array<() => void>> = {};
      textContent = "";
      get firstChild(): FakeElement | null {
        return this.children[0] ?? null;
      }
      appendChild(child: FakeElement) {
        this.children.push(child);
      }
      removeChild(child: FakeElement) {
        this.children = this.children.filter((item) => item !== child);
      }
      setAttribute(name: string, value: string) {
        this.attributes[name] = String(value);
      }
      getAttribute(name: string) {
        return this.attributes[name] ?? null;
      }
      addEventListener(type: string, handler: () => void) {
        (this.listeners[type] ??= []).push(handler);
      }
      click() {
        for (const handler of this.listeners["click"] ?? []) handler();
      }
    }

    type FakeNode = ReturnType<typeof makeNode>;
    function collection(items: FakeNode[]): any {
      return {
        items,
        addClass(names: string) {
          items.forEach((item) => item.addClass(names));
          return collection(items);
        },
        removeClass(names: string) {
          items.forEach((item) => item.removeClass(names));
          return collection(items);
        },
        unselect() {
          items.forEach((item) => item.unselect());
        },
        difference(other: any) {
          const excluded: FakeNode[] = other.items ?? [other];
          return collection(items.filter((item) => !excluded.includes(item)));
        },
      };
    }
    const selectHandlers: Array<(event: { target: FakeNode }) => void> = [];
    function makeNode(id: string) {
      const node = {
        selectedState: false,
        classes: new Set<string>(),
        id: () => id,
        data: () => ({ id, name: id, summary: `summary ${id}` }),
        nonempty: () => true,
        selected: () => node.selectedState,
        select: () => {
          // Real Cytoscape does not re-emit select for a selected node.
          if (node.selectedState) return;
          node.selectedState = true;
          selectHandlers.forEach((handler) => handler({ target: node }));
        },
        unselect: () => {
          node.selectedState = false;
        },
        addClass: (names: string) => {
          names.split(" ").forEach((name) => node.classes.add(name));
        },
        removeClass: (names: string) => {
          names.split(" ").forEach((name) => node.classes.delete(name));
        },
        hasClass: (name: string) => node.classes.has(name),
        connectedEdges: () => collection([]),
        closedNeighborhood: () => collection([node as FakeNode]),
      };
      return node;
    }
    const nodes = [makeNode("alpha"), makeNode("beta")];
    const cy = {
      on: (event: string, _selector: unknown, handler?: unknown) => {
        if (event === "select") {
          selectHandlers.push(
            (handler ?? _selector) as (event: { target: FakeNode }) => void,
          );
        }
      },
      elements: () => collection(nodes),
      $: () => collection(nodes.filter((node) => node.selected())),
      getElementById: (id: string) =>
        nodes.find((node) => node.id() === id) ?? { nonempty: () => false },
      nodes: () => ({ length: nodes.length }),
      edges: () => ({ length: 0 }),
    };

    const container = new FakeElement();
    const dataElement = new FakeElement();
    dataElement.textContent = JSON.stringify([
      { group: "nodes", data: { id: "alpha" } },
      { group: "nodes", data: { id: "beta" } },
    ]);
    const status = new FakeElement();
    const list = new FakeElement();
    const buttons = ["alpha", "beta"].map((id) => {
      const button = new FakeElement();
      button.setAttribute("data-stage", id);
      return button;
    });
    const byId: Record<string, FakeElement> = {
      "workflow-graph": container,
      "workflow-graph-data": dataElement,
      "stage-details-status": status,
      "stage-details-list": list,
    };
    const document = {
      getElementById: (id: string) => byId[id] ?? null,
      querySelectorAll: (selector: string) =>
        selector === ".stage-button[data-stage]" ? buttons : [],
      createElement: () => new FakeElement(),
    };
    const window = { cytoscape: () => cy };

    new Function("window", "document", workflowGraphClientScript)(
      window,
      document,
    );

    const [buttonA, buttonB] = buttons;
    const [nodeA, nodeB] = nodes;
    const selectedStage = () =>
      status.textContent.match(/Selected stage: (\w+)/)?.[1] ?? null;

    buttonA!.click();
    expect(selectedStage()).toBe("alpha");
    expect(buttonA!.getAttribute("aria-pressed")).toBe("true");

    buttonB!.click();
    expect(selectedStage()).toBe("beta");
    expect(nodeA!.selected()).toBe(false);
    expect(nodeB!.selected()).toBe(true);
    expect(buttonA!.getAttribute("aria-pressed")).toBe("false");
    expect(buttonB!.getAttribute("aria-pressed")).toBe("true");

    // Regression: switching back to the first stage must update details and
    // emphasis even though Cytoscape may still consider nodes selected.
    buttonA!.click();
    expect(selectedStage()).toBe("alpha");
    expect(nodeA!.selected()).toBe(true);
    expect(nodeB!.selected()).toBe(false);
    expect(buttonA!.getAttribute("aria-pressed")).toBe("true");
    expect(buttonB!.getAttribute("aria-pressed")).toBe("false");
  });
});
