// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  compileWorkflow,
  defaultIssueWorkflowSource,
  type RunSnapshot,
} from "@roundhouse/core";
import { describe, expect, it } from "vitest";
import {
  renderWorkflowView,
  workflowEntryStage,
  workflowGraphElements,
} from "./workflow-view.js";
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
  it("preselects the workflow entry rather than the run's current node", async () => {
    const run = await runFixture();
    const html = renderWorkflowView(run);
    expect(html).toContain('id="workflow-graph" data-select="qualify"');
    expect(html).not.toContain('data-select="implement"');
    expect(
      renderWorkflowView({ ...run, currentNodeId: 'missing"><script>' }),
    ).toContain('data-select="qualify"');
  });

  it("emits the trigger-derived entry stage as graph metadata", async () => {
    const run = await runFixture();
    const workflow = run.profile!.workflow!;
    expect(workflowEntryStage(workflow)).toBe("qualify");
    const html = renderWorkflowView(run);
    expect(html).toContain(
      'id="workflow-graph" data-select="qualify" data-entry="qualify"',
    );
    // A trigger pointing at a missing node emits no entry metadata.
    const broken = {
      ...workflow,
      triggers: { "github.issue.started": 'missing"><script>' },
    };
    expect(workflowEntryStage(broken)).toBeNull();
    const rendered = renderWorkflowView({
      ...run,
      profile: { ...run.profile!, workflow: broken },
    });
    expect(rendered).not.toContain("data-entry");
    expect(rendered).not.toContain("data-select");
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
    // Entry-rooted hierarchical layout with directed arrows.
    expect(workflowGraphClientScript).toContain('"breadthfirst"');
    expect(workflowGraphClientScript).toContain('direction: "downward"');
    expect(workflowGraphClientScript).toContain("avoidOverlap: true");
    expect(workflowGraphClientScript).not.toContain('name: "cose"');
    expect(workflowGraphClientScript).toContain('"target-arrow-shape"');
    // Selecting a node emphasizes it and its connected edges, mutes the
    // rest, and tapping the background clears the state.
    expect(workflowGraphClientScript).toContain('"select", "node"');
    expect(workflowGraphClientScript).toContain("connectedEdges()");
    expect(workflowGraphClientScript).toContain(
      '"selected-node connected-edge muted"',
    );
    expect(workflowGraphClientScript).toContain("event.target === cy");
    // One-time post-layout viewport framing with the entry stage.
    expect(workflowGraphClientScript).toContain('getAttribute("data-entry")');
    expect(workflowGraphClientScript).toContain("renderedBoundingBox");
    expect(workflowGraphClientScript).toContain(
      "workflow_graph_viewport_initialized",
    );
    expect(workflowGraphClientScript).toContain(
      "workflow_graph_layout_started",
    );
    expect(workflowGraphClientScript).toContain('name: "preset"');
    expect(workflowGraphClientScript).toContain("cy.layout(graphLayout).run()");
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

  it("runs layout after handlers and frames the viewport on the entry", () => {
    class FakeElement {
      attributes: Record<string, string> = {};
      listeners: Record<string, Array<() => void>> = {};
      textContent = "";
      clientWidth = 1186;
      clientHeight = 560;
      setAttribute(name: string, value: string) {
        this.attributes[name] = String(value);
      }
      getAttribute(name: string) {
        return this.attributes[name] ?? null;
      }
      addEventListener(type: string, handler: () => void) {
        (this.listeners[type] ??= []).push(handler);
      }
    }
    function harness(options: {
      width: number;
      initialZoom: number;
      entryBounds: { x1: number; y1: number; x2: number; y2: number };
      entryId?: string;
      preselect?: string;
    }) {
      const logs: Record<string, unknown>[] = [];
      const layoutstopHandlers: Array<() => void> = [];
      const centered: string[] = [];
      const state = {
        zoom: options.initialZoom,
        layoutRuns: 0,
        constructorLayout: "",
        explicitLayout: "",
        explicitDirection: "",
        rootApplied: false,
        pan: { x: 0, y: 0 },
      };
      const entryPosition = { x: 100, y: 400 };
      const entryNode = {
        nonempty: () => true,
        position: (axis?: "x" | "y") =>
          axis ? entryPosition[axis] : entryPosition,
        outerHeight: () => 110,
        boundingBox: () => ({
          x1: entryPosition.x - 120,
          y1: entryPosition.y - 55,
          x2: entryPosition.x + 120,
          y2: entryPosition.y + 55,
        }),
        renderedBoundingBox: () => {
          if (state.pan.x === 0 && state.pan.y === 0)
            return options.entryBounds;
          const width = 240 * state.zoom;
          const height = 110 * state.zoom;
          const x1 = entryPosition.x * state.zoom + state.pan.x - width / 2;
          const y1 = entryPosition.y * state.zoom + state.pan.y - height / 2;
          return { x1, y1, x2: x1 + width, y2: y1 + height };
        },
        select: () => {},
      };
      const cy = {
        on: (event: string, _selector: unknown, handler?: unknown) => {
          if (event === "layoutstop") {
            layoutstopHandlers.push((handler ?? _selector) as () => void);
          }
        },
        off: (event: string, handler: () => void) => {
          const index = layoutstopHandlers.indexOf(handler);
          if (index >= 0) layoutstopHandlers.splice(index, 1);
        },
        zoom: (level?: number) => {
          if (level !== undefined) state.zoom = level;
          return state.zoom;
        },
        pan: (position: { x: number; y: number }) => {
          state.pan = position;
          centered.push("entry");
        },
        layout: (layout: {
          name: string;
          direction?: string;
          roots?: unknown;
        }) => ({
          run: () => {
            state.layoutRuns += 1;
            state.explicitLayout = layout.name;
            state.explicitDirection = layout.direction ?? "";
            state.rootApplied = layout.roots === entryNode;
            for (const handler of [...layoutstopHandlers]) handler();
          },
        }),
        nodes: () => [entryNode],
        edges: () => ({ length: 2 }),
        getElementById: (id: string) =>
          id === options.entryId || id === options.preselect
            ? entryNode
            : { nonempty: () => false },
        elements: () => ({ removeClass: () => {} }),
        $: () => ({ difference: () => ({ unselect: () => {} }) }),
      };
      const container = new FakeElement();
      container.clientWidth = options.width;
      if (options.entryId)
        container.setAttribute("data-entry", options.entryId);
      if (options.preselect)
        container.setAttribute("data-select", options.preselect);
      const dataElement = new FakeElement();
      dataElement.textContent = JSON.stringify([
        { group: "nodes", data: { id: "qualify" } },
      ]);
      const byId: Record<string, FakeElement> = {
        "workflow-graph": container,
        "workflow-graph-data": dataElement,
      };
      const document = {
        getElementById: (id: string) => byId[id] ?? null,
        querySelectorAll: () => [],
        createElement: () => new FakeElement(),
      };
      const window = {
        cytoscape: (configuration: { layout: { name: string } }) => {
          state.constructorLayout = configuration.layout.name;
          return cy;
        },
      };
      const originalLog = console.log;
      console.log = (line: string) => logs.push(JSON.parse(line));
      try {
        new Function("window", "document", workflowGraphClientScript)(
          window,
          document,
        );
        // A second layoutstop must not re-frame: the handler runs once.
        for (const handler of [...layoutstopHandlers]) handler();
      } finally {
        console.log = originalLog;
      }
      const viewportLog = logs.find(
        (entry) => entry.message === "workflow_graph_viewport_initialized",
      );
      return { state, centered, viewportLog, logs };
    }

    // Desktop: handlers are attached before the explicit hierarchical run,
    // then the entry is placed at the top even if it was previously visible.
    const desktop = harness({
      width: 1186,
      initialZoom: 0.4,
      entryId: "qualify",
      preselect: "qualify",
      entryBounds: { x1: 100, y1: 100, x2: 400, y2: 240 },
    });
    expect(desktop.state.constructorLayout).toBe("preset");
    expect(desktop.state.explicitLayout).toBe("breadthfirst");
    expect(desktop.state.explicitDirection).toBe("downward");
    expect(desktop.state.rootApplied).toBe(true);
    expect(desktop.state.layoutRuns).toBe(1);
    expect(desktop.state.zoom).toBe(1);
    expect(desktop.centered).toEqual(["entry"]);
    expect(desktop.state.pan).toEqual({ x: 493, y: -313 });
    expect(desktop.viewportLog).toMatchObject({
      entryStage: "qualify",
      entryFound: true,
      mobile: false,
      initialZoom: 0.4,
      zoom: 1,
      entryVisible: true,
      entryTop: 32,
      entryTopPadding: 32,
    });
    expect(
      desktop.logs.find(
        (entry) => entry.message === "workflow_graph_layout_completed",
      ),
    ).toMatchObject({
      layout: "breadthfirst",
      direction: "downward",
      rootStage: "qualify",
      rootApplied: true,
      overlappingNodePairs: 0,
      entryTopmost: true,
    });
    expect(
      desktop.logs.filter(
        (entry) => entry.message === "workflow_graph_viewport_initialized",
      ),
    ).toHaveLength(1);

    // Mobile: a slightly smaller readable scale still centers the entry.
    const mobile = harness({
      width: 390,
      initialZoom: 0.3,
      entryId: "qualify",
      entryBounds: { x1: -500, y1: 60, x2: -200, y2: 200 },
    });
    expect(mobile.state.zoom).toBe(0.85);
    expect(mobile.centered).toEqual(["entry"]);
    expect(mobile.viewportLog).toMatchObject({
      entryStage: "qualify",
      entryFound: true,
      mobile: true,
      initialZoom: 0.3,
      zoom: 0.85,
      entryVisible: true,
    });

    // Entry-stage preselection runs alongside the framing.
    const both = harness({
      width: 1186,
      initialZoom: 0.5,
      entryId: "qualify",
      preselect: "qualify",
      entryBounds: { x1: 0, y1: 0, x2: 240, y2: 110 },
    });
    expect(both.viewportLog).toMatchObject({ entryStage: "qualify", zoom: 1 });
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
      layout: () => ({ run: () => {} }),
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
