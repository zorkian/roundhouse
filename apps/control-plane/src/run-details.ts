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

function usageTable(items: NonNullable<RunDetails["usage"]>): string {
  if (!items.length) return '<p class="muted">No model calls recorded.</p>';
  return `<table><thead><tr><th>Provider</th><th>Configured model</th><th>Actual model</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>${items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.provider ?? "Unavailable")}</td><td>${escapeHtml(item.configuredModel ?? "Unavailable")}</td><td>${escapeHtml(item.model)}</td><td>${escapeHtml(formatUsage([item]))}</td><td>${escapeHtml(item.costUsd === undefined ? "Unavailable" : `$${item.costUsd.toFixed(6)}`)}</td></tr>`,
    )
    .join("")}</tbody></table>`;
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
  return `<span class="usage-hint" tabindex="0" aria-label="${escapeHtml(`${formatUsage(usage)}. ${breakdown}`)}">${escapeHtml(formatUsage(usage))}<span class="usage-breakdown" aria-hidden="true">${escapeHtml(breakdown)}</span></span>`;
}

function executionDisplay(
  details: RunDetails,
  attempt: RunDetails["attempts"][number],
): string {
  const starts = (details.events ?? [])
    .filter(
      (event) =>
        event.attemptId === attempt.id &&
        event.kind === "attempt_progress" &&
        event.payload.phase === "workspace_started",
    )
    .sort((left, right) => left.createdAt - right.createdAt);
  if (!starts.length) return "";
  const expiries = (details.events ?? [])
    .filter(
      (event) =>
        event.attemptId === attempt.id &&
        event.kind === "attempt_lease_expired",
    )
    .sort((left, right) => left.createdAt - right.createdAt);
  const usage = details.usage ?? [];
  const episodes = starts.map((start, index) => {
    const nextStart = starts[index + 1]?.createdAt;
    const expiry = expiries.find(
      (event) =>
        event.createdAt >= start.createdAt &&
        (nextStart === undefined || event.createdAt < nextStart),
    );
    const active =
      !expiry &&
      index === starts.length - 1 &&
      details.run.status === "active" &&
      attempt.state !== "completed" &&
      attempt.state !== "failed";
    const end =
      expiry?.createdAt ??
      (active ? undefined : (nextStart ?? attempt.updatedAt));
    // Calls finishing while an interrupted workspace is being torn down still
    // belong to that execution, up until the replacement workspace starts.
    const usageEnd = expiry ? (nextStart ?? attempt.updatedAt) : end;
    const episodeUsage = usage.filter(
      (item) =>
        item.attemptId === attempt.id &&
        item.createdAt !== undefined &&
        item.createdAt >= start.createdAt &&
        (usageEnd === undefined ||
          item.createdAt < usageEnd ||
          (expiry !== undefined &&
            nextStart === undefined &&
            item.createdAt === usageEnd)),
    );
    const finalOutcome =
      attempt.state === "failed"
        ? "Failed"
        : details.run.status === "cancelled"
          ? "Cancelled"
          : "Completed";
    const outcome = expiry
      ? "Interrupted"
      : active
        ? index > 0
          ? "Restarted · In progress"
          : "In progress"
        : index > 0
          ? `Restarted · ${finalOutcome}`
          : finalOutcome;
    const models =
      [...new Set(episodeUsage.map((item) => item.model))].join(", ") ||
      "Model unavailable";
    return `<li class="execution"><h5>Execution ${index + 1}</h5><dl><dt>Started</dt><dd>${escapeHtml(timestamp(start.createdAt))}</dd><dt>${active ? "State" : "Ended"}</dt><dd>${active ? "Active" : escapeHtml(timestamp(end))}</dd><dt>Elapsed</dt><dd>${escapeHtml(elapsed(start.createdAt, active ? attempt.updatedAt : end))}</dd><dt>Outcome</dt><dd>${escapeHtml(outcome)}</dd><dt>Model calls</dt><dd>${episodeUsage.length}</dd><dt>Usage</dt><dd>${usageDisplay(episodeUsage)}</dd><dt>Models</dt><dd>${escapeHtml(models)}</dd></dl></li>`;
  });
  return `<h4>Executions</h4><ol class="executions">${episodes.join("")}</ol>`;
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
  const profileSection = run.profile
    ? `<section><h2>Repository profile</h2><dl><dt>Source path</dt><dd><code>${escapeHtml(run.profile.sourcePath)}</code></dd><dt>Source commit</dt><dd><code>${escapeHtml(run.profile.sourceCommit)}</code></dd><dt>Schema version</dt><dd>${escapeHtml(run.profile.version)}</dd><dt>Profile hash</dt><dd><code>${escapeHtml(run.profile.hash)}</code></dd><dt>Allowed paths</dt><dd>${value(run.profile.paths.allowed)}</dd><dt>Protected paths</dt><dd>${value(run.profile.paths.protected)}</dd></dl></section>`
    : `<section><h2>Repository profile</h2><p class="muted">${escapeHtml(run.profileError ?? "No profile snapshot is available for this run.")}</p></section>`;
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
${executionDisplay(details, attempt)}<h4>Model usage total</h4><p>${usageDisplay(usage.filter((item) => item.attemptId === attempt.id))}</p>${usageTable(usage.filter((item) => item.attemptId === attempt.id))}<h4>Model routing</h4>${value(attempt.routing)}<h4>Result</h4>${attemptResult(attempt)}${attemptLinks(attempt)}</div></details>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(issueTitle)}</title><style>body{font:16px system-ui;line-height:1.5;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#202124}h1,h2{line-height:1.2}section{border-top:1px solid #ddd;padding:1rem 0}details{border-top:1px solid #ddd}summary{cursor:pointer;display:grid;grid-template-columns:.6fr 1.2fr 2fr 1fr 1fr;gap:1rem;padding:1rem;align-items:center}summary:hover{background:#f6f8fa}.phase{font-weight:700}.label{display:block;color:#666;font-size:.75rem;text-transform:uppercase}.attempt-details{padding:0 1rem 1rem 2rem;border-left:3px solid #ddd;margin-left:1rem}dl{display:grid;grid-template-columns:10rem 1fr;gap:.35rem 1rem}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #ddd;padding:.4rem}pre{background:#f6f8fa;padding:1rem;overflow:auto;white-space:pre-wrap}.muted{color:#666}code{overflow-wrap:anywhere}.status{display:inline-block;border-radius:999px;padding:.15rem .55rem;font-weight:700}.status.active{background:#e6f0ff;color:#175cd3}.status.waiting{background:#fff4d6;color:#8a5b00}.status.succeeded{background:#e8f7ee;color:#087443}.status.failed{background:#fee9e7;color:#b42318}.status.cancelled{background:#eef1f5;color:#344054}.usage-hint{border-bottom:1px dotted currentColor;cursor:help;display:inline-block;position:relative}.usage-breakdown{background:#202124;border-radius:.25rem;bottom:calc(100% + .35rem);color:#fff;font-size:.875rem;left:0;opacity:0;padding:.4rem .6rem;pointer-events:none;position:absolute;visibility:hidden;white-space:nowrap;z-index:1}.usage-hint:hover .usage-breakdown,.usage-hint:focus .usage-breakdown{opacity:1;visibility:visible}@media(max-width:700px){body{margin:1rem auto;padding:0 .75rem}summary{grid-template-columns:1fr 1fr}.phase{grid-column:auto}dl{grid-template-columns:minmax(0,1fr)}dd{margin-bottom:.5rem}.attempt-details{padding:0 0 1rem .75rem;margin-left:0;min-width:0}table{display:block;overflow-x:auto}}</style></head><body>
<p><a href="/">← Dashboard</a></p><h1>${escapeHtml(issueTitle)}</h1><p>${escapeHtml(run.repository)} issue ${escapeHtml(run.issueNumber)}</p>
<dl><dt>Status</dt><dd><span class="status ${escapeHtml(run.status)}">${escapeHtml(statusLabels[run.status])}</span></dd><dt>Current stage</dt><dd>${escapeHtml(currentStage)}</dd><dt>Authored candidate head</dt><dd><code>${escapeHtml(run.candidateHead ?? "Unavailable")}</code></dd><dt>Reviewed candidate head</dt><dd><code>${escapeHtml(run.reviewedHead ?? "Unavailable")}</code></dd><dt>Target base head</dt><dd><code>${escapeHtml(run.targetBaseHead ?? "Unavailable")}</code></dd><dt>Validated integration head</dt><dd><code>${escapeHtml(run.integrationHead ?? "Unavailable")}</code></dd><dt>Elapsed</dt><dd>${escapeHtml(elapsed(details.createdAt, details.updatedAt))}</dd><dt>Total usage</dt><dd>${usageDisplay(usage)}</dd><dt>Source issue</dt><dd>${link(run.issue?.url, `Issue #${run.issueNumber}`)}</dd><dt>Pull request</dt><dd>${link(prUrl, pr?.number ? `Pull request #${pr.number}` : "Pull request")}${prUrl ? ` · ${link(`${prUrl}/files`, "Files changed")}` : ""}</dd><dt>Created</dt><dd>${escapeHtml(new Date(details.createdAt).toISOString())}</dd><dt>Updated</dt><dd>${escapeHtml(new Date(details.updatedAt).toISOString())}</dd></dl>
<section><h2>Attempt history</h2>${rows || '<p class="muted">No attempts recorded.</p>'}</section>${profileSection}</body></html>`;
}
