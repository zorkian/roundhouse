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

function workflowEditUrl(run: RunSnapshot): string {
  const branch = encodeURIComponent(run.githubDefaultBranch ?? "main");
  return `https://github.com/${run.repository}/edit/${branch}/.roundhouse/workflow.yaml`;
}

function graphSvg(workflow: CompiledWorkflow): string {
  const entries = Object.entries(workflow.nodes);
  const positions = new Map(
    entries.map(([id], index) => [
      id,
      {
        x: 30 + (index % 3) * 310,
        y: 40 + Math.floor(index / 3) * 155,
      },
    ]),
  );
  const edges = entries.flatMap(([from, node]) =>
    node.transitions.flatMap((transition) => {
      if (!transition.to) return [];
      const start = positions.get(from)!;
      const end = positions.get(transition.to)!;
      return [
        `<line x1="${start.x + 120}" y1="${start.y + 45}" x2="${end.x + 120}" y2="${end.y + 45}" marker-end="url(#arrow)"><title>${escapeHtml(from)} → ${escapeHtml(transition.to)}</title></line>`,
      ];
    }),
  );
  const nodes = entries.map(([id, node]) => {
    const position = positions.get(id)!;
    return `<g transform="translate(${position.x} ${position.y})"><rect width="240" height="90" rx="10"/><text x="14" y="26" class="node-id">${escapeHtml(id)}</text><text x="14" y="50">${escapeHtml(node.executor)}</text><text x="14" y="72" class="authority">${escapeHtml(node.capabilities.join(", ") || "no external authority")}</text></g>`;
  });
  const height = 70 + Math.ceil(entries.length / 3) * 155;
  return `<svg viewBox="0 0 960 ${height}" role="img" aria-label="Workflow graph"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"/></marker></defs>${edges.join("")}${nodes.join("")}</svg>`;
}

export function renderWorkflowView(run: RunSnapshot): string {
  const workflow = run.profile?.workflow;
  if (!workflow) throw new Error("workflow_snapshot_missing");
  const source = serializeWorkflow(workflow);
  const routes = Object.entries(workflow.nodes)
    .flatMap(([id, node]) =>
      node.transitions.map(
        (transition) =>
          `<tr><td><code>${escapeHtml(id)}</code></td><td>${escapeHtml(transition.when ? JSON.stringify(transition.when) : "fallback")}</td><td><code>${escapeHtml(transition.to ?? transition.wait ?? transition.terminal)}</code></td></tr>`,
      ),
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(run.repository)} workflow</title><style>
*{box-sizing:border-box}body{font:15px/1.5 system-ui,sans-serif;color:#18212f;max-width:1180px;margin:0 auto;padding:1.5rem}a{color:#175cd3}header{display:flex;justify-content:space-between;gap:1rem;align-items:start;flex-wrap:wrap}h1{margin:.2rem 0}p{color:#5f6b7a}.meta{display:grid;grid-template-columns:10rem 1fr;gap:.35rem 1rem}.meta dt{font-weight:700}.meta dd{margin:0;overflow-wrap:anywhere}svg{width:100%;height:auto;background:#f6f8fa;border:1px solid #d8dee6;border-radius:12px;margin:1rem 0}svg line{stroke:#8391a5;stroke-width:2}svg rect{fill:white;stroke:#8391a5}.node-id{font-weight:700;font-size:16px}.authority{font-size:10px;fill:#5f6b7a}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ddd;padding:.5rem}textarea{font:13px/1.45 ui-monospace,monospace;width:100%;min-height:32rem;padding:1rem;border:1px solid #aab4c2;border-radius:8px}.actions{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;margin:.75rem 0}button,.button{border:0;border-radius:7px;padding:.6rem .9rem;background:#18212f;color:white;text-decoration:none;cursor:pointer}.secondary{background:#e8edf3;color:#18212f}#validation.ok{color:#087443}#validation.error{color:#b42318}@media(max-width:700px){body{padding:.8rem}.meta{grid-template-columns:1fr}table{display:block;overflow-x:auto}}
</style></head><body><p><a href="/">← Dashboard</a></p><header><div><p>Repository workflow</p><h1>${escapeHtml(run.repository)}</h1></div><a class="button" href="${escapeHtml(workflowEditUrl(run))}" target="_blank" rel="noreferrer">Edit and propose on GitHub</a></header>
<dl class="meta"><dt>Workflow hash</dt><dd><code>${escapeHtml(workflow.hash)}</code></dd><dt>Source commit</dt><dd><code>${escapeHtml(workflow.sourceCommit)}</code></dd><dt>Snapshot run</dt><dd>${escapeHtml(run.id)} revision ${run.revision}</dd></dl>
<p>This is the immutable workflow snapshot attached to the repository’s latest run. Editing below changes only your browser. Validate it here, then copy the YAML into GitHub’s editor and create a branch and pull request. Existing runs keep their original snapshot.</p>
<h2>Graph and authority</h2>${graphSvg(workflow)}
<h2>Routes</h2><table><thead><tr><th>From</th><th>Condition</th><th>Destination</th></tr></thead><tbody>${routes}</tbody></table>
<h2>Workflow editor</h2><textarea id="source" spellcheck="false">${escapeHtml(source)}</textarea><div class="actions"><button id="validate" type="button">Validate workflow</button><button id="copy" class="secondary" type="button">Copy YAML</button><a href="${escapeHtml(workflowEditUrl(run))}" target="_blank" rel="noreferrer">Open GitHub editor</a><span id="validation" aria-live="polite"></span></div>
<script>const source=document.querySelector("#source");document.querySelector("#validate").addEventListener("click",async()=>{const output=document.querySelector("#validation");output.className="";output.textContent="Validating…";try{const response=await fetch(location.pathname,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({source:source.value,sourceCommit:${JSON.stringify(workflow.sourceCommit)}})});const result=await response.json();output.className=response.ok?"ok":"error";output.textContent=response.ok?\`Valid — \${result.nodes} nodes, hash \${result.hash}\`:\`Invalid — \${result.error}\`;}catch{output.className="error";output.textContent="Validation request failed.";}});document.querySelector("#copy").addEventListener("click",async()=>{await navigator.clipboard.writeText(source.value);document.querySelector("#validation").textContent="Copied. Paste this into the GitHub editor.";});</script>
</body></html>`;
}
