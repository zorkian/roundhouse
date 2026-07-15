// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ControlPlaneEnv } from "./environment.js";
import { inspectRun } from "./inspection.js";
import {
  listIssuePlans,
  readIssuePlan,
  readPlanById,
} from "./github-planning.js";
import {
  listIssueReviews,
  listIndependentReviews,
  readIndependentReview,
} from "./github-review.js";
import { D1JobStore } from "@roundhouse/self-development/cloudflare";
import { issueRun } from "./github-webhook.js";
import { readExecutionProgress } from "./execution-progress.js";
import { readPullRequestLifecycle } from "./github-lifecycle.js";
import { readTrustedReviewWorkflows } from "./trusted-execution-workflow.js";

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
  kind: "dashboard" | "issue" | "plan" | "run" | "review",
  commandPrefix: "/rhd" | "/rh",
  id?: string,
): Response {
  const serialized = JSON.stringify({ kind, id, commandPrefix });
  const nonce = responseNonce();
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Roundhouse</title><style nonce="${nonce}">
:root{color-scheme:dark;--bg:#0c1117;--panel:#151d27;--line:#2b3949;--text:#e8eef5;--muted:#95a6b8;--accent:#62d3a4;--warn:#ffca6a;--bad:#ff7c82}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}main{max-width:1180px;margin:auto;padding:28px 20px}header{display:flex;align-items:baseline;gap:18px;margin-bottom:24px}h1{font-size:24px;margin:0}h2{font-size:16px;margin:0 0 12px}h3{font-size:14px;margin:16px 0 8px}a{color:var(--accent)}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:16px}.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:16px}.issue-list{margin-top:4px}.issue-row{display:grid;grid-template-columns:minmax(18rem,2fr) minmax(10rem,.75fr) minmax(14rem,1fr);gap:22px;align-items:center;border-top:1px solid var(--line);padding:13px 0}.issue-row:first-child{border:0}.issue-repository{color:var(--muted);font-size:12px;margin-bottom:2px}.issue-title{display:block;color:var(--text);font-weight:700;text-decoration:none}.issue-title:hover{text-decoration:underline}.issue-state{font-weight:700}.issue-action{color:var(--muted)}.issue-count{color:var(--muted);font-weight:400}.issue-archive>summary{cursor:pointer;list-style:none}.issue-archive>summary::-webkit-details-marker{display:none}.issue-archive>summary h2{display:inline}.issue-archive>summary:before{content:'›';color:var(--muted);display:inline-block;width:1.2em;transition:transform .15s}.issue-archive[open]>summary:before{transform:rotate(90deg)}.row{display:flex;justify-content:space-between;gap:16px;border-top:1px solid var(--line);padding:8px 0}.row:first-child{border:0}.event-row{display:grid;grid-template-columns:minmax(10rem,2fr) minmax(8rem,1fr) minmax(7rem,.8fr) minmax(5rem,.5fr);gap:16px;align-items:center;border-top:1px solid var(--line);padding:8px 0}.event-row:first-child{border:0}.event-head{padding-top:0;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}.event-time{text-align:right}.timeline-item summary{cursor:pointer;list-style:none}.timeline-item summary::-webkit-details-marker{display:none}.timeline-item .event-phase:before{content:'›';color:var(--muted);display:inline-block;width:1.2em;transition:transform .15s}.timeline-item[open] .event-phase:before{transform:rotate(90deg)}.timeline-detail{border-left:2px solid var(--line);margin:0 0 12px .55em;padding:2px 12px 12px 18px}.timeline-detail h3:first-child{margin-top:4px}.finding{background:#101720;border-radius:5px;margin:8px 0;padding:4px 12px}.actions{border-top:1px solid var(--line);margin-top:12px;padding-top:12px}.state{color:var(--accent)}.failed,.rejected,.cancelled{color:var(--bad)}.awaiting_approval,.proposed{color:var(--warn)}code{overflow-wrap:anywhere}button{background:var(--accent);color:#07130e;border:0;border-radius:5px;font:inherit;font-weight:700;padding:8px 12px;cursor:pointer;margin-right:8px}button.danger{background:var(--bad)}button:disabled{opacity:.45;cursor:not-allowed}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#090d12;padding:12px;border-radius:5px}.notice{min-height:24px;color:var(--warn)}@media(max-width:720px){.issue-row{grid-template-columns:1fr;gap:6px}.issue-state{margin-top:4px}}@media(max-width:620px){.event-head{display:none}.event-row{grid-template-columns:1fr auto auto}.event-phase{grid-column:1/-1;grid-row:1}.event-attempt{grid-column:1;grid-row:2}.event-status{grid-column:2;grid-row:2}.event-time{grid-column:3;grid-row:2;text-align:right}.timeline-detail{margin-left:0}}
</style></head><body><main><header><h1>Roundhouse</h1><a href="/">Dashboard</a><span class="muted">live · refreshes every 5s</span></header><div id="app">Loading…</div></main>
<script nonce="${nonce}">const page=${serialized};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=(type,id)=>'<a href="/'+type+'/'+encodeURIComponent(id)+'">'+esc(id)+'</a>';
const ext=(url,label)=>'<a href="'+esc(url)+'" rel="noreferrer">'+esc(label)+'</a>';
const commit=sha=>sha?ext('https://github.com/zorkian/roundhouse/commit/'+encodeURIComponent(sha),sha):'—';
const repositoryCommit=(repository,sha)=>sha?ext('https://github.com/'+repository+'/commit/'+encodeURIComponent(sha),sha):'—';
const actor=id=>String(id||'').startsWith('github:')?ext('https://github.com/'+encodeURIComponent(String(id).slice(7)),String(id).slice(7)):esc(id||'—');
const issueStatus=(repository,number)=>'<a href="/repositories/'+repository.split('/').map(encodeURIComponent).join('/')+'/issues/'+encodeURIComponent(number)+'">workflow</a>';
async function api(path,options){const r=await fetch(path,options);const v=await r.json();if(!r.ok)throw new Error(v.error?.message||'Request failed');return v}
function rows(values){return values.map(([k,v])=>'<div class="row"><span class="muted">'+esc(k)+'</span><span>'+v+'</span></div>').join('')}
function card(title,body){return '<section class="card"><h2>'+esc(title)+'</h2>'+body+'</section>'}
function repositoryFromUrl(value){try{const url=new URL(String(value||''));if(url.protocol!=='https:'||url.hostname!=='github.com')return undefined;let path=url.pathname;if(path.endsWith('.git'))path=path.slice(0,-4);const parts=path.split('/').filter(Boolean);return parts.length===2?parts[0]+'/'+parts[1]:undefined}catch{return undefined}}
function runRepository(r){return r.source?.owner&&r.source?.repository?r.source.owner+'/'+r.source.repository:repositoryFromUrl(r.publication?.remoteUrl)}
function dashboardIssues(v){const plans=v.plans||[];const runs=v.runs||[];const reviews=v.reviews||[];const issues=new Map;const ensure=(repository,number,url)=>{const key=repository+'#'+number;if(!issues.has(key))issues.set(key,{repositoryFullName:repository,issueNumber:number,issueUrl:url||'https://github.com/'+repository+'/issues/'+number});return issues.get(key)};const subject=(item,value,at)=>{if(value&&(!item.subjectAt||Date.parse(at||'')>=Date.parse(item.subjectAt||''))){item.subject=value;item.subjectAt=at}};for(const p of plans){const matchedRun=runs.find(r=>r.runId===p.runId||r.planning?.planId===p.plan.planId);const matchedReview=reviews.find(r=>r.request?.issueNumber===p.plan.issueNumber);const repository=runRepository(matchedRun||{})||repositoryFromUrl(matchedReview?.request?.repositoryUrl)||'zorkian/roundhouse';const item=ensure(repository,p.plan.issueNumber);item.plan=p;subject(item,p.plan.subject,p.plan.createdAt)}for(const r of runs){const plan=plans.find(p=>p.runId===r.runId||p.plan.planId===r.planning?.planId);const number=r.source?.issueNumber||plan?.plan.issueNumber;if(!number)continue;const repository=runRepository(r)||'zorkian/roundhouse';const item=ensure(repository,number,r.source?.issueUrl);if(!item.run||Date.parse(r.updatedAt||'')>=Date.parse(item.run.updatedAt||''))item.run=r;subject(item,r.subject,r.updatedAt)}for(const review of reviews){const repository=repositoryFromUrl(review.request?.repositoryUrl)||'zorkian/roundhouse';const number=review.request?.issueNumber;if(!number)continue;const item=ensure(repository,number,review.request.issueUrl);if(!item.review||Date.parse(review.updatedAt||'')>=Date.parse(item.review.updatedAt||''))item.review=review;subject(item,review.request.subject,review.updatedAt)}return [...issues.values()]}
function issueState(i){const artifacts=[i.plan&&{kind:'plan',value:i.plan,at:i.plan.plan.createdAt},i.run&&{kind:'run',value:i.run,at:i.run.updatedAt},i.review&&{kind:'review',value:i.review,at:i.review.updatedAt}].filter(Boolean).sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));const current=artifacts[0];if(!current)return {label:'Waiting to start',tone:'muted',bucket:'active',at:''};if(current.kind==='review'){const states={pending:['Review queued','', 'active'],running:['Independent review','', 'active'],completed:['Ready for human review','awaiting_approval','attention'],failed:['Review failed','failed','attention'],remediation_pending:['Fixing review findings','', 'active'],remediated:['Remediation complete','state','finished']};const state=states[current.value.status]||[current.value.status,'','active'];return {label:state[0],tone:state[1],bucket:state[2],kind:'review',at:current.at}}if(current.kind==='run'){const states={created:['Starting','', 'active'],workspace_ready:['Workspace ready','', 'active'],implementing:['Implementing','', 'active'],validating:['Validating','', 'active'],awaiting_approval:['Approval needed','awaiting_approval','attention'],awaiting_publication:['Preparing publication','', 'active'],approved:['Approved','', 'active'],committed:['Publishing','', 'active'],pushed:['Publishing','', 'active'],completed:['Completed','state','finished'],failed:['Implementation failed','failed','attention'],cancelled:['Cancelled','cancelled','finished']};const state=states[current.value.state]||[current.value.state,'','active'];return {label:state[0],tone:state[1],bucket:state[2],kind:'run',at:current.at}}const states={proposed:['Plan ready','proposed','attention'],approved:['Approved to start','', 'active'],materialized:['Starting','', 'active'],needs_clarification:['Clarification needed','awaiting_approval','attention'],already_satisfied:['Already satisfied','state','finished'],duplicate:['Duplicate','muted','finished'],rejected:['Rejected','rejected','finished']};const state=states[current.value.status]||[current.value.status,'','active'];return {label:state[0],tone:state[1],bucket:state[2],kind:'plan',at:current.at}}
function issueAction(i,state){const workflow='/repositories/'+i.repositoryFullName.split('/').map(encodeURIComponent).join('/')+'/issues/'+encodeURIComponent(i.issueNumber);if(state.kind==='review'){const r=i.review;if(r.status==='completed'&&r.request.pullRequestUrl)return ext(r.request.pullRequestUrl,'Review pull request #'+r.request.pullRequestNumber);if(r.status==='failed')return '<a href="/reviews/'+encodeURIComponent(r.request.reviewId)+'">Inspect review failure</a>';if(['pending','running'].includes(r.status))return '<a href="/reviews/'+encodeURIComponent(r.request.reviewId)+'">Follow review</a>';return '<a href="'+workflow+'">Follow remediation</a>'}if(state.kind==='run'){const r=i.run;if(r.state==='awaiting_approval')return '<a href="'+workflow+'">Review and approve</a>';if(r.state==='failed')return '<a href="/runs/'+encodeURIComponent(r.runId)+'">Inspect failed run</a>';if(r.publication?.pullRequestUrl&&r.state==='completed')return ext(r.publication.pullRequestUrl,'View pull request');if(!['completed','cancelled'].includes(r.state))return '<a href="/runs/'+encodeURIComponent(r.runId)+'">Follow live run</a>';return '<a href="'+workflow+'">View workflow</a>'}if(state.kind==='plan'){const p=i.plan;if(p.status==='needs_clarification')return ext(i.issueUrl,'Answer questions on issue');if(p.status==='proposed')return '<a href="/plans/'+encodeURIComponent(p.plan.planId)+'">Review plan</a>';if(p.status==='rejected')return '<a href="/plans/'+encodeURIComponent(p.plan.planId)+'">Inspect rejection</a>'}return '<a href="'+workflow+'">View workflow</a>'}
function issueRows(items){return '<div class="issue-list">'+items.map(i=>{const state=issueState(i);const workflow='/repositories/'+i.repositoryFullName.split('/').map(encodeURIComponent).join('/')+'/issues/'+encodeURIComponent(i.issueNumber);return '<article class="issue-row"><div><div class="issue-repository">'+esc(i.repositoryFullName)+' · '+ext(i.issueUrl,'#'+i.issueNumber)+'</div><a class="issue-title" href="'+workflow+'">'+esc(i.subject||'GitHub issue #'+i.issueNumber)+'</a></div><div class="issue-state '+esc(state.tone)+'">'+esc(state.label)+'</div><div class="issue-action">'+issueAction(i,state)+'</div></article>'}).join('')+'</div>'}
function issueCard(title,items){return '<section class="card"><h2>'+esc(title)+' <span class="issue-count">('+items.length+')</span></h2>'+(items.length?issueRows(items):'<span class="muted">No issue workflows here.</span>')+'</section>'}
function renderDashboard(v){const groups={attention:[],active:[],finished:[]};for(const issue of dashboardIssues(v)){issue.workflowState=issueState(issue);groups[issue.workflowState.bucket].push(issue)}for(const items of Object.values(groups))items.sort((a,b)=>(Date.parse(b.workflowState.at)||0)-(Date.parse(a.workflowState.at)||0));return issueCard('Needs attention',groups.attention)+issueCard('In progress',groups.active)+'<details class="card issue-archive" id="finished-issues" data-preserve-open><summary><h2>Finished <span class="issue-count">('+groups.finished.length+')</span></h2></summary>'+(groups.finished.length?issueRows(groups.finished):'<span class="muted">No finished issue workflows.</span>')+'</details>'}
function issueSummary(v){const reviews=v.reviews||[];const review=reviews.at(-1);const run=v.activeRun||v.sourceRun;const pr=(v.activeRun?.publication?.pullRequestUrl?v.activeRun:v.sourceRun)?.publication?.pullRequestUrl;if(v.pullRequestLifecycle?.state==='merged')return card('What happens next',rows([['status','<span class="state">Complete</span>'],['next action','This issue is complete. Follow the linked development release only if you want deployment detail.']]));if(review&&['pending','running'].includes(review.status))return card('What happens next',rows([['status','Independent review is running'],['next action','No action needed. Claude’s result will appear on the issue and pull request.'],['review',link('reviews',review.request.reviewId)]]));if(review?.status==='completed')return card('What happens next',rows([['status','<span class="state">Ready for human review</span>'],['next action',pr?ext(pr,'Review and merge the pull request if it looks right'):'Review the completed independent review'],['review',link('reviews',review.request.reviewId)]]));if(review&&['remediation_pending','remediated'].includes(review.status))return card('What happens next',rows([['status','Roundhouse is addressing review findings'],['next action','No action needed until the remediation implementation is ready for approval.'],['review',link('reviews',review.request.reviewId)]]));if(review?.status==='failed')return card('What happens next',rows([['status','<span class="failed">Independent review failed</span>'],['next action','Inspect the review failure before deciding whether to retry.'],['review',link('reviews',review.request.reviewId)]]));if(run?.state==='awaiting_approval')return card('What happens next',rows([['status','<span class="awaiting_approval">Your approval is needed</span>'],['next action',link('runs',run.runId)+' · review the exact patch and validation, then approve it on the issue.']]));if(run?.state==='failed')return card('What happens next',rows([['status','<span class="failed">Implementation failed</span>'],['next action',link('runs',run.runId)+' · inspect the failure and retry if it is actionable.']]));if(run)return card('What happens next',rows([['status','Roundhouse is implementing this issue'],['next action','No action needed. Follow '+link('runs',run.runId)+' for live execution.']]));if(v.plan?.plan?.status==='needs_clarification')return card('What happens next',rows([['status','<span class="awaiting_approval">Clarification needed</span>'],['next action',link('plans',v.plan.plan.planId)+' · answer the targeted questions on the issue.']]));if(v.plan)return card('What happens next',rows([['status','Plan ready'],['next action',link('plans',v.plan.plan.planId)+' · review the plan and requested scope.']]));return card('What happens next',rows([['status','Waiting to start'],['next action','Post '+page.commandPrefix+' start on the GitHub issue.']]))}
function renderIssue(v){const plan=v.plan;const publicationRun=v.activeRun?.publication?.pullRequestUrl?v.activeRun:v.sourceRun;const lifecycle=v.pullRequestLifecycle;const checks=lifecycle?.mergeCommitSha?ext('https://github.com/'+v.repositoryFullName+'/commit/'+lifecycle.mergeCommitSha+'/checks','development release and checks'):'—';const reviews=v.reviews||[];return issueSummary(v)+card('GitHub issue workflow',rows([['repository',ext('https://github.com/'+v.repositoryFullName,v.repositoryFullName)],['issue',ext('https://github.com/'+v.repositoryFullName+'/issues/'+v.issueNumber,'#'+v.issueNumber)],['plan',plan?link('plans',plan.plan.planId):'—'],['source run',v.sourceRun?link('runs',v.sourceRun.runId):'—'],['active run',v.activeRun?link('runs',v.activeRun.runId):'—'],['pull request',publicationRun?.publication?.pullRequestUrl?ext(publicationRun.publication.pullRequestUrl,'pull request'):'—'],['pull request state',lifecycle?'<span class="'+esc(lifecycle.state)+'">'+esc(lifecycle.state)+'</span>':'—'],['merged commit',lifecycle?.mergeCommitSha?repositoryCommit(v.repositoryFullName,lifecycle.mergeCommitSha):'—'],['post-merge',checks]]))+card('Independent reviews',reviews.length?reviews.map(r=>rows([['cycle',esc(r.request.cycle)+' of 2'],['review',link('reviews',r.request.reviewId)],['head',repositoryCommit(v.repositoryFullName,r.request.headCommit)],['status','<span class="'+esc(r.status)+'">'+esc(r.status)+'</span>'],['findings',esc(r.execution?.result?.findings?.length||0)],['evidence',r.execution?'<a href="/v1/reviews/'+encodeURIComponent(r.request.reviewId)+'/evidence">retained bytes</a>':'—']])).join('<br>'):'<span class="muted">No reviews yet</span>')}
function planDetail(p){if(p.status==='proposed')return p.exactPaths.join('\\n');if(p.status==='rejected')return p.findings.map(x=>x.code+': '+(x.path?x.path+': ':'')+x.message).join('\\n');return [p.understanding,...(p.questions||[]),...(p.evidence||[]),p.duplicateOf||''].filter(Boolean).join('\\n')}
function renderPlan(v){const p=v.plan.plan;const d=v.plan;const can=d.status==='proposed';return card('Immutable issue plan',rows([['plan',esc(p.planId)],['issue',ext('https://github.com/zorkian/roundhouse/issues/'+p.issueNumber,'#'+p.issueNumber)],['status','<span class="'+esc(d.status)+'">'+esc(d.status)+'</span>'],['revision',esc(d.revision)+' · '+esc(d.updatedAt||p.createdAt)],['base',commit(p.baseCommit)],['SHA-256','<code>'+esc(p.planSha256)+'</code>'],['evidence','<a href="/v1/plans/'+encodeURIComponent(p.planId)+'/evidence">'+esc(d.evidence.objectKey)+'</a>'],['evidence SHA-256','<code>'+esc(d.evidence.sha256)+'</code>'],['approved by',actor(d.approvedBy)],['run',d.runId?link('runs',d.runId):'—']]))+card('Qualification detail','<pre>'+esc(planDetail(p))+'</pre>')+(can?card('Action','<button id="approve-plan">Approve exact plan and start</button><div class="notice" id="notice"></div>'):'')}
function duration(p){const end=p.completedAt?new Date(p.completedAt).getTime():Date.now();const start=new Date(p.startedAt).getTime();return Number.isFinite(start)?Math.max(0,Math.round((end-start)/1000))+'s':'—'}
function attemptLabel(p,runId){const value=String(p.attemptId||'attempt');const suffix=/(?:^|-)([a-z][a-z0-9]*)-([1-9][0-9]*)$/.exec(value);if(suffix)return suffix[1]+' #'+suffix[2];const prefix=runId+'-';return value.startsWith(prefix)?value.slice(prefix.length):value}
function implementationDetail(v){if(!v)return '';const validation=v.validation||[];return '<h3>Implementation result</h3>'+rows([['summary',esc(v.summary||'—')],['changed files',esc((v.changedFiles||[]).join(', ')||'—')],['patch size',esc(v.patchBytes)+' bytes']])+validation.map(x=>rows([['validation',esc(x.name)+' · '+(x.exitCode===0?'passed':'failed')],['command',esc(x.command)],['result',x.stderr?'<pre>'+esc(x.stderr)+'</pre>':esc(x.stdout||'passed')]])).join('')+'<h3>Exact retained diff</h3><pre>'+esc(v.patch)+'</pre>'}
function reviewDetail(v){if(!v)return '';const findings=v.execution?.result?.findings||[];const result=v.execution?.result;return '<h3>Review result</h3>'+rows([['status','<span class="'+esc(v.status)+'">'+esc(v.status)+'</span>'],['summary',esc(result?.summary||v.failureReason||'—')],['cycle',esc(v.request?.cycle||'—')],['review','<a href="/reviews/'+encodeURIComponent(v.request.reviewId)+'">complete review</a>'],['evidence',v.execution?'<a href="/v1/reviews/'+encodeURIComponent(v.request.reviewId)+'/evidence">retained review evidence</a>':'—']])+(findings.length?'<h3>Findings</h3>'+findings.map(f=>'<div class="finding">'+rows([['severity',esc(f.severity)],['location',esc(f.path+(f.line?':'+f.line:''))],['finding',esc(f.title)],['rationale',esc(f.rationale)],['recommendation',esc(f.recommendation)]])+'</div>').join(''):'<p class="muted">No findings.</p>')}
function timelineEntries(r){const values=[...(r.progress||[])];for(const a of r.attempts||[]){const hasPhases=values.some(p=>p.attemptId===a.attemptId);if(!hasPhases||a.status==='failed')values.push({attemptId:a.attemptId,phase:hasPhases?a.stage+' outcome':a.stage,status:a.status,startedAt:a.startedAt,completedAt:a.completedAt,updatedAt:a.completedAt||a.startedAt})}for(const review of r.reviews||[]){const attemptId=review.activeAttemptId||review.request?.attemptId||review.request.reviewId+'-attempt-'+Math.max(1,review.attemptCount||1);if(!values.some(p=>p.attemptId===attemptId))values.push({attemptId,phase:'agent.review',status:review.status==='failed'?'failed':['pending','running'].includes(review.status)?'running':'completed',startedAt:review.createdAt,completedAt:['pending','running'].includes(review.status)?undefined:review.updatedAt,updatedAt:review.updatedAt})}if(r.implementationReview&&!values.some(p=>p.phase==='agent.implement'))values.push({attemptId:r.runId+'-implementation-1',phase:'agent.implement',status:'completed',startedAt:r.createdAt||r.updatedAt,completedAt:r.updatedAt,updatedAt:r.updatedAt});return values.sort((a,b)=>(Date.parse(a.startedAt)||0)-(Date.parse(b.startedAt)||0))}
function timelineDetail(r,p){const attempt=(r.attempts||[]).find(a=>a.attemptId===p.attemptId);const evidence=(r.evidence||[]).filter(e=>e.attemptId===p.attemptId);const review=(r.reviews||[]).find(v=>p.attemptId===v.activeAttemptId||p.attemptId===v.request?.attemptId||String(p.attemptId).startsWith(v.request?.reviewId+'-'));let body=rows([['started',esc(p.startedAt||attempt?.startedAt||'—')],['completed',esc(p.completedAt||attempt?.completedAt||'—')]]);if(attempt?.classification)body+=rows([['classification',esc(attempt.classification)]]);if(attempt?.error)body+='<h3>Error</h3><pre>'+esc(attempt.error)+'</pre>';if(p.phase==='agent.implement')body+=implementationDetail(r.implementationReview);body+=reviewDetail(review);if(evidence.length)body+='<h3>Evidence</h3>'+evidence.map(e=>rows([['diagnostics','<a href="/v1/runs/'+encodeURIComponent(r.runId)+'/evidence/'+encodeURIComponent(e.evidenceId)+'">retained evidence</a>'],['size',esc(e.size)+' bytes'],['approval eligible',esc(e.approvalEligible===false?'no':'yes')]])).join('');return body}
function timelineRows(r){const entries=timelineEntries(r);if(!entries.length)return '<span class="muted">Waiting for execution progress</span>';return '<div class="event-row event-head"><span>Phase</span><span>Attempt</span><span>Status</span><span class="event-time">Elapsed</span></div>'+entries.map((p,index)=>'<details class="timeline-item" id="timeline-'+index+'" data-preserve-open><summary class="event-row"><span class="event-phase">'+esc(p.phase)+'</span><strong class="event-attempt">'+esc(attemptLabel(p,r.runId))+'</strong><span class="event-status '+esc(p.status)+'">'+esc(p.status)+'</span><span class="event-time">'+esc(duration(p))+'</span></summary><div class="timeline-detail">'+timelineDetail(r,p)+'</div></details>').join('')}
function renderRun(r){const actions=(r.state==='failed'?'<button id="retry-run">Retry exact revision</button>':'')+(!['completed','cancelled','failed'].includes(r.state)?'<button class="danger" id="cancel-run">Cancel exact revision</button>':'');const plan=r.planning?'<a href="/plans/'+encodeURIComponent(r.planning.planId)+'">approved plan</a>':'—';const workflow=(r.workflows||[]).at(-1);const workflowValue=workflow?'<span class="'+esc(workflow.status)+'">'+esc(workflow.status)+'</span> · <code>'+esc(workflow.workflowInstanceId)+'</code>':'—';const metadata=rows([['task',esc(r.subject||r.taskId)],['issue',r.source?ext(r.source.issueUrl,'#'+r.source.issueNumber):'—'],['state','<span class="'+esc(r.state)+'">'+esc(r.state)+'</span>'],['revision',esc(r.revision)+' · '+esc((r.events||[]).length)+' transitions'],['durable execution',workflowValue],['plan',plan],['approved by',actor(r.approval?.approver)],['publication',r.publication?.pullRequestUrl?ext(r.publication.pullRequestUrl,'pull request'):'—']]);return card('Run',metadata+(actions?'<div class="actions">'+actions+'<div class="notice" id="notice"></div></div>':''))+card('Timeline',timelineRows(r))}
function renderReview(r){const findings=r.execution?.result?.findings||[];const disposition=new Map((r.dispositions||[]).map(x=>[x.findingId,x]));const workflow=(r.workflows||[]).at(-1);const workflowValue=workflow?'<span class="'+esc(workflow.status)+'">'+esc(workflow.status)+'</span> · <code>'+esc(workflow.workflowInstanceId)+'</code>':'—';return card('Independent review',rows([['review',esc(r.request.reviewId)],['status','<span class="'+esc(r.status)+'">'+esc(r.status)+'</span>'],['durable execution',workflowValue],['cycle',esc(r.request.cycle)+' of 2'],['issue',ext(r.request.issueUrl,'#'+r.request.issueNumber)],['pull request',ext(r.request.pullRequestUrl,'#'+r.request.pullRequestNumber)],['base',commit(r.request.baseCommit)],['reviewed head',commit(r.request.headCommit)],['patch','<code>'+esc(r.request.patchSha256)+'</code>'],['source run',link('runs',r.request.runId)],['remediation run',r.remediationRunId?link('runs',r.remediationRunId):'—'],['evidence',r.execution?'<a href="/v1/reviews/'+encodeURIComponent(r.request.reviewId)+'/evidence">'+esc(r.execution.evidence.objectKey)+'</a>':'—']]))+card('Findings',findings.length?findings.map(f=>{const d=disposition.get(f.findingId);return rows([['severity',esc(f.severity)],['location',esc(f.path+(f.line?':'+f.line:''))],['finding',esc(f.title)],['disposition',esc(d?.disposition||'—')],['rationale',esc(f.rationale)],['recommendation',esc(f.recommendation)]])}).join('<br>'):'<span class="muted">No findings</span>')+card('Revision history',(r.events||[]).map(e=>rows([['revision',esc(e.sequence)],['event',esc(e.type)],['at',esc(e.occurredAt)]])).join('<br>'))}
function bindActions(){document.getElementById('approve-plan')?.addEventListener('click',approvePlan);document.getElementById('retry-run')?.addEventListener('click',()=>runAction('retry'));document.getElementById('cancel-run')?.addEventListener('click',()=>runAction('cancel'))}
let current;async function load(){try{const openPanels=document.querySelectorAll?[...document.querySelectorAll('[data-preserve-open][open]')].map(x=>x.id):[];const path=page.kind==='dashboard'?'/v1/dashboard':page.kind==='issue'?'/v1/repositories/'+page.id:page.kind==='plan'?'/v1/plans/'+encodeURIComponent(page.id):page.kind==='review'?'/v1/reviews/'+encodeURIComponent(page.id):'/v1/runs/'+encodeURIComponent(page.id);current=await api(path);if(page.kind==='run'&&current.implementation)current.implementationReview=await api('/v1/runs/'+encodeURIComponent(page.id)+'/implementation');document.getElementById('app').innerHTML=page.kind==='dashboard'?renderDashboard(current):page.kind==='issue'?renderIssue(current):page.kind==='plan'?renderPlan(current):page.kind==='review'?renderReview(current):renderRun(current);for(const id of openPanels)document.getElementById(id)?.setAttribute('open','');bindActions()}catch(e){document.getElementById('app').innerHTML=card('Error',esc(e.message))}}
async function approvePlan(){try{const p=current.plan;await api('/v1/plans/'+encodeURIComponent(p.plan.planId)+'/approve',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'ui-plan-'+p.plan.planId+'-'+p.revision},body:JSON.stringify({schemaVersion:1,expectedRevision:p.revision,planSha256:p.plan.planSha256})});await load()}catch(e){document.getElementById('notice').textContent=e.message}}
async function runAction(action){try{await api('/v1/runs/'+encodeURIComponent(current.runId)+'/'+action,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'ui-'+action+'-'+current.runId+'-'+current.revision},body:JSON.stringify({schemaVersion:1,expectedRevision:current.revision})});await load()}catch(e){document.getElementById('notice').textContent=e.message}}
load();setInterval(load,5000);</script></body></html>`,
    { headers: responseHeaders(nonce) },
  );
}

export function operatorPage(
  pathname: string,
  commandPrefix: "/rhd" | "/rh" = "/rh",
): Response | undefined {
  if (pathname === "/" || pathname === "/runs")
    return shell("Dashboard", "dashboard", commandPrefix);
  const issue =
    /^\/repositories\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/issues\/([1-9][0-9]*)$/.exec(
      pathname,
    );
  if (issue)
    return shell(
      "GitHub issue workflow",
      "issue",
      commandPrefix,
      `${issue[1]}/${issue[2]}/issues/${issue[3]}`,
    );
  const plan = /^\/plans\/([a-zA-Z0-9_-]{1,128})$/.exec(pathname)?.[1];
  if (plan) return shell("Plan", "plan", commandPrefix, plan);
  const run = /^\/runs\/([a-zA-Z0-9_-]{1,128})$/.exec(pathname)?.[1];
  if (run) return shell("Run", "run", commandPrefix, run);
  const review = /^\/reviews\/(review_[a-f0-9]{40})$/.exec(pathname)?.[1];
  if (review)
    return shell("Independent review", "review", commandPrefix, review);
  return undefined;
}

export async function issueInspection(
  env: ControlPlaneEnv,
  repositoryFullName: string,
  issueNumber: number,
): Promise<Record<string, unknown>> {
  if (repositoryFullName !== "zorkian/roundhouse")
    throw new Error("Repository is not enrolled in this development adapter");
  const jobs = new D1JobStore(env.DB);
  const sourceRunId = await issueRun(env, issueNumber);
  const source = sourceRunId ? await jobs.read(sourceRunId) : undefined;
  const sourceRun = sourceRunId
    ? {
        ...inspectRun(source!),
        progress: await readExecutionProgress(env, sourceRunId),
      }
    : undefined;
  const reviews = await listIssueReviews(env, repositoryFullName, issueNumber);
  const activeRunId = reviews.findLast(
    (review) => review.remediationRunId,
  )?.remediationRunId;
  const active = activeRunId ? await jobs.read(activeRunId) : undefined;
  const activeRun = activeRunId
    ? {
        ...inspectRun(active!),
        progress: await readExecutionProgress(env, activeRunId),
      }
    : undefined;
  const publicationRunId = active?.publication
    ? active.runId
    : source?.publication
      ? source.runId
      : undefined;
  return {
    schemaVersion: 1,
    repositoryFullName,
    issueNumber,
    plan: await readIssuePlan(env, issueNumber),
    sourceRun,
    activeRun,
    pullRequestLifecycle: publicationRunId
      ? await readPullRequestLifecycle(env, publicationRunId)
      : undefined,
    reviews,
  };
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
    reviews: await listIndependentReviews(env, 50),
    runs: await Promise.all(
      rows.results.map(async ({ run_id }) =>
        inspectRun(await jobs.read(run_id)),
      ),
    ),
  };
}

export async function reviewInspection(
  env: ControlPlaneEnv,
  reviewId: string,
): Promise<Record<string, unknown> | undefined> {
  const review = await readIndependentReview(env, reviewId);
  return review
    ? { ...review, workflows: await readTrustedReviewWorkflows(env, reviewId) }
    : undefined;
}

export async function planInspection(
  env: ControlPlaneEnv,
  planId: string,
): Promise<Record<string, unknown> | undefined> {
  const plan = await readPlanById(env, planId);
  return plan ? { schemaVersion: 1, plan } : undefined;
}
