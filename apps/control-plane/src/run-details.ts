// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { Attempt, RunStatus } from "@roundhouse/core";
import type { RunDetails } from "./d1-store.js";
import { formatUsage, formatUsageBreakdown } from "./usage.js";

const escapeHtml = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function link(url: unknown, label: string): string {
  return typeof url === "string" && /^https:\/\//.test(url)
    ? `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`
    : "Unavailable";
}

function value(value: unknown): string {
  if (value === undefined || value === null || value === "")
    return '<p class="muted">Unavailable</p>';
  if (typeof value === "object")
    return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  return `<pre>${escapeHtml(value)}</pre>`;
}

function resultFor(attempts: readonly Attempt[], key: string): unknown {
  return [...attempts]
    .reverse()
    .find((attempt) => attempt.result?.[key] !== undefined)?.result?.[key];
}

function ciResult(valueToRender: unknown): string {
  const ci = valueToRender as
    | {
        checks?: readonly {
          name?: unknown;
          status?: unknown;
          conclusion?: unknown;
          url?: unknown;
        }[];
      }
    | undefined;
  if (!ci?.checks?.length) return value(valueToRender);
  return `${value(ci)}<ul>${ci.checks
    .map(
      (check) =>
        `<li>${link(check.url, String(check.name ?? "Check"))}: ${escapeHtml(check.conclusion ?? check.status ?? "Unavailable")}</li>`,
    )
    .join("")}</ul>`;
}

function timestamp(valueToRender: unknown): string {
  const date = new Date(valueToRender as number);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toISOString();
}

function elapsed(start: unknown, end: unknown): string {
  const milliseconds = Number(end) - Number(start);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "Unavailable";
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const seconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return [hours && `${hours}h`, minutes && `${minutes}m`, `${remainder}s`]
    .filter(Boolean)
    .join(" ");
}

function attemptResult(attempt: Attempt): string {
  const ci = attempt.result?.ci;
  return ci === undefined ? value(attempt.result) : ciResult(ci);
}

function attemptLinks(attempt: Attempt): string {
  const result = attempt.result as
    | Record<
        string,
        { pullRequest?: { html_url?: string; number?: number } } | undefined
      >
    | undefined;
  const pullRequest = Object.values(result ?? {}).find(
    (entry) => entry?.pullRequest,
  )?.pullRequest;
  if (!pullRequest) return "";
  return `<h4>Related links</h4><p>${link(pullRequest.html_url, pullRequest.number ? `Pull request #${pullRequest.number}` : "Pull request")}</p>`;
}

