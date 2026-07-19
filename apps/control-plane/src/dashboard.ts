// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { RunStatus } from "@roundhouse/core";
import type { RunSummary } from "./d1-store.js";

const escapeHtml = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const labels: Record<RunStatus, string> = {
  active: "In progress",
  waiting: "Waiting for a response",
  succeeded: "Completed",
  failed: "Needs attention",
  cancelled: "Cancelled",
};

function detailsPath(run: RunSummary["run"]): string {
  const [owner, name] = run.repository.split("/");
  return `/repositories/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(name ?? "")}/issues/${run.issueNumber}`;
}

function renderRun(summary: RunSummary): string {
  const { run } = summary;
  const title = run.issue?.title ?? `Issue #${run.issueNumber}`;
  const github =
    run.issue?.url && /^https:\/\//.test(run.issue.url)
      ? `<a class="secondary" href="${escapeHtml(run.issue.url)}">View on GitHub</a>`
      : "";
  const detail = run.waitingReason
    ? `${run.stage} · ${run.waitingReason.replaceAll("_", " ")}`
    : run.stage;
  return `<article class="run">
  <div class="run-main"><div class="eyebrow">${escapeHtml(run.repository)} · #${run.issueNumber}</div><h3><a href="${detailsPath(run)}">${escapeHtml(title)}</a></h3><p>${escapeHtml(detail)}</p></div>
  <div class="run-meta"><span class="status ${run.status}">${labels[run.status]}</span><time datetime="${new Date(summary.updatedAt).toISOString()}">Updated ${escapeHtml(new Date(summary.updatedAt).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }))} UTC</time>${github}</div>
</article>`;
}

function section(
  heading: string,
  description: string,
  runs: readonly RunSummary[],
): string {
  return `<section><div class="section-heading"><div><h2>${heading}</h2><p>${description}</p></div><span class="count">${runs.length}</span></div>${runs.length ? runs.map(renderRun).join("") : '<p class="empty">Nothing here right now.</p>'}</section>`;
}

export function renderDashboard(runs: readonly RunSummary[]): string {
  const attention = runs.filter(({ run }) =>
    ["waiting", "failed"].includes(run.status),
  );
  const active = runs.filter(({ run }) => run.status === "active");
  const finished = runs.filter(({ run }) =>
    ["succeeded", "cancelled"].includes(run.status),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="refresh" content="10"><title>Roundhouse</title><style>
:root{color-scheme:light;--ink:#18212f;--muted:#647084;--line:#dde3ea;--paper:#fff;--wash:#f4f7fa;--brand:#c9472f}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}a{color:inherit}header{background:#18212f;color:white;padding:2.25rem max(1.25rem,calc((100% - 1080px)/2))}header p{color:#bdc7d5;margin:.35rem 0 0}h1{font-size:2rem;margin:0;letter-spacing:-.025em}main{max-width:1080px;margin:0 auto;padding:1.5rem 1.25rem 4rem}.summary{display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1.5rem}.summary span{background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:.45rem .8rem}.summary strong{margin-right:.35rem}section{background:var(--paper);border:1px solid var(--line);border-radius:12px;margin:0 0 1rem;overflow:hidden}.section-heading{display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:1rem 1.2rem;border-bottom:1px solid var(--line)}h2{font-size:1.05rem;margin:0}.section-heading p{color:var(--muted);margin:.15rem 0 0}.count{font-weight:700;background:var(--wash);border-radius:999px;min-width:2rem;padding:.25rem .6rem;text-align:center}.run{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1.5rem;padding:1.1rem 1.2rem;border-bottom:1px solid var(--line)}.run:last-child{border-bottom:0}.eyebrow{color:var(--muted);font-size:.8rem;font-weight:650;text-transform:uppercase;letter-spacing:.04em}.run h3{font-size:1rem;margin:.2rem 0}.run p{color:var(--muted);margin:0}.run-meta{display:flex;flex-direction:column;align-items:flex-end;gap:.4rem;font-size:.8rem;color:var(--muted)}.status{border-radius:999px;padding:.22rem .55rem;font-weight:700;color:#344054;background:#eef1f5}.status.active{background:#e6f0ff;color:#175cd3}.status.waiting{background:#fff4d6;color:#8a5b00}.status.failed{background:#fee9e7;color:#b42318}.status.succeeded{background:#e8f7ee;color:#087443}.secondary{color:#415b7a}.empty{color:var(--muted);margin:0;padding:1.2rem}.refresh{font-size:.8rem;margin-top:1rem;color:var(--muted)}@media(max-width:650px){.run{grid-template-columns:1fr}.run-meta{align-items:flex-start}}
</style></head><body><header><h1>Roundhouse</h1><p>Development runs across enrolled repositories</p></header><main>
<div class="summary"><span><strong>${attention.length}</strong> need attention</span><span><strong>${active.length}</strong> in progress</span><span><strong>${finished.length}</strong> recently finished</span></div>
${section("Needs attention", "Waiting for a person or stopped by a failure", attention)}
${section("In progress", "Work Roundhouse is handling now", active)}
${section("Recently finished", "Completed and cancelled runs", finished)}
<p class="refresh">Showing the 50 most recently updated runs. This page refreshes every 10 seconds.</p></main></body></html>`;
}
