// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ModelUsageSummary } from "./usage.js";
import {
  renderSiteHeader,
  sharedHeaderStyles,
  type HeaderAccount,
} from "./ui-header.js";

const escapeHtml = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const palette = [
  "#175cd3",
  "#c9472f",
  "#087443",
  "#8a5b00",
  "#6d4bc4",
  "#b42318",
  "#0e7490",
  "#a03d7a",
];

const tokens = (value: number | undefined) =>
  value === undefined ? "unavailable" : value.toLocaleString("en-US");
const cost = (value: number | undefined) =>
  value === undefined ? "unavailable" : `$${value.toFixed(2)}`;
const utc = (value: number) =>
  new Date(value).toLocaleString("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  });

const outcomeLabel = (item: {
  readonly succeededCalls: number;
  readonly failedCalls: number;
  readonly unknownOutcomeCalls: number;
}) =>
  [
    item.succeededCalls &&
      `${item.succeededCalls.toLocaleString("en-US")} succeeded`,
    item.failedCalls && `${item.failedCalls.toLocaleString("en-US")} failed`,
    item.unknownOutcomeCalls &&
      `${item.unknownOutcomeCalls.toLocaleString("en-US")} unknown`,
  ]
    .filter(Boolean)
    .join(" · ") || "0 recorded";
const displayEffort = (effort: string) =>
  effort === "unknown" ? "Unknown (not recorded)" : effort;

function renderChart(summary: ModelUsageSummary): string {
  const models = summary.models.map((model) => ({
    key: `${model.model} · ${model.resolvedEffort}`,
    label: `${model.model} · ${displayEffort(model.resolvedEffort)}`,
  }));
  const color = new Map(
    models.map(({ key }, index) => [key, palette[index % palette.length]!]),
  );
  const maxTokens = Math.max(
    1,
    ...summary.days.map((day) =>
      Object.values(day.tokensByModel).reduce((a, b) => a + b, 0),
    ),
  );
  const width = 900;
  const height = 240;
  const top = 12;
  const bottom = 30;
  const chartHeight = height - top - bottom;
  const gap = 3;
  const barWidth = Math.max(
    1,
    (width - gap * (summary.days.length - 1)) / summary.days.length,
  );
  const bars = summary.days
    .map((day, index) => {
      let y = top + chartHeight;
      const x = index * (barWidth + gap);
      const segments = models
        .map(({ key }) => {
          const value = day.tokensByModel[key] ?? 0;
          if (!value) return "";
          const segmentHeight = (value / maxTokens) * chartHeight;
          y -= segmentHeight;
          return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${segmentHeight.toFixed(2)}" fill="${color.get(key)}"/>`;
        })
        .join("");
      const label = `${day.day}: ${models
        .map(
          ({ key, label }) =>
            `${label} ${(day.tokensByModel[key] ?? 0).toLocaleString("en-US")} tokens`,
        )
        .join(
          ", ",
        )}${day.callsWithoutTokens ? `, ${day.callsWithoutTokens} calls without token data` : ""}`;
      return `<g role="listitem" aria-label="${escapeHtml(label)}"><title>${escapeHtml(label)}</title>${segments}</g>`;
    })
    .join("");
  const axisLabels = [
    0,
    Math.floor((summary.days.length - 1) / 2),
    summary.days.length - 1,
  ]
    .map((index) => {
      const day = summary.days[index];
      return day
        ? `<text x="${(index * (barWidth + gap)).toFixed(2)}" y="${height - 8}" font-size="11" fill="#647084">${escapeHtml(day.day)}</text>`
        : "";
    })
    .join("");
  const legend = models
    .map(
      ({ key, label }) =>
        `<li><span class="swatch" style="background:${color.get(key)}"></span>${escapeHtml(label)}</li>`,
    )
    .join("");
  return `<figure class="chart">
<figcaption id="chart-caption">Daily tokens used per model and resolved effort over the past 30 days</figcaption>
<div class="chart-scroll" role="region" aria-label="Daily tokens per model bar chart; scroll horizontally to view all days on narrow screens" tabindex="0"><svg viewBox="0 0 ${width} ${height}" role="list" aria-labelledby="chart-caption" preserveAspectRatio="xMidYMid meet">${bars}${axisLabels}</svg></div>
<ul class="legend">${legend}</ul>
${summary.callsWithoutTokens ? `<p class="note">${summary.callsWithoutTokens} of ${summary.calls} calls have no token data and are not shown in the chart.</p>` : ""}
</figure>`;
}

export function renderModelUsage(
  summary: ModelUsageSummary,
  user: HeaderAccount,
): string {
  const modelRows = summary.models
    .map((model) => {
      const partialLatency =
        model.latencyCalls !== undefined && model.latencyCalls !== model.calls;
      const partialReasoning =
        model.reasoningCalls !== undefined &&
        model.reasoningCalls !== model.calls;
      const latency =
        model.averageLatencyMs === undefined
          ? "unavailable"
          : `${Math.round(model.averageLatencyMs).toLocaleString("en-US")} ms${partialLatency ? " (partial data)" : ""}`;
      const reasoning =
        model.reasoningTokenShare === undefined
          ? "unavailable"
          : `${(model.reasoningTokenShare * 100).toFixed(1)}%${partialReasoning ? " (partial data)" : ""}`;
      return `<tr><th scope="row">${escapeHtml(model.model)}</th><td><span class="effort">${escapeHtml(displayEffort(model.resolvedEffort))}</span></td><td>${model.calls.toLocaleString("en-US")}</td><td>${escapeHtml(outcomeLabel(model))}</td><td>${tokens(model.total.totalTokens)}${model.total.totalTokens === undefined ? " (partial data)" : ""}</td><td>${cost(model.total.costUsd)}${model.total.costUsd === undefined ? " (partial data)" : ""}</td><td>${latency}</td><td>${reasoning}</td></tr>`;
    })
    .join("");
  const sourceRows = summary.sources
    .map(
      (source) =>
        `<tr><th scope="row">${source.source === "conversation" ? "Conversations" : "Delivery runs"}</th><td>${source.calls.toLocaleString("en-US")}</td><td>${escapeHtml(outcomeLabel(source))}</td><td>${tokens(source.total.totalTokens)}${source.total.totalTokens === undefined ? " (partial data)" : ""}</td><td>${cost(source.total.costUsd)}${source.total.costUsd === undefined ? " (partial data)" : ""}</td></tr>`,
    )
    .join("");
  const effortOptions = ["", ...summary.efforts]
    .map(
      (effort) =>
        `<option value="${escapeHtml(effort)}"${(summary.effort ?? "") === effort ? " selected" : ""}>${escapeHtml(effort ? displayEffort(effort) : "All efforts")}</option>`,
    )
    .join("");
  const filter = `<form method="get" class="filter"><label for="effort">Resolved effort</label><select id="effort" name="effort">${effortOptions}</select><button type="submit">Filter</button></form>`;
  const table = summary.calls
    ? `<div class="table-scroll" role="region" aria-label="Usage by accounting model and resolved effort; scroll horizontally to view all columns on narrow screens" tabindex="0"><table><caption>Usage by accounting model for the past 30 days, grouped by resolved effort</caption><thead><tr><th scope="col">Accounting model</th><th scope="col">Resolved effort</th><th scope="col">Calls</th><th scope="col">Outcome</th><th scope="col">Tokens</th><th scope="col">Estimated cost</th><th scope="col">Average latency</th><th scope="col">Reasoning share</th></tr></thead><tbody>${modelRows}</tbody></table></div>`
    : '<p class="empty">No model usage was recorded in this 30-day window.</p>';
  const partial: string[] = [];
  if (summary.calls && summary.overall.totalTokens === undefined)
    partial.push("some calls have no token data, so token totals are partial");
  if (summary.calls && summary.overall.costUsd === undefined)
    partial.push("some calls have no cost data, so cost totals are partial");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Model usage · Roundhouse</title><style>
${sharedHeaderStyles}:root{color-scheme:light;--ink:#18212f;--muted:#647084;--line:#dde3ea;--paper:#fff;--wash:#f4f7fa}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}a{color:inherit}h1{font-size:2rem;margin:0 0 1rem;letter-spacing:-.025em}main{max-width:1080px;margin:0 auto;padding:1.5rem 1.25rem 4rem}.summary{display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1.5rem}.filter{display:flex;align-items:center;gap:.5rem;margin:0 0 1rem}.filter select,.filter button{font:inherit;padding:.3rem .45rem}.effort{background:#eef4ff;border-radius:999px;padding:.15rem .45rem;font-size:.82rem}.summary span{background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:.45rem .8rem}.summary strong{margin-right:.35rem}section{background:var(--paper);border:1px solid var(--line);border-radius:12px;margin:0 0 1rem;padding:1rem 1.2rem}h2{font-size:1.05rem;margin:0 0 .5rem}.chart{margin:0}.chart svg{width:100%;height:auto;display:block}.legend{list-style:none;display:flex;gap:1rem;flex-wrap:wrap;padding:0;margin:.6rem 0 0;font-size:.85rem}.legend li{display:flex;align-items:center;gap:.4rem}.swatch{display:inline-block;width:.8rem;height:.8rem;border-radius:2px}.note{color:var(--muted);font-size:.85rem;margin:.5rem 0 0}table{width:100%;border-collapse:collapse;font-size:.9rem}caption{text-align:left;font-weight:700;margin-bottom:.5rem}th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid var(--line)}tbody th{font-weight:600}.table-scroll{max-width:100%;overflow-x:auto}.empty{color:var(--muted);margin:0}.range{color:var(--muted)}.partial{color:#8a5b00;font-size:.85rem}@media(max-width:650px){section{padding:.9rem}th,td{padding:.45rem .35rem;font-size:.82rem}.chart-scroll{overflow-x:auto}.chart-scroll svg,.table-scroll table{min-width:640px}.chart-scroll:focus-visible,.table-scroll:focus-visible{outline:2px solid #175cd3;outline-offset:2px}}
</style></head><body>${renderSiteHeader(user)}<main><h1>Model usage</h1>
<p class="range">Rolling 30-day window: <time datetime="${new Date(summary.startAt).toISOString()}">${escapeHtml(utc(summary.startAt))} UTC</time> – <time datetime="${new Date(summary.endAt).toISOString()}">${escapeHtml(utc(summary.endAt))} UTC</time></p>
${filter}<p class="note">Effort is explanatory metadata: it can affect token consumption, latency, tool use, and quality, but never changes the token rate. Resolved effort is the validated route sent to the provider; provider-reported effort is retained per call when available. Calls without recorded resolved effort are grouped as Unknown (not recorded); this does not infer an effort from current routing.</p>
<div class="summary"><span><strong>${summary.calls.toLocaleString("en-US")}</strong> model calls</span><span><strong>${escapeHtml(outcomeLabel(summary))}</strong> terminal outcome data</span><span><strong>${tokens(summary.overall.totalTokens)}</strong> tokens</span><span><strong>${cost(summary.overall.costUsd)}</strong> estimated cost</span></div>
${partial.length ? `<p class="partial">Note: ${escapeHtml(partial.join("; "))}.</p>` : ""}
${summary.calls ? `<section><h2>Daily usage</h2>${renderChart(summary)}</section>` : ""}
${summary.calls ? `<section><h2>By workload</h2><div class="table-scroll" role="region" aria-label="Conversation and delivery usage; scroll horizontally to view all columns on narrow screens" tabindex="0"><table><caption>Conversation and delivery usage</caption><thead><tr><th scope="col">Workload</th><th scope="col">Calls</th><th scope="col">Outcome</th><th scope="col">Tokens</th><th scope="col">Estimated cost</th></tr></thead><tbody>${sourceRows}</tbody></table></div></section>` : ""}
<section><h2>By model and effort</h2>${table}</section>
</main></body></html>`;
}
