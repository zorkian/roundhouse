// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  serializeWorkflow,
  type CompiledWorkflow,
  type RunSnapshot,
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

// Serializable Cytoscape elements: one node per workflow node and one
// directed edge per transition with a destination, with stable IDs for
// parallel edges and self-cycles.
export function workflowGraphElements(
  workflow: CompiledWorkflow,
): WorkflowGraphElement[] {
  const nodes = Object.entries(workflow.nodes).map(([id, node]) => {
    const authority = node.capabilities.join(", ") || "no external authority";
    return {
      group: "nodes" as const,
      data: {
        id,
        executor: node.executor,
        authority,
        label: `${id}\n${node.executor}\n${authority}`,
      },
    };
  });
  const edges = Object.entries(workflow.nodes).flatMap(([from, node]) =>
    node.transitions.flatMap((transition, index) =>
      transition.to
        ? [
            {
              group: "edges" as const,
              data: {
                id: `${from}->${transition.to}#${index}`,
                source: from,
                target: transition.to,
                label: `${from} → ${transition.to}`,
              },
            },
          ]
        : [],
    ),
  );
  return [...nodes, ...edges];
}

export function renderWorkflowView(run: RunSnapshot): string {
  const workflow = run.profile?.workflow;
  if (!workflow) throw new Error("workflow_snapshot_missing");
  const source = serializeWorkflow(workflow);
  const graphData = escapeJsonForHtml(workflowGraphElements(workflow));
  const routes = Object.entries(workflow.nodes)
    .flatMap(([id, node]) =>
      node.transitions.map(
        (transition) =>
          `<tr><td><code>${escapeHtml(id)}</code></td><td>${escapeHtml(transition.when ? JSON.stringify(transition.when) : "fallback")}</td><td><code>${escapeHtml(transition.to ?? transition.wait ?? transition.terminal)}</code></td></tr>`,
      ),
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(run.repository)} workflow</title><style>
*{box-sizing:border-box}body{font:15px/1.5 system-ui,sans-serif;color:#18212f;max-width:1180px;margin:0 auto;padding:1.5rem}a{color:#175cd3}header{display:flex;justify-content:space-between;gap:1rem;align-items:start;flex-wrap:wrap}h1{margin:.2rem 0}p{color:#5f6b7a}.meta{display:grid;grid-template-columns:10rem 1fr;gap:.35rem 1rem}.meta dt{font-weight:700}.meta dd{margin:0;overflow-wrap:anywhere}#workflow-graph{width:100%;height:560px;background:#f6f8fa;border:1px solid #d8dee6;border-radius:12px;margin:1rem 0}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ddd;padding:.5rem}textarea{font:13px/1.45 ui-monospace,monospace;width:100%;min-height:32rem;padding:1rem;border:1px solid #aab4c2;border-radius:8px}.actions{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;margin:.75rem 0}button,.button{border:0;border-radius:7px;padding:.6rem .9rem;background:#18212f;color:white;text-decoration:none;cursor:pointer}.secondary{background:#e8edf3;color:#18212f}#validation.ok{color:#087443}#validation.error{color:#b42318}@media(max-width:700px){body{padding:.8rem}.meta{grid-template-columns:1fr}table{display:block;overflow-x:auto}#workflow-graph{height:420px}}
</style></head><body><p><a href="/">← Dashboard</a></p><header><div><p>Repository workflow</p><h1>${escapeHtml(run.repository)}</h1></div><a class="button" href="${escapeHtml(workflowEditUrl(run))}" target="_blank" rel="noreferrer">Edit and propose on GitHub</a></header>
<dl class="meta"><dt>Workflow hash</dt><dd><code>${escapeHtml(workflow.hash)}</code></dd><dt>Source commit</dt><dd><code>${escapeHtml(workflow.sourceCommit)}</code></dd><dt>Snapshot run</dt><dd>${escapeHtml(run.id)} revision ${run.revision}</dd></dl>
<p>This is the immutable workflow snapshot attached to the repository’s latest run. Editing below changes only your browser. Validate it here, then copy the YAML into GitHub’s editor and create a branch and pull request. Existing runs keep their original snapshot.</p>
<h2>Graph and authority</h2><div id="workflow-graph" role="application" aria-label="Workflow graph. Drag nodes to rearrange them, scroll or pinch to zoom, and select a node to highlight its incoming and outgoing transitions."></div><script id="workflow-graph-data" type="application/json">${graphData}</script><script src="/assets/workflow-graph.js" defer></script>
<h2>Routes</h2><table><thead><tr><th>From</th><th>Condition</th><th>Destination</th></tr></thead><tbody>${routes}</tbody></table>
<h2>Workflow editor</h2><textarea id="source" spellcheck="false" data-source-commit="${escapeHtml(workflow.sourceCommit)}">${escapeHtml(source)}</textarea><div class="actions"><button id="validate" type="button">Validate workflow</button><button id="copy" class="secondary" type="button">Copy YAML</button><a href="${escapeHtml(workflowEditUrl(run))}" target="_blank" rel="noreferrer">Open GitHub editor</a><span id="validation" aria-live="polite"></span></div>
</body></html>`;
}
