// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ModelUsageSummary } from "./usage.js";

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

function renderChart(summary: ModelUsageSummary): string {
  const models = summary.models.map((model) => model.model);
  const color = new Map(
    models.map((model, index) => [model, palette[index % palette.length]!]),
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
        .map((model) => {
          const value = day.tokensByModel[model] ?? 0;
          if (!value) return "";
          const segmentHeight = (value / maxTokens) * chartHeight;
          y -= segmentHeight;
          return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${segmentHeight.toFixed(2)}" fill="${color.get(model)}"/>`;
        })
        .join("");
      const label = `${day.day}: ${models
        .map(
          (model) =>
            `${model} ${(day.tokensByModel[model] ?? 0).toLocaleString("en-US")} tokens`,
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
      (model) =>
        `<li><span class="swatch" style="background:${color.get(model)}"></span>${escapeHtml(model)}</li>`,
    )
    .join("");
  return `<figure class="chart">
<figcaption id="chart-caption">Daily tokens used per model over the past 30 days</figcaption>
<div class="chart-scroll" role="region" aria-label="Daily tokens per model bar chart; scroll horizontally to view all days on narrow screens" tabindex="0"><svg viewBox="0 0 ${width} ${height}" role="list" aria-labelledby="chart-caption" preserveAspectRatio="xMidYMid meet">${bars}${axisLabels}</svg></div>
<ul class="legend">${legend}</ul>
${summary.callsWithoutTokens ? `<p class="note">${summary.callsWithoutTokens} of ${summary.calls} calls have no token data and are not shown in the chart.</p>` : ""}
</figure>`;
}

export function renderModelUsage(
  summary: ModelUsageSummary,
  user: { readonly githubLogin: string },
): string {
  const modelRows = summary.models
    .map(
      (model) =>
        `<tr><th scope="row">${escapeHtml(model.model)}</th><td>${model.calls.toLocaleString("en-US")}</td><td>${tokens(model.total.totalTokens)}${model.total.totalTokens === undefined ? " (partial data)" : ""}</td><td>${cost(model.total.costUsd)}${model.total.costUsd === undefined ? " (partial data)" : ""}</td></tr>`,
    )
    .join("");
  const table = summary.calls
    ? `<table><caption>Usage by model for the past 30 days</caption><thead><tr><th scope="col">Model</th><th scope="col">Calls</th><th scope="col">Tokens</th><th scope="col">Estimated cost</th></tr></thead><tbody>${modelRows}</tbody></table>`
    : '<p class="empty">No model usage was recorded in this 30-day window.</p>';
  const partial: string[] = [];
  if (summary.calls && summary.overall.totalTokens === undefined)
    partial.push("some calls have no token data, so token totals are partial");
  if (summary.calls && summary.overall.costUsd === undefined)
    partial.push("some calls have no cost data, so cost totals are partial");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Model usage · Roundhouse</title><style>
:root{color-scheme:light;--ink:#18212f;--muted:#647084;--line:#dde3ea;--paper:#fff;--wash:#f4f7fa}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}a{color:inherit}header{background:#18212f;color:white;padding:2.25rem max(1.25rem,calc((100% - 1080px)/2))}header p{color:#bdc7d5;margin:.35rem 0 0}.heading{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap}h1{font-size:2rem;margin:0;letter-spacing:-.025em}main{max-width:1080px;margin:0 auto;padding:1.5rem 1.25rem 4rem}.summary{display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1.5rem}.summary span{background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:.45rem .8rem}.summary strong{margin-right:.35rem}section{background:var(--paper);border:1px solid var(--line);border-radius:12px;margin:0 0 1rem;padding:1rem 1.2rem}h2{font-size:1.05rem;margin:0 0 .5rem}.chart{margin:0}.chart svg{width:100%;height:auto;display:block}.legend{list-style:none;display:flex;gap:1rem;flex-wrap:wrap;padding:0;margin:.6rem 0 0;font-size:.85rem}.legend li{display:flex;align-items:center;gap:.4rem}.swatch{display:inline-block;width:.8rem;height:.8rem;border-radius:2px}.note{color:var(--muted);font-size:.85rem;margin:.5rem 0 0}table{width:100%;border-collapse:collapse;font-size:.9rem}caption{text-align:left;font-weight:700;margin-bottom:.5rem}th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid var(--line)}tbody th{font-weight:600}.empty{color:var(--muted);margin:0}.range{color:var(--muted)}.partial{color:#8a5b00;font-size:.85rem}@media(max-width:650px){section{padding:.9rem}th,td{padding:.45rem .35rem;font-size:.82rem}.chart-scroll{overflow-x:auto}.chart-scroll svg{min-width:640px}.chart-scroll:focus-visible{outline:2px solid #175cd3;outline-offset:2px}}
</style></head><body><header><div class="heading"><h1>Model usage</h1></div><p>Signed in as ${escapeHtml(user.githubLogin)} · <a href="/">Dashboard</a> · <a href="/auth/sign-out">Sign out</a></p></header><main>
<p class="range">Rolling 30-day window: <time datetime="${new Date(summary.startAt).toISOString()}">${escapeHtml(utc(summary.startAt))} UTC</time> – <time datetime="${new Date(summary.endAt).toISOString()}">${escapeHtml(utc(summary.endAt))} UTC</time></p>
<div class="summary"><span><strong>${summary.calls.toLocaleString("en-US")}</strong> model calls</span><span><strong>${tokens(summary.overall.totalTokens)}</strong> tokens</span><span><strong>${cost(summary.overall.costUsd)}</strong> estimated cost</span></div>
${partial.length ? `<p class="partial">Note: ${escapeHtml(partial.join("; "))}.</p>` : ""}
${summary.calls ? `<section><h2>Daily usage</h2>${renderChart(summary)}</section>` : ""}
<section><h2>By model</h2>${table}</section>
</main></body></html>`;
}
