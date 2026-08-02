// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  serializeWorkflow,
  type CompiledWorkflow,
  type RunSnapshot,
  type WorkflowNode,
  type WorkflowTransition,
} from "@roundhouse/core";

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// JSON embedded in a <script type="application/json"> tag must not be able
// to terminate the tag, so escape every `<`.
function escapeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function workflowEditUrl(run: RunSnapshot): string {
  const branch = encodeURIComponent(run.githubDefaultBranch ?? "main");
  return `https://github.com/${run.repository}/edit/${branch}/.roundhouse/workflow.yaml`;
}

export interface WorkflowGraphElement {
  readonly group: "nodes" | "edges";
  readonly data: Readonly<Record<string, string>>;
}

export interface WorkflowViewOptions {
  readonly source?: "snapshot" | "default_branch";
  readonly notice?: string;
}

// Bound names used by graph nodes and stage buttons. The graph itself renders
// the name on one ellipsized line; complete role and purpose text remains in
// the stage-details panel.
function truncateLabel(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// Human-readable stage name: prefer the authored role, fall back to the ID.
export function workflowNodeName(id: string, node: WorkflowNode): string {
  return truncateLabel(node.role ?? id, 48);
}

// One-sentence purpose derived from existing executor configuration.
export function workflowNodeSummary(node: WorkflowNode): string {
  if (node.agent) {
    if (node.agent.task === "qualification")
      return "Classifies the issue and identifies any needed clarification.";
    if (node.agent.task === "investigation")
      return "Investigates the current behavior and gathers evidence.";
    if (node.agent.task === "planning")
      return "Creates an implementation plan from the issue and evidence.";
    if (node.agent.task === "implementation")
      return "Implements and validates the planned change.";
  }
  if (node.review)
    return `Coordinates up to ${node.review.reviewers.length} configured reviewer${node.review.reviewers.length === 1 ? "" : "s"}.`;
  if (node.human)
    return `Waits for ${humanizeWorkflowValue(node.human.reason)} from ${
      node.human.audience === "operator" ? "an operator" : "a participant"
    }.`;
  if (node.external)
    return `Waits for ${humanizeWorkflowValue(node.external.event)} from ${node.external.adapter}.`;
  if (node.executor === "validate" && node.role === "integrate")
    return "Integrates the reviewed change with the latest target branch.";
  if (node.executor === "validate")
    return "Validates the candidate before continuing.";
  if (node.executor === "github.publish")
    return "Publishes the validated candidate to GitHub.";
  if (node.executor === "github.checks")
    return "Waits for GitHub checks on the integrated commit.";
  if (node.executor === "github.merge")
    return "Merges the pull request after checks pass, or waits for a maintainer.";
  if (node.executor === "fanout") return "Starts the configured parallel work.";
  if (node.executor === "join")
    return "Collects the configured parallel results.";
  if (node.executor === "terminal") return "Terminal stage of the workflow.";
  return "Runs this stage of the workflow.";
}

function humanizeWorkflowValue(value: unknown): string {
  return String(value)
    .replaceAll("_", " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

function workflowTransitionOutcome(transition: WorkflowTransition): string {
  const condition = transition.when;
  if (!condition) return "otherwise";
  if ("equals" in condition)
    return truncateLabel(humanizeWorkflowValue(condition.equals), 36);
  if ("in" in condition)
    return truncateLabel(
      condition.in.map(humanizeWorkflowValue).join(" / "),
      36,
    );
  if ("exists" in condition)
    return truncateLabel(
      humanizeWorkflowValue(
        condition.exists.split(".").at(-1) ?? condition.exists,
      ),
      36,
    );
  if ("all" in condition) return "all conditions met";
  if ("any" in condition) return "any condition met";
  if ("not" in condition) return "condition not met";
  return "threshold met";
}

// Match the directed breadth-first layout's notion of progress so routes back
// to an already-reached stage can be drawn outside the main downward column.
function workflowNodeDepths(
  workflow: CompiledWorkflow,
): ReadonlyMap<string, number> {
  const depths = new Map<string, number>();
  const entry = workflowEntryStage(workflow);
  if (!entry) return depths;
  depths.set(entry, 0);
  const pending = [entry];
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const source = pending[cursor]!;
    const nextDepth = depths.get(source)! + 1;
    for (const transition of workflow.nodes[source]!.transitions) {
      if (
        !transition.to ||
        !workflow.nodes[transition.to] ||
        depths.has(transition.to)
      )
        continue;
      depths.set(transition.to, nextDepth);
      pending.push(transition.to);
    }
  }
  return depths;
}

// Serializable Cytoscape elements: one node per workflow node and one
// directed edge per transition with a destination, with stable IDs for
// parallel edges and self-cycles. Each node carries a compact name plus
// summary and detail fields the client renders in the stage-details panel.
export function workflowGraphElements(
  workflow: CompiledWorkflow,
): WorkflowGraphElement[] {
  const nodes = Object.entries(workflow.nodes).map(([id, node]) => {
    const name = workflowNodeName(id, node);
    const summary = workflowNodeSummary(node);
    return {
      group: "nodes" as const,
      data: {
        id,
        name,
        summary,
        executor: node.executor,
        role: node.role ?? "",
        task: node.agent?.task ?? "",
        authority: node.capabilities.join(", ") || "no external authority",
        outputs: node.outputs.join(", ") || "none",
        reviewers: node.review
          ? node.review.reviewers
              .map((reviewer) => reviewer.label ?? reviewer.id)
              .join(", ")
          : "",
        human: node.human ? `${node.human.audience}: ${node.human.reason}` : "",
        external: node.external
          ? `${node.external.adapter} event ${node.external.event}`
          : "",
      },
    };
  });
  const depths = workflowNodeDepths(workflow);
  const authoredOrder = new Map(
    Object.keys(workflow.nodes).map((id, index) => [id, index]),
  );
  let returnRouteCount = 0;
  const edges: WorkflowGraphElement[] = [];
  for (const [from, node] of Object.entries(workflow.nodes)) {
    for (const [index, transition] of node.transitions.entries()) {
      const target = transition.to;
      if (!target) continue;
      const sourceDepth = depths.get(from) ?? authoredOrder.get(from)!;
      const targetDepth = depths.get(target) ?? authoredOrder.get(target)!;
      const route =
        from === target
          ? "self"
          : targetDepth <= sourceDepth
            ? "return"
            : "forward";
      const data: Record<string, string> = {
        id: `${from}->${target}#${index}`,
        source: from,
        target,
        route,
        outcome: workflowTransitionOutcome(transition),
        label: `${from} → ${target}`,
      };
      if (route === "return") {
        const lane = Math.floor(returnRouteCount / 2) + 1;
        const left = returnRouteCount % 2 === 0;
        data["returnSide"] = left ? "left" : "right";
        data["returnLane"] = String(lane);
        data["returnBend"] = String((left ? -1 : 1) * (300 + (lane - 1) * 90));
        returnRouteCount += 1;
      }
      edges.push({ group: "edges", data });
    }
  }
  return [...nodes, ...edges];
}

// Entry stage of the workflow, derived from the trigger configuration. The
// client uses it to frame the initial graph viewport on the workflow start.
export function workflowEntryStage(workflow: CompiledWorkflow): string | null {
  const entry = Object.values(workflow.triggers)[0];
  return entry && workflow.nodes[entry] ? entry : null;
}

export function renderWorkflowView(
  run: RunSnapshot,
  options: WorkflowViewOptions = {},
): string {
  const workflow = run.profile?.workflow;
  if (!workflow) throw new Error("workflow_snapshot_missing");
  const source = options.source ?? "snapshot";
  const entryStage = workflowEntryStage(workflow);
  const serializedWorkflow = serializeWorkflow(workflow);
  const graphData = escapeJsonForHtml(workflowGraphElements(workflow));
  const stageButtons = Object.entries(workflow.nodes)
    .map(
      ([id, node]) =>
        `<button type="button" class="stage-button" data-stage="${escapeHtml(id)}" aria-pressed="false">${escapeHtml(workflowNodeName(id, node))}</button>`,
    )
    .join("");
  const routes = Object.entries(workflow.nodes)
    .flatMap(([id, node]) =>
      node.transitions.map(
        (transition) =>
          `<tr><td><code>${escapeHtml(id)}</code></td><td>${escapeHtml(transition.when ? JSON.stringify(transition.when) : "fallback")}</td><td><code>${escapeHtml(transition.to ?? transition.wait ?? transition.terminal)}</code></td></tr>`,
      ),
    )
    .join("");
  const notice = options.notice
    ? `<div class="notice" role="status">${escapeHtml(options.notice)}</div>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(run.repository)} workflow</title><style>
*{box-sizing:border-box}body{font:15px/1.5 system-ui,sans-serif;color:#18212f;max-width:1180px;margin:0 auto;padding:1.5rem}a{color:#175cd3}header{display:flex;justify-content:space-between;gap:1rem;align-items:start;flex-wrap:wrap}h1{margin:.2rem 0}p{color:#5f6b7a}.notice{background:#fff4d6;border:1px solid #f3d27c;border-radius:8px;padding:.8rem;margin:1rem 0;color:#8a5b00}.meta{display:grid;grid-template-columns:10rem 1fr;gap:.35rem 1rem}.meta dt{font-weight:700}.meta dd{margin:0;overflow-wrap:anywhere}#workflow-layout{display:flex;gap:1rem;align-items:flex-start;flex-wrap:wrap}#workflow-graph{flex:3 1 480px;width:100%;height:560px;background:#f6f8fa;border:1px solid #d8dee6;border-radius:12px;margin:1rem 0}#workflow-stages{display:flex;flex-wrap:wrap;gap:.4rem;margin:.5rem 0}.stage-button{background:#e8edf3;color:#18212f}.stage-button[aria-pressed="true"]{background:#175cd3;color:#fff}#workflow-legend{display:flex;flex-wrap:wrap;gap:.5rem 1rem;color:#5f6b7a;font-size:.85rem;margin:.65rem 0 0}#workflow-legend span{display:inline-flex;align-items:center;gap:.4rem}#workflow-legend i{display:inline-block;width:2rem;border-top:2px solid #8391a5}#workflow-legend .return{border-color:#b54708;border-top-style:dashed}#workflow-legend .retry{border-color:#7f56d9;border-top-style:dotted}#stage-details{flex:2 1 260px;border:1px solid #d8dee6;border-radius:12px;padding:1rem;margin:1rem 0;background:#fbfcfe}#stage-details h3{margin:.2rem 0 .5rem}#stage-details-list{display:grid;grid-template-columns:8rem 1fr;gap:.35rem .75rem;margin:0}#stage-details-list dt{font-weight:700}#stage-details-list dd{margin:0;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ddd;padding:.5rem}textarea{font:13px/1.45 ui-monospace,monospace;width:100%;min-height:32rem;padding:1rem;border:1px solid #aab4c2;border-radius:8px}.actions{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;margin:.75rem 0}button,.button{border:0;border-radius:7px;padding:.6rem .9rem;background:#18212f;color:white;text-decoration:none;cursor:pointer}.secondary{background:#e8edf3;color:#18212f}#validation.ok{color:#087443}#validation.error{color:#b42318}@media(max-width:700px){body{padding:.8rem}.meta{grid-template-columns:1fr}table{display:block;overflow-x:auto}#workflow-graph{height:420px}}
</style></head><body><p><a href="/">← Dashboard</a></p><header><div><p>Repository workflow</p><h1>${escapeHtml(run.repository)}</h1></div><a class="button" href="${escapeHtml(workflowEditUrl(run))}" target="_blank" rel="noreferrer">Edit and propose on GitHub</a></header>${notice}
<dl class="meta"><dt>Workflow hash</dt><dd><code>${escapeHtml(workflow.hash)}</code></dd><dt>Source commit</dt><dd><code>${escapeHtml(workflow.sourceCommit)}</code></dd>${source === "default_branch" ? `<dt>Default branch</dt><dd><code>${escapeHtml(run.githubDefaultBranch ?? "main")}</code></dd>` : `<dt>Snapshot run</dt><dd>${escapeHtml(run.id)} revision ${run.revision}</dd>`}</dl>
<p>${source === "default_branch" ? `This is the workflow currently on the repository’s <code>${escapeHtml(run.githubDefaultBranch ?? "main")}</code> branch. Existing runs keep their original immutable snapshot.` : "This is the immutable workflow snapshot attached to this run."} Editing below changes only your browser. Validate it here, then copy the YAML into GitHub’s editor and create a branch and pull request.</p>
<h2>Graph and authority</h2><div id="workflow-stages" role="group" aria-label="Workflow stages">${stageButtons}</div><div id="workflow-legend" aria-label="Workflow route legend"><span><i></i>Next stage</span><span><i class="return"></i>Return for more work</span><span><i class="retry"></i>Retry this stage</span></div><div id="workflow-layout"><div id="workflow-graph"${entryStage ? ` data-select="${escapeHtml(entryStage)}" data-entry="${escapeHtml(entryStage)}"` : ""} role="application" aria-label="Workflow graph. Drag nodes to rearrange them, scroll or pinch to zoom, and select a node to highlight its transitions and show its details."></div><section id="stage-details" aria-live="polite" aria-label="Stage details"><h3>Stage details</h3><p id="stage-details-status">Select a stage in the graph or the stage list to see its details.</p><dl id="stage-details-list"></dl></section></div><script id="workflow-graph-data" type="application/json">${graphData}</script><script src="/assets/workflow-graph.js" defer></script>
<h2>Routes</h2><table><thead><tr><th>From</th><th>Condition</th><th>Destination</th></tr></thead><tbody>${routes}</tbody></table>
<h2>Workflow editor</h2><textarea id="source" spellcheck="false" data-source-commit="${escapeHtml(workflow.sourceCommit)}">${escapeHtml(serializedWorkflow)}</textarea><div class="actions"><button id="validate" type="button">Validate workflow</button><button id="copy" class="secondary" type="button">Copy YAML</button><a href="${escapeHtml(workflowEditUrl(run))}" target="_blank" rel="noreferrer">Open GitHub editor</a><span id="validation" aria-live="polite"></span></div>
</body></html>`;
}
