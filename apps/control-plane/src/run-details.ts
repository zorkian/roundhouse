// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { Attempt } from "@roundhouse/core";
import type { RunDetails } from "./d1-store.js";

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

export function renderRunDetails(details: RunDetails): string {
  const { run, attempts } = details;
  const pullRequest = resultFor(attempts, "merge") as
    { pullRequest?: { html_url?: string; number?: number } } | undefined;
  const implementation = resultFor(attempts, "implementation") as
    { pullRequest?: { html_url?: string; number?: number } } | undefined;
  const ci = resultFor(attempts, "ci") as
    { pullRequest?: { html_url?: string; number?: number } } | undefined;
  const pr =
    pullRequest?.pullRequest ?? implementation?.pullRequest ?? ci?.pullRequest;
  const prUrl = pr?.html_url;
  const commit = (
    stage: string,
    field: "baseCommit" | "expectedHead" | "acceptedHead",
  ) => [...attempts].reverse().find((item) => item.stage === stage)?.[field];
  const rows = attempts
    .map(
      (
        attempt,
      ) => `<article><h3>${escapeHtml(attempt.stage)} · ${escapeHtml(attempt.state)}</h3>
<dl><dt>Role</dt><dd>${escapeHtml(attempt.role)}</dd><dt>Revision</dt><dd>${escapeHtml(attempt.runRevision)}</dd><dt>Created</dt><dd>${escapeHtml(new Date(attempt.createdAt).toISOString())}</dd><dt>Updated</dt><dd>${escapeHtml(new Date(attempt.updatedAt).toISOString())}</dd><dt>Base commit</dt><dd><code>${escapeHtml(attempt.baseCommit)}</code></dd><dt>Expected head</dt><dd><code>${escapeHtml(attempt.expectedHead)}</code></dd><dt>Accepted head</dt><dd><code>${escapeHtml(attempt.acceptedHead ?? "Unavailable")}</code></dd></dl>
<h4>Model routing</h4>${value(attempt.routing)}<h4>Result</h4>${value(attempt.result)}</article>`,
    )
    .join("");
  const sectionData: readonly (readonly [string, unknown])[] = [
    ["Qualification", resultFor(attempts, "qualification")],
    ["Reproduction", resultFor(attempts, "reproduction")],
    ["Plan", resultFor(attempts, "plan")],
    ["Implementation and validation", resultFor(attempts, "implementation")],
    ["Review", resultFor(attempts, "review")],
    ["CI checks", resultFor(attempts, "ci")],
    ["Merge", resultFor(attempts, "merge")],
  ];
  const sections = sectionData
    .map(
      ([heading, content]) =>
        `<section><h2>${heading}</h2>${heading === "CI checks" ? ciResult(content) : value(content)}</section>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Roundhouse run ${escapeHtml(run.repository)}#${escapeHtml(run.issueNumber)}</title><style>body{font:16px system-ui;line-height:1.5;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#202124}h1,h2{line-height:1.2}section,article{border-top:1px solid #ddd;padding:1rem 0}dl{display:grid;grid-template-columns:10rem 1fr;gap:.35rem 1rem}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}pre{background:#f6f8fa;padding:1rem;overflow:auto;white-space:pre-wrap}.muted{color:#666}code{overflow-wrap:anywhere}</style></head><body>
<h1>Roundhouse run details</h1><p>${escapeHtml(run.repository)} issue ${escapeHtml(run.issueNumber)}</p>
<dl><dt>Status</dt><dd>${escapeHtml(run.status)}</dd><dt>Current stage</dt><dd>${escapeHtml(run.stage)}</dd><dt>Source issue</dt><dd>${link(run.issue?.url, `Issue #${run.issueNumber}`)}</dd><dt>Pull request</dt><dd>${link(prUrl, pr?.number ? `Pull request #${pr.number}` : "Pull request")}${prUrl ? ` · ${link(`${prUrl}/files`, "Files changed")}` : ""}</dd><dt>Created</dt><dd>${escapeHtml(new Date(details.createdAt).toISOString())}</dd><dt>Updated</dt><dd>${escapeHtml(new Date(details.updatedAt).toISOString())}</dd></dl>
<section><h2>Issue</h2><h3>${escapeHtml(run.issue?.title ?? "Unavailable")}</h3>${value(run.issue?.body)}</section><section><h2>Commit trace</h2><dl><dt>Base</dt><dd><code>${escapeHtml(run.baseCommit)}</code></dd><dt>Implementation candidate</dt><dd><code>${escapeHtml(commit("implement", "acceptedHead") ?? "Unavailable")}</code></dd><dt>Reviewed</dt><dd><code>${escapeHtml(commit("review", "expectedHead") ?? "Unavailable")}</code></dd><dt>CI-checked</dt><dd><code>${escapeHtml(commit("ci", "expectedHead") ?? "Unavailable")}</code></dd><dt>Merged</dt><dd><code>${escapeHtml(commit("merge", "acceptedHead") ?? "Unavailable")}</code></dd></dl></section>
${sections}<section><h2>Attempt history</h2>${rows || '<p class="muted">No attempts recorded.</p>'}</section></body></html>`;
}