const statusLabels: Record<RunStatus, string> = {
  active: "In progress",
  waiting: "Waiting",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

function usageDisplay(items: RunDetails["usage"]): string {
  const usage = items ?? [];
  if (!usage.length) return escapeHtml(formatUsage(usage));
  const breakdown = formatUsageBreakdown(usage);
  return `<span class="usage-hint" tabindex="0" title="${escapeHtml(breakdown)}" aria-label="${escapeHtml(`${formatUsage(usage)}. ${breakdown}`)}">${escapeHtml(formatUsage(usage))}</span>`;
}

export function renderRunDetails(details: RunDetails): string {
  const { run, attempts } = details;
  const issueTitle = run.issue?.title?.trim() || `Issue #${run.issueNumber}`;
  const qualification = resultFor(attempts, "qualification") as
    { classification?: unknown } | undefined;
  const requestClassification = [...attempts]
    .reverse()
    .find((attempt) => attempt.result?.requestClassification !== undefined)
    ?.result?.requestClassification;
  const investigationHeading = ["feature", "maintenance"].includes(
    String(requestClassification ?? qualification?.classification),
  )
    ? "Current behavior"
    : "Reproduction";
  const stageLabel = (stage: Attempt["stage"]) =>
    stage === "reproduce" ? investigationHeading : stage;
  const currentStage = stageLabel(run.stage);
  const usage = details.usage ?? [];
  const pullRequest = resultFor(attempts, "merge") as
    { pullRequest?: { html_url?: string; number?: number } } | undefined;
  const implementation = resultFor(attempts, "implementation") as
    { pullRequest?: { html_url?: string; number?: number } } | undefined;
  const ci = resultFor(attempts, "ci") as
    { pullRequest?: { html_url?: string; number?: number } } | undefined;
  const pr =
    pullRequest?.pullRequest ?? implementation?.pullRequest ?? ci?.pullRequest;
  const prUrl = pr?.html_url;
  const rows = [...attempts]
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    )
    .map(
      (
        attempt,
      ) => `<details><summary><span><span class="label">Revision</span>${escapeHtml(attempt.runRevision ?? "Unavailable")}</span><span class="phase">${escapeHtml(stageLabel(attempt.stage))}</span><span><span class="label">Started</span>${escapeHtml(timestamp(attempt.createdAt))}</span><span><span class="label">Elapsed</span>${escapeHtml(elapsed(attempt.createdAt, attempt.updatedAt))}</span><span><span class="label">Status</span>${escapeHtml(attempt.state)}</span></summary><div class="attempt-details">
<dl><dt>Role</dt><dd>${escapeHtml(attempt.role ?? "Unavailable")}</dd><dt>Revision</dt><dd>${escapeHtml(attempt.runRevision ?? "Unavailable")}</dd><dt>Updated</dt><dd>${escapeHtml(timestamp(attempt.updatedAt))}</dd><dt>Base commit</dt><dd><code>${escapeHtml(attempt.baseCommit ?? "Unavailable")}</code></dd><dt>Expected head</dt><dd><code>${escapeHtml(attempt.expectedHead ?? "Unavailable")}</code></dd><dt>Accepted head</dt><dd><code>${escapeHtml(attempt.acceptedHead ?? "Unavailable")}</code></dd></dl>
<h4>Model usage</h4><p>${usageDisplay(usage.filter((item) => item.attemptId === attempt.id))}</p><p>${escapeHtml([...new Set(usage.filter((item) => item.attemptId === attempt.id).map((item) => item.model))].join(", ") || "Model unavailable")}</p><h4>Model routing</h4>${value(attempt.routing)}<h4>Result</h4>${attemptResult(attempt)}${attemptLinks(attempt)}</div></details>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(issueTitle)}</title><style>body{font:16px system-ui;line-height:1.5;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#202124}h1,h2{line-height:1.2}section{border-top:1px solid #ddd;padding:1rem 0}details{border-top:1px solid #ddd}summary{cursor:pointer;display:grid;grid-template-columns:.6fr 1.2fr 2fr 1fr 1fr;gap:1rem;padding:1rem;align-items:center}summary:hover{background:#f6f8fa}.phase{font-weight:700}.label{display:block;color:#666;font-size:.75rem;text-transform:uppercase}.attempt-details{padding:0 1rem 1rem 2rem;border-left:3px solid #ddd;margin-left:1rem}dl{display:grid;grid-template-columns:10rem 1fr;gap:.35rem 1rem}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}pre{background:#f6f8fa;padding:1rem;overflow:auto;white-space:pre-wrap}.muted{color:#666}code{overflow-wrap:anywhere}.status{display:inline-block;border-radius:999px;padding:.15rem .55rem;font-weight:700}.status.active{background:#e6f0ff;color:#175cd3}.status.waiting{background:#fff4d6;color:#8a5b00}.status.succeeded{background:#e8f7ee;color:#087443}.status.failed{background:#fee9e7;color:#b42318}.status.cancelled{background:#eef1f5;color:#344054}.usage-hint{border-bottom:1px dotted currentColor;cursor:help}@media(max-width:700px){summary{grid-template-columns:1fr 1fr}.phase{grid-column:auto}}</style></head><body>
<p><a href="/">← Dashboard</a></p><h1>${escapeHtml(issueTitle)}</h1><p>${escapeHtml(run.repository)} issue ${escapeHtml(run.issueNumber)}</p>
<dl><dt>Status</dt><dd><span class="status ${escapeHtml(run.status)}">${escapeHtml(statusLabels[run.status])}</span></dd><dt>Current stage</dt><dd>${escapeHtml(currentStage)}</dd><dt>Elapsed</dt><dd>${escapeHtml(elapsed(details.createdAt, details.updatedAt))}</dd><dt>Total usage</dt><dd>${usageDisplay(usage)}</dd><dt>Source issue</dt><dd>${link(run.issue?.url, `Issue #${run.issueNumber}`)}</dd><dt>Pull request</dt><dd>${link(prUrl, pr?.number ? `Pull request #${pr.number}` : "Pull request")}${prUrl ? ` · ${link(`${prUrl}/files`, "Files changed")}` : ""}</dd><dt>Created</dt><dd>${escapeHtml(new Date(details.createdAt).toISOString())}</dd><dt>Updated</dt><dd>${escapeHtml(new Date(details.updatedAt).toISOString())}</dd></dl>
<section><h2>Attempt history</h2>${rows || '<p class="muted">No attempts recorded.</p>'}</section></body></html>`;
}
