// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { runStages, type Attempt } from "@roundhouse/core";
import type { RunDetails } from "./d1-store.js";
import { formatUsage } from "./usage.js";

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

export function renderRunDetails(details: RunDetails): string {
  const { run, attempts } = details;
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
  const usageForStages = (stages: readonly Attempt["stage"][]) => {
    const attemptIds = new Set(
      attempts
        .filter((attempt) => stages.includes(attempt.stage))
        .map((attempt) => attempt.id),
    );
    return formatUsage(usage.filter((item) => attemptIds.has(item.attemptId)));
  };
  const usageForStage = (stage: Attempt["stage"]) => usageForStages([stage]);
  const commit = (
    stage: string,
    field: "baseCommit" | "expectedHead" | "acceptedHead",
  ) => [...attempts].reverse().find((item) => item.stage === stage)?.[field];
  const stageUsage = runStages
    .map(
      (stage) =>
        `<dt>${escapeHtml(stage)}</dt><dd>${escapeHtml(usageForStage(stage))}</dd>`,
    )
    .join("");
  const rows = [...attempts]
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    )
    .map(
      (
        attempt,
      ) => `<details><summary><span class="phase">${escapeHtml(attempt.stage)}</span><span><span class="label">Started</span>${escapeHtml(timestamp(attempt.createdAt))}</span><span><span class="label">Elapsed</span>${escapeHtml(elapsed(attempt.createdAt, attempt.updatedAt))}</span><span><span class="label">Status</span>${escapeHtml(attempt.state)}</span></summary><div class="attempt-details">
<dl><dt>Role</dt><dd>${escapeHtml(attempt.role ?? "Unavailable")}</dd><dt>Revision</dt><dd>${escapeHtml(attempt.runRevision ?? "Unavailable")}</dd><dt>Updated</dt><dd>${escapeHtml(timestamp(attempt.updatedAt))}</dd><dt>Base commit</dt><dd><code>${escapeHtml(attempt.baseCommit ?? "Unavailable")}</code></dd><dt>Expected head</dt><dd><code>${escapeHtml(attempt.expectedHead ?? "Unavailable")}</code></dd><dt>Accepted head</dt><dd><code>${escapeHtml(attempt.acceptedHead ?? "Unavailable")}</code></dd></dl>
<h4>Model usage</h4><p>${escapeHtml(formatUsage(usage.filter((item) => item.attemptId === attempt.id)))}</p><p>${escapeHtml([...new Set(usage.filter((item) => item.attemptId === attempt.id).map((item) => item.model))].join(", ") || "Model unavailable")}</p><h4>Model routing</h4>${value(attempt.routing)}<h4>Result</h4>${attemptResult(attempt)}${attemptLinks(attempt)}</div></details>`,
    )
    .join("");
  const sectionData: readonly (readonly [
    string,
    readonly Attempt["stage"][],
    unknown,
  ])[] = [
    ["Qualification", ["qualify"], resultFor(attempts, "qualification")],
    ["Reproduction", ["reproduce"], resultFor(attempts, "reproduction")],
    ["Plan", ["plan"], resultFor(attempts, "plan")],
    [
      "Implementation and validation",
      ["implement", "validate"],
      resultFor(attempts, "implementation"),
    ],
    ["Review", ["review"], resultFor(attempts, "review")],
    ["CI checks", ["ci"], resultFor(attempts, "ci")],
    ["Merge", ["merge"], resultFor(attempts, "merge")],
  ];
  const sections = sectionData
    .map(
      ([heading, stages, content]) =>
        `<section><h2>${heading}</h2><p><strong>Usage:</strong> ${escapeHtml(usageForStages(stages))}</p>${heading === "CI checks" ? ciResult(content) : value(content)}</section>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Roundhouse run ${escapeHtml(run.repository)}#${escapeHtml(run.issueNumber)}</title><style>body{font:16px system-ui;line-height:1.5;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#202124}h1,h2{line-height:1.2}section{border-top:1px solid #ddd;padding:1rem 0}details{border-top:1px solid #ddd}summary{cursor:pointer;display:grid;grid-template-columns:1.2fr 2fr 1fr 1fr;gap:1rem;padding:1rem;align-items:center}summary:hover{background:#f6f8fa}.phase{font-weight:700}.label{display:block;color:#666;font-size:.75rem;text-transform:uppercase}.attempt-details{padding:0 1rem 1rem 2rem;border-left:3px solid #ddd;margin-left:1rem}dl{display:grid;grid-template-columns:10rem 1fr;gap:.35rem 1rem}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}pre{background:#f6f8fa;padding:1rem;overflow:auto;white-space:pre-wrap}.muted{color:#666}code{overflow-wrap:anywhere}@media(max-width:700px){summary{grid-template-columns:1fr 1fr}.phase{grid-column:1/-1}}</style></head><body>
<p><a href="/">← Dashboard</a></p><h1>Roundhouse run details</h1><p>${escapeHtml(run.repository)} issue ${escapeHtml(run.issueNumber)}</p>
<dl><dt>Status</dt><dd>${escapeHtml(run.status)}</dd><dt>Current stage</dt><dd>${escapeHtml(run.stage)}</dd><dt>Total usage</dt><dd>${escapeHtml(formatUsage(usage))}</dd><dt>Source issue</dt><dd>${link(run.issue?.url, `Issue #${run.issueNumber}`)}</dd><dt>Pull request</dt><dd>${link(prUrl, pr?.number ? `Pull request #${pr.number}` : "Pull request")}${prUrl ? ` · ${link(`${prUrl}/files`, "Files changed")}` : ""}</dd><dt>Created</dt><dd>${escapeHtml(new Date(details.createdAt).toISOString())}</dd><dt>Updated</dt><dd>${escapeHtml(new Date(details.updatedAt).toISOString())}</dd></dl>
<section><h2>Issue</h2><h3>${escapeHtml(run.issue?.title ?? "Unavailable")}</h3>${value(run.issue?.body)}</section><section><h2>Commit trace</h2><dl><dt>Base</dt><dd><code>${escapeHtml(run.baseCommit)}</code></dd><dt>Implementation candidate</dt><dd><code>${escapeHtml(commit("implement", "acceptedHead") ?? "Unavailable")}</code></dd><dt>Reviewed</dt><dd><code>${escapeHtml(commit("review", "expectedHead") ?? "Unavailable")}</code></dd><dt>CI-checked</dt><dd><code>${escapeHtml(commit("ci", "expectedHead") ?? "Unavailable")}</code></dd><dt>Merged</dt><dd><code>${escapeHtml(commit("merge", "acceptedHead") ?? "Unavailable")}</code></dd></dl></section><section><h2>Usage by workflow step</h2><dl>${stageUsage}</dl></section>${sections}<section><h2>Attempt history</h2>${rows || '<p class="muted">No attempts recorded.</p>'}</section></body></html>`;
}
