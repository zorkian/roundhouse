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

function validPullRequest(url: unknown): url is string {
  return typeof url === "string" && /^https:\/\//.test(url);
}

function link(url: unknown, label: string): string {
  return validPullRequest(url)
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
  if (
    typeof pullRequest?.html_url !== "string" ||
    !/^https:\/\//.test(pullRequest.html_url)
  )
    return "";
  return `<h4>Related links</h4><p>${link(pullRequest.html_url, pullRequest.number ? `Pull request #${pullRequest.number}` : "Pull request")}</p>`;
}

function resultSummary(attempt: Attempt): string | undefined {
  const result = attempt.result;
  if (!result) return undefined;
  const entries = [result, ...Object.values(result)];
  for (const entry of entries) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as { summary?: unknown }).summary === "string"
    )
      return (entry as { summary: string }).summary;
  }
  return undefined;
}

function stageResultSummary(attempt: Attempt): string {
  const summary = resultSummary(attempt);
  if (summary) return summary;
  const stage = stageLabel(attempt.stage);
  if (attempt.state === "completed") return `${stage} completed.`;
  if (attempt.state === "failed") return `${stage} failed.`;
  return `${stage} is in progress.`;
}

function runStatusSummary(status: RunStatus, stage: string): string {
  switch (status) {
    case "active":
      return `The run is in progress at ${stage}.`;
    case "waiting":
      return `The run is waiting at ${stage}.`;
    case "succeeded":
      return `The run succeeded after ${stage}.`;
    case "failed":
      return `The run failed during ${stage}.`;
    case "cancelled":
      return `The run was cancelled during ${stage}.`;
  }
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

export function stageLabel(stage: Attempt["stage"]): string {
  return stage === "reproduce" ? "investigate" : stage;
}

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

function workflowEvidence(
  details: RunDetails,
  attempt: RunDetails["attempts"][number],
): string {
  const events = (details.events ?? []).filter(
    (event) =>
      event.attemptId === attempt.id &&
      ["workflow_agent_resolved", "workflow_transition"].includes(event.kind),
  );
  if (!events.length) return "";
  const resolved = events.find(
    (event) => event.kind === "workflow_agent_resolved",
  )?.payload;
  const transition = events.find(
    (event) => event.kind === "workflow_transition",
  )?.payload;
  return `<h4>Workflow evidence</h4><dl><dt>Node</dt><dd><code>${escapeHtml(attempt.nodeId ?? "Unavailable")}</code></dd><dt>Executor</dt><dd>${escapeHtml(attempt.executor ?? "Unavailable")}</dd><dt>Resolved contract</dt><dd>${value(resolved)}</dd><dt>Selected transition</dt><dd>${value(transition)}</dd></dl>`;
}

function reviewWorkflowEvidence(details: RunDetails): string {
  const events = (details.events ?? []).filter((event) =>
    ["workflow_review_fanout", "workflow_review_join"].includes(event.kind),
  );
  if (!events.length) return "";
  return `<details class="diagnostics"><summary class="diagnostics-summary">Review workflow evidence</summary>${events
    .map(
      (event) =>
        `<h3>${escapeHtml(event.kind === "workflow_review_fanout" ? "Fan-out" : "Join")}</h3>${value(event.payload)}`,
    )
    .join("")}</details>`;
}

function boundaryWorkflowEvidence(details: RunDetails): string {
  const events = (details.events ?? []).filter(
    (event) => event.kind === "workflow_boundary_audit",
  );
  if (!events.length) return "";
  return `<details class="diagnostics"><summary class="diagnostics-summary">Human and external boundary evidence</summary>${events
    .map((event) => value(event.payload))
    .join("")}</details>`;
}

type DetailsAttempt = RunDetails["attempts"][number];

interface CompetitionGroup {
  readonly nodeId?: string;
  readonly baseRole: string;
  readonly candidates: DetailsAttempt[];
  judge?: DetailsAttempt;
  selected?: DetailsAttempt;
}

// Groups candidate, judge, and promoted attempts by workflow node and base
// role so each competition renders as one panel with per-candidate scores,
// rationales, and usage plus separate judge usage.
function competitionGroups(details: RunDetails): CompetitionGroup[] {
  const groups = new Map<string, CompetitionGroup>();
  for (const attempt of details.attempts) {
    const competition = attempt.competition;
    if (!competition) continue;
    const baseRole =
      competition.purpose === "candidate"
        ? attempt.role.slice(
            0,
            attempt.role.length -
              `-candidate-${competition.candidateId}`.length,
          )
        : competition.purpose === "judge"
          ? attempt.role.slice(0, -"-judge".length)
          : attempt.role;
    const key = `${attempt.nodeId ?? ""}:${baseRole}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        ...(attempt.nodeId ? { nodeId: attempt.nodeId } : {}),
        baseRole,
        candidates: [],
      };
      groups.set(key, group);
    }
    if (competition.purpose === "candidate") group.candidates.push(attempt);
    else if (competition.purpose === "judge") group.judge = attempt;
    else group.selected = attempt;
  }
  return [...groups.values()];
}

function competitionPanels(details: RunDetails): string {
  const groups = competitionGroups(details);
  if (!groups.length) return "";
  const usage = details.usage ?? [];
  const panels = groups.map((group) => {
    const node = group.nodeId
      ? details.run.profile?.workflow?.nodes[group.nodeId]
      : undefined;
    const configured =
      node?.agent?.competition ??
      node?.review?.reviewers.find((reviewer) => reviewer.id === group.baseRole)
        ?.competition;
    const judgement =
      group.selected?.competition?.purpose === "selected"
        ? group.selected.competition.judgement
        : undefined;
    const scoreFor = (candidateId: string) =>
      judgement?.scores.find((score) => score.candidateId === candidateId);
    const candidateIds = configured
      ? configured.candidates.map((candidate) => candidate.id)
      : group.candidates.map((attempt) =>
          attempt.competition?.purpose === "candidate"
            ? attempt.competition.candidateId
            : "",
        );
    const rows = candidateIds.map((candidateId) => {
      const attempt = group.candidates.find(
        (candidate) =>
          candidate.competition?.purpose === "candidate" &&
          candidate.competition.candidateId === candidateId,
      );
      const configuredModel = configured?.candidates.find(
        (candidate) => candidate.id === candidateId,
      )?.model;
      const score = scoreFor(candidateId);
      const winner = judgement?.selected === candidateId;
      return `<tr>${winner ? "<td><strong>Selected</strong></td>" : "<td></td>"}<td><code>${escapeHtml(candidateId)}</code></td><td>${escapeHtml(configuredModel ? `${configuredModel.id} (${configuredModel.reasoning})` : "Unavailable")}</td><td>${escapeHtml(attempt?.routing?.model ?? "Unavailable")}</td><td>${escapeHtml(attempt?.state ?? "pending")}</td><td>${escapeHtml(score ? String(score.score) : "Unavailable")}</td><td>${escapeHtml(score?.rationale ?? "Unavailable")}</td><td>${usageDisplay(usage.filter((item) => item.attemptId === attempt?.id))}</td></tr>`;
    });
    const judgeModel = configured?.judge.model;
    const judgeUsage = usage.filter(
      (item) => item.attemptId === group.judge?.id,
    );
    const judgeRow = `<h4>Judge</h4><dl><dt>Configured model</dt><dd>${escapeHtml(judgeModel ? `${judgeModel.id} (${judgeModel.reasoning})` : "Unavailable")}</dd><dt>Actual model</dt><dd>${escapeHtml(group.judge?.routing?.model ?? "Unavailable")}</dd><dt>Status</dt><dd>${escapeHtml(group.judge?.state ?? "pending")}</dd><dt>Selected candidate</dt><dd><code>${escapeHtml(judgement?.selected ?? "Unavailable")}</code></dd><dt>Usage</dt><dd>${usageDisplay(judgeUsage)}</dd></dl>${usageTable(judgeUsage)}`;
    return `<details class="diagnostics" open><summary class="diagnostics-summary">Model competition · ${escapeHtml(group.nodeId ?? group.baseRole)}</summary><table><thead><tr><th></th><th>Candidate</th><th>Configured model</th><th>Actual model</th><th>Status</th><th>Score</th><th>Rationale</th><th>Usage</th></tr></thead><tbody>${rows.join("")}</tbody></table>${judgeRow}</details>`;
  });
  return `<section><h2>Model competitions</h2>${panels.join("")}</section>`;
}

export function renderRunDetails(details: RunDetails): string {
  const { run, attempts } = details;
  const issueTitle = run.issue?.title?.trim() || `Issue #${run.issueNumber}`;
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
    ? `<details class="diagnostics"><summary class="diagnostics-summary">Repository profile</summary><dl><dt>Source path</dt><dd><code>${escapeHtml(run.profile.sourcePath)}</code></dd><dt>Source commit</dt><dd><code>${escapeHtml(run.profile.sourceCommit)}</code></dd><dt>Schema version</dt><dd>${escapeHtml(run.profile.version)}</dd><dt>Profile hash</dt><dd><code>${escapeHtml(run.profile.hash)}</code></dd><dt>Allowed paths</dt><dd>${value(run.profile.paths.allowed)}</dd><dt>Protected paths</dt><dd>${value(run.profile.paths.protected)}</dd><dt>Merge policy</dt><dd>${value(run.profile.merge)}</dd><dt>Operators</dt><dd>${value(run.profile.permissions?.operators)}</dd><dt>Development environment</dt><dd>${value(run.profile.developmentEnvironment)}</dd><dt>Project instructions</dt><dd>${value(run.profile.instructions?.project)}</dd><dt>Stages</dt><dd>${value(run.profile.stages)}</dd><dt>Reviewers</dt><dd>${value(run.profile.reviewers)}</dd><dt>Validation</dt><dd>${value(run.profile.validation)}</dd></dl></details>`
    : `<details class="diagnostics"><summary class="diagnostics-summary">Repository profile</summary><p class="muted">${escapeHtml(run.profileError ?? "No profile snapshot is available for this run.")}</p></details>`;
  const chronological = [...attempts].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
  const rows = chronological
    .map((attempt) => {
      const attemptUsage = usage.filter(
        (item) => item.attemptId === attempt.id,
      );
      return `<details class="attempt"><summary class="attempt-summary"><span><span class="label">Revision</span>${escapeHtml(attempt.runRevision ?? "Unavailable")}</span><span class="phase">${escapeHtml(stageLabel(attempt.stage))}</span><span><span class="label">Started</span>${escapeHtml(timestamp(attempt.createdAt))}</span><span><span class="label">Elapsed</span>${escapeHtml(elapsed(attempt.createdAt, attempt.updatedAt))}</span><span><span class="label">Status</span>${escapeHtml(attempt.state)}</span></summary><div class="attempt-details"><h3>${escapeHtml(stageLabel(attempt.stage))}</h3><p class="stage-result">${escapeHtml(stageResultSummary(attempt))}</p><dl><dt>Status</dt><dd>${escapeHtml(attempt.state)}</dd><dt>Started</dt><dd>${escapeHtml(timestamp(attempt.createdAt))}</dd><dt>Updated</dt><dd>${escapeHtml(timestamp(attempt.updatedAt))}</dd><dt>Elapsed</dt><dd>${escapeHtml(elapsed(attempt.createdAt, attempt.updatedAt))}</dd></dl>
${executionDisplay(details, attempt)}${attemptLinks(attempt)}<details class="diagnostics"><summary class="diagnostics-summary">Diagnostics</summary>${attempt.outcome ? `<h4>Executor outcome</h4>${value(attempt.outcome)}` : ""}${attempt.result === undefined ? "" : `<h4>Result</h4>${attemptResult(attempt)}`}<dl><dt>Role</dt><dd>${escapeHtml(attempt.role ?? "Unavailable")}</dd><dt>Revision</dt><dd>${escapeHtml(attempt.runRevision ?? "Unavailable")}</dd><dt>Base commit</dt><dd><code>${escapeHtml(attempt.baseCommit ?? "Unavailable")}</code></dd><dt>Expected head</dt><dd><code>${escapeHtml(attempt.expectedHead ?? "Unavailable")}</code></dd><dt>Accepted head</dt><dd><code>${escapeHtml(attempt.acceptedHead ?? "Unavailable")}</code></dd><dt>Effective capabilities</dt><dd>${value(attempt.capabilities ?? [])}</dd></dl>
${workflowEvidence(details, attempt)}<h4>Model routing</h4>${value(attempt.routing)}<h4>Model usage total</h4><p>${usageDisplay(attemptUsage)}</p>${usageTable(attemptUsage)}</details></div></details>`;
    })
    .join("");
  const latestAttempt = chronological[chronological.length - 1];
  const lastCompleted = [...chronological]
    .reverse()
    .find((attempt) => attempt.state === "completed");
  const outcomeParts = [
    `<p>${escapeHtml(runStatusSummary(run.status, currentStage))}</p>`,
  ];
  if (run.status === "waiting" && run.waitingReason)
    outcomeParts.push(
      `<dl><dt>Waiting on</dt><dd>${escapeHtml(run.waitingReason.replaceAll("_", " "))}</dd></dl>`,
    );
  if (latestAttempt && resultSummary(latestAttempt))
    outcomeParts.push(
      `<p><strong>${escapeHtml(stageLabel(latestAttempt.stage))}:</strong> ${escapeHtml(stageResultSummary(latestAttempt))}</p>`,
    );
  if (
    latestAttempt &&
    !resultSummary(latestAttempt) &&
    lastCompleted &&
    lastCompleted.id !== latestAttempt.id
  )
    outcomeParts.push(
      `<p>Most recently completed: <strong>${escapeHtml(stageLabel(lastCompleted.stage))}</strong> — ${escapeHtml(stageResultSummary(lastCompleted))}</p>`,
    );
  if (validPullRequest(prUrl))
    outcomeParts.push(
      `<p>${link(prUrl, pr?.number ? `Pull request #${pr.number}` : "Pull request")}</p>`,
    );
  const outcomeSection = `<section><h2>Outcome</h2>${outcomeParts.join("")}</section>`;
  const runDiagnostics = `<details class="diagnostics"><summary class="diagnostics-summary">Run diagnostics</summary><dl><dt>Authored candidate head</dt><dd><code>${escapeHtml(run.candidateHead ?? "Unavailable")}</code></dd><dt>Reviewed candidate head</dt><dd><code>${escapeHtml(run.reviewedHead ?? "Unavailable")}</code></dd><dt>Target base head</dt><dd><code>${escapeHtml(run.targetBaseHead ?? "Unavailable")}</code></dd><dt>Validated integration head</dt><dd><code>${escapeHtml(run.integrationHead ?? "Unavailable")}</code></dd></dl></details>`;
  const validPrUrl = validPullRequest(prUrl) ? prUrl : undefined;
  const prRow = validPrUrl
    ? `<dt>Pull request</dt><dd>${link(validPrUrl, pr?.number ? `Pull request #${pr.number}` : "Pull request")} · ${link(`${validPrUrl}/files`, "Files changed")}</dd>`
    : "";
  const [repositoryOwner, repositoryName] = run.repository.split("/", 2);
  const workflowRow =
    run.profile?.workflow && repositoryOwner && repositoryName
      ? `<dt>Workflow</dt><dd><a href="/repositories/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}/issues/${run.issueNumber}/workflow">View workflow for this run</a></dd>`
      : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(issueTitle)}</title><style>body{font:16px system-ui;line-height:1.5;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#202124}h1,h2{line-height:1.2}section{border-top:1px solid #ddd;padding:1rem 0}details.attempt{border-top:1px solid #ddd}summary.attempt-summary{cursor:pointer;display:grid;grid-template-columns:.6fr 1.2fr 2fr 1fr 1fr;gap:1rem;padding:1rem;align-items:center}summary.attempt-summary:hover{background:#f6f8fa}details.diagnostics{border:1px solid #ddd;border-radius:.35rem;margin:.75rem 0;padding:0 1rem}summary.diagnostics-summary{cursor:pointer;font-weight:600;padding:.75rem 0}details.diagnostics[open] summary.diagnostics-summary{border-bottom:1px solid #ddd;margin-bottom:.75rem}details.diagnostics details.diagnostics{margin:.5rem 0}.phase{font-weight:700}.label{display:block;color:#666;font-size:.75rem;text-transform:uppercase}.attempt-details{padding:0 1rem 1rem 2rem;border-left:3px solid #ddd;margin-left:1rem}dl{display:grid;grid-template-columns:10rem 1fr;gap:.35rem 1rem}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #ddd;padding:.4rem}pre{background:#f6f8fa;padding:1rem;overflow:auto;white-space:pre-wrap}.muted{color:#666}code{overflow-wrap:anywhere}.status{display:inline-block;border-radius:999px;padding:.15rem .55rem;font-weight:700}.status.active{background:#e6f0ff;color:#175cd3}.status.waiting{background:#fff4d6;color:#8a5b00}.status.succeeded{background:#e8f7ee;color:#087443}.status.failed{background:#fee9e7;color:#b42318}.status.cancelled{background:#eef1f5;color:#344054}.usage-hint{border-bottom:1px dotted currentColor;cursor:help;display:inline-block;position:relative}.usage-breakdown{background:#202124;border-radius:.25rem;bottom:calc(100% + .35rem);color:#fff;display:none;font-size:.875rem;left:0;padding:.4rem .6rem;pointer-events:none;position:absolute;white-space:nowrap;z-index:1}.usage-hint:hover .usage-breakdown,.usage-hint:focus .usage-breakdown,.usage-hint:focus-within .usage-breakdown{display:block}@media(max-width:700px){body{box-sizing:border-box;margin:1rem auto;max-width:none;padding:0 .75rem;width:100%}summary.attempt-summary{grid-template-columns:1fr 1fr}.phase{grid-column:auto}details.diagnostics{padding:0 .5rem;min-width:0}dl{grid-template-columns:minmax(0,1fr)}dd{margin-bottom:.5rem}.attempt-details{padding:0 0 1rem .75rem;margin-left:0;min-width:0}table{display:block;overflow-x:auto}.usage-breakdown{max-width:calc(100vw - 2rem);white-space:normal}}</style></head><body>
<p><a href="/">← Dashboard</a></p><h1>${escapeHtml(issueTitle)}</h1><p>${escapeHtml(run.repository)} issue ${escapeHtml(run.issueNumber)}</p>
<dl><dt>Status</dt><dd><span class="status ${escapeHtml(run.status)}">${escapeHtml(statusLabels[run.status])}</span></dd><dt>Current stage</dt><dd>${escapeHtml(currentStage)}</dd><dt>Elapsed</dt><dd>${escapeHtml(elapsed(details.createdAt, details.updatedAt))}</dd><dt>Total usage</dt><dd>${usageDisplay(usage)}</dd><dt>Source issue</dt><dd>${link(run.issue?.url, `Issue #${run.issueNumber}`)}</dd>${prRow}${workflowRow}<dt>Created</dt><dd>${escapeHtml(new Date(details.createdAt).toISOString())}</dd><dt>Updated</dt><dd>${escapeHtml(new Date(details.updatedAt).toISOString())}</dd></dl>
${outcomeSection}${competitionPanels(details)}<section><h2>Attempt history</h2>${rows || '<p class="muted">No attempts recorded.</p>'}</section><section><h2>Diagnostics</h2>${runDiagnostics}${reviewWorkflowEvidence(details)}${boundaryWorkflowEvidence(details)}${profileSection}</section></body></html>`;
}
