// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ControlPlaneEnv } from "./environment.js";
import { inspectRun } from "./inspection.js";
import { listIssuePlans, readPlanById } from "./github-planning.js";
import { D1JobStore } from "@roundhouse/self-development/cloudflare";

function responseHeaders(nonce: string): HeadersInit {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": `default-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function responseNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes));
}

function shell(
  title: string,
  kind: "dashboard" | "plan" | "run",
  id?: string,
): Response {
  const serialized = JSON.stringify({ kind, id });
  const nonce = responseNonce();
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Roundhouse</title><style nonce="${nonce}">
:root{color-scheme:dark;--bg:#0c1117;--panel:#151d27;--line:#2b3949;--text:#e8eef5;--muted:#95a6b8;--accent:#62d3a4;--warn:#ffca6a;--bad:#ff7c82}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}main{max-width:1180px;margin:auto;padding:28px 20px}header{display:flex;align-items:baseline;gap:18px;margin-bottom:24px}h1{font-size:24px;margin:0}h2{font-size:16px;margin:0 0 12px}a{color:var(--accent)}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:16px}.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:16px}.row{display:flex;justify-content:space-between;gap:16px;border-top:1px solid var(--line);padding:8px 0}.row:first-child{border:0}.state{color:var(--accent)}.failed,.rejected,.cancelled{color:var(--bad)}.awaiting_approval,.proposed{color:var(--warn)}code{overflow-wrap:anywhere}button{background:var(--accent);color:#07130e;border:0;border-radius:5px;font:inherit;font-weight:700;padding:8px 12px;cursor:pointer;margin-right:8px}button.danger{background:var(--bad)}button:disabled{opacity:.45;cursor:not-allowed}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#090d12;padding:12px;border-radius:5px}.notice{min-height:24px;color:var(--warn)}
</style></head><body><main><header><h1>Roundhouse</h1><a href="/">Dashboard</a><span class="muted">live · refreshes every 5s</span></header><div id="app">Loading…</div></main>
<script nonce="${nonce}">const page=${serialized};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=(type,id)=>'<a href="/'+type+'/'+encodeURIComponent(id)+'">'+esc(id)+'</a>';
async function api(path,options){const r=await fetch(path,options);const v=await r.json();if(!r.ok)throw new Error(v.error?.message||'Request failed');return v}
function rows(values){return values.map(([k,v])=>'<div class="row"><span class="muted">'+esc(k)+'</span><span>'+v+'</span></div>').join('')}
function card(title,body){return '<section class="card"><h2>'+esc(title)+'</h2>'+body+'</section>'}
function renderDashboard(v){return '<div class="grid">'+card('Plans',v.plans.length?v.plans.map(p=>rows([['plan',link('plans',p.plan.planId)],['issue','#'+p.plan.issueNumber],['status','<span class="'+esc(p.status)+'">'+esc(p.status)+'</span>'],['created',esc(p.plan.createdAt)]])).join('<br>'):'<span class="muted">No plans yet</span>')+card('Runs',v.runs.length?v.runs.map(r=>rows([['run',link('runs',r.runId)],['subject',esc(r.subject||r.taskId)],['state','<span class="'+esc(r.state)+'">'+esc(r.state)+'</span>'],['revision',esc(r.revision)]])).join('<br>'):'<span class="muted">No runs yet</span>')+'</div>'}
function renderPlan(v){const p=v.plan.plan;const d=v.plan;const can=d.status==='proposed';return card('Immutable issue plan',rows([['plan',esc(p.planId)],['issue','#'+esc(p.issueNumber)],['status','<span class="'+esc(d.status)+'">'+esc(d.status)+'</span>'],['revision',esc(d.revision)],['base','<code>'+esc(p.baseCommit)+'</code>'],['SHA-256','<code>'+esc(p.planSha256)+'</code>'],['evidence','<code>'+esc(d.evidence.objectKey)+'</code>'],['evidence SHA-256','<code>'+esc(d.evidence.sha256)+'</code>'],['approved by',esc(d.approvedBy||'—')],['run',d.runId?link('runs',d.runId):'—']]))+card('Exact scope','<pre>'+esc(p.status==='proposed'?p.exactPaths.join('\\n'):p.findings.map(x=>x.code+': '+x.message).join('\\n'))+'</pre>')+(can?card('Action','<button id="approve-plan">Approve exact plan and start</button><div class="notice" id="notice"></div>'):'')}
function renderRun(r){const attempts=r.attempts||[];const evidence=r.evidence||[];const actions=(r.state==='failed'?'<button id="retry-run">Retry exact revision</button>':'')+(!['completed','cancelled','failed'].includes(r.state)?'<button class="danger" id="cancel-run">Cancel exact revision</button>':'');return card('Run',rows([['run',esc(r.runId)],['task',esc(r.subject||r.taskId)],['state','<span class="'+esc(r.state)+'">'+esc(r.state)+'</span>'],['revision',esc(r.revision)],['base','<code>'+esc(r.baseCommit||r.approval?.baseCommit||'—')+'</code>'],['plan',r.planning?link('plans',r.planning.planId):'—'],['patch','<code>'+esc(r.implementation?.patchSha256||'—')+'</code>'],['publication',r.publication?.pullRequestUrl?'<a href="'+esc(r.publication.pullRequestUrl)+'">pull request</a>':'—']]))+card('Attempts',attempts.length?attempts.map(a=>rows([['stage',esc(a.stage)],['number',esc(a.number)],['status','<span class="'+esc(a.status)+'">'+esc(a.status)+'</span>'],['classification',esc(a.classification||'—')],['started',esc(a.startedAt||'—')],['completed',esc(a.completedAt||'—')]])).join('<br>'):'<span class="muted">No attempts yet</span>')+card('Evidence',evidence.length?evidence.map(e=>rows([['object','<code>'+esc(e.objectKey)+'</code>'],['SHA-256','<code>'+esc(e.sha256)+'</code>'],['bytes',esc(e.size)]])).join('<br>'):'<span class="muted">No evidence yet</span>')+(actions?card('Actions',actions+'<div class="notice" id="notice"></div>'):'')}
function bindActions(){document.getElementById('approve-plan')?.addEventListener('click',approvePlan);document.getElementById('retry-run')?.addEventListener('click',()=>runAction('retry'));document.getElementById('cancel-run')?.addEventListener('click',()=>runAction('cancel'))}
let current;async function load(){try{current=await api(page.kind==='dashboard'?'/v1/dashboard':page.kind==='plan'?'/v1/plans/'+encodeURIComponent(page.id):'/v1/runs/'+encodeURIComponent(page.id));document.getElementById('app').innerHTML=page.kind==='dashboard'?renderDashboard(current):page.kind==='plan'?renderPlan(current):renderRun(current);bindActions()}catch(e){document.getElementById('app').innerHTML=card('Error',esc(e.message))}}
async function approvePlan(){try{const p=current.plan;await api('/v1/plans/'+encodeURIComponent(p.plan.planId)+'/approve',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'ui-plan-'+p.plan.planId+'-'+p.revision},body:JSON.stringify({schemaVersion:1,expectedRevision:p.revision,planSha256:p.plan.planSha256})});await load()}catch(e){document.getElementById('notice').textContent=e.message}}
async function runAction(action){try{await api('/v1/runs/'+encodeURIComponent(current.runId)+'/'+action,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'ui-'+action+'-'+current.runId+'-'+current.revision},body:JSON.stringify({schemaVersion:1,expectedRevision:current.revision})});await load()}catch(e){document.getElementById('notice').textContent=e.message}}
load();setInterval(load,5000);</script></body></html>`,
    { headers: responseHeaders(nonce) },
  );
}

export function operatorPage(pathname: string): Response | undefined {
  if (pathname === "/" || pathname === "/runs")
    return shell("Dashboard", "dashboard");
  const plan = /^\/plans\/([a-zA-Z0-9_-]{1,128})$/.exec(pathname)?.[1];
  if (plan) return shell("Plan", "plan", plan);
  const run = /^\/runs\/([a-zA-Z0-9_-]{1,128})$/.exec(pathname)?.[1];
  if (run) return shell("Run", "run", run);
  return undefined;
}

export async function dashboard(
  env: ControlPlaneEnv,
): Promise<Record<string, unknown>> {
  const rows = await env.DB.prepare(
    "SELECT run_id FROM self_development_runs ORDER BY updated_at DESC LIMIT 50",
  ).all<{ run_id: string }>();
  const jobs = new D1JobStore(env.DB);
  return {
    schemaVersion: 1,
    plans: await listIssuePlans(env, 50),
    runs: await Promise.all(
      rows.results.map(async ({ run_id }) =>
        inspectRun(await jobs.read(run_id)),
      ),
    ),
  };
}

export async function planInspection(
  env: ControlPlaneEnv,
  planId: string,
): Promise<Record<string, unknown> | undefined> {
  const plan = await readPlanById(env, planId);
  return plan ? { schemaVersion: 1, plan } : undefined;
}
