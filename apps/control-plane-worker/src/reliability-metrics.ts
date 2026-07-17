// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { SelfDevelopmentRun } from "@roundhouse/self-development/cloudflare";

import type { ControlPlaneEnv } from "./environment.js";

type DurationMetric =
  { status: "available"; milliseconds: number } | { status: "unavailable" };

type PlanRow = {
  plan_id: string;
  issue_number: number;
  status: string;
  plan_sha256: string;
  approved_at: string | null;
  run_id: string | null;
  created_at: string;
  updated_at: string;
};

type RunRow = { run_id: string; state: string; payload: string };

type PhaseTerminal =
  | { status: "unavailable" }
  | { status: "nonterminal" }
  | {
      status: "terminal";
      outcome: "succeeded" | "failed" | "timed_out";
      classification?: string;
    };

function duration(start?: string | null, end?: string | null): DurationMetric {
  if (!start || !end) return { status: "unavailable" };
  const value = Date.parse(end) - Date.parse(start);
  return Number.isFinite(value) && value >= 0
    ? { status: "available", milliseconds: value }
    : { status: "unavailable" };
}

function summedDuration(
  values: Array<{ startedAt?: string; completedAt?: string }>,
): DurationMetric {
  const complete = values.filter(
    (value) => value.startedAt && value.completedAt,
  );
  if (complete.length === 0) return { status: "unavailable" };
  return {
    status: "available",
    milliseconds: complete.reduce(
      (total, value) =>
        total +
        Math.max(
          0,
          Date.parse(value.completedAt!) - Date.parse(value.startedAt!),
        ),
      0,
    ),
  };
}

function parseRun(row: RunRow | undefined): SelfDevelopmentRun | undefined {
  if (!row) return undefined;
  try {
    return JSON.parse(row.payload) as SelfDevelopmentRun;
  } catch {
    return undefined;
  }
}

function failureClass(run: SelfDevelopmentRun | undefined): string | undefined {
  const value = run?.attempts?.at(-1)?.classification;
  const allowed = new Set([
    "agent_failed",
    "cancelled",
    "infrastructure_failed",
    "publication_failed",
    "timeout",
    "validation_failed",
  ]);
  return value && allowed.has(value)
    ? value
    : run?.state === "failed"
      ? "other"
      : undefined;
}

function boundedClassification(value?: string | null): string | undefined {
  if (!value) return undefined;
  return /^[a-z][a-z0-9_:]{0,99}$/.test(value) ? value : "other";
}

function planningClassification(reason?: string | null): string | undefined {
  const value = reason?.toLowerCase() ?? "";
  if (value.includes("planning_invalid_structured_output"))
    return "planning_invalid_structured_output";
  if (value.includes("planning result binding does not match request"))
    return "planning_binding_mismatch";
  if (value.includes("planning result failed schema validation"))
    return "planning_schema_validation";
  if (value.includes("planning_credential_leak_detected"))
    return "planning_credential_leak_detected";
  if (value.includes("planning_modified_checkout"))
    return "planning_modified_checkout";
  return reason ? "other" : undefined;
}

function planningTerminal(
  value: { status: string; failure_reason: string | null } | undefined,
): PhaseTerminal {
  if (!value) return { status: "unavailable" };
  if (["queued", "running", "retrying"].includes(value.status))
    return { status: "nonterminal" };
  if (value.status === "completed")
    return { status: "terminal", outcome: "succeeded" };
  if (value.status === "timed_out")
    return {
      status: "terminal",
      outcome: "timed_out",
      classification: "timeout",
    };
  return {
    status: "terminal",
    outcome: "failed",
    classification: planningClassification(value.failure_reason),
  };
}

function implementationTerminal(
  value: SelfDevelopmentRun["attempts"][number] | undefined,
): PhaseTerminal {
  if (!value?.status) return { status: "unavailable" };
  if (value.status === "running") return { status: "nonterminal" };
  return {
    status: "terminal",
    outcome: value.status === "succeeded" ? "succeeded" : "failed",
    classification:
      value.status === "failed"
        ? boundedClassification(value.classification)
        : undefined,
  };
}

function reviewTerminal(
  value: { status: string; payload: string } | undefined,
): PhaseTerminal {
  if (!value) return { status: "unavailable" };
  if (["pending", "running", "remediation_pending"].includes(value.status))
    return { status: "nonterminal" };
  if (["completed", "remediated"].includes(value.status))
    return { status: "terminal", outcome: "succeeded" };
  let classification: string | undefined;
  try {
    classification = boundedClassification(
      (JSON.parse(value.payload) as { failureClassification?: string })
        .failureClassification,
    );
  } catch {
    classification = undefined;
  }
  return {
    status: "terminal",
    outcome: "failed",
    classification,
  };
}

function pullRequestNumber(url?: string): number | undefined {
  const match = /\/pull\/([1-9][0-9]*)$/.exec(url ?? "");
  return match?.[1] ? Number(match[1]) : undefined;
}

export async function reliabilitySummary(
  env: ControlPlaneEnv,
  environment: "development" | "production",
  repositoryFullName: string,
  limit = 25,
) {
  const deliveryCounts = await env.DB.prepare(
    `SELECT COUNT(*) AS deliveries, COUNT(DISTINCT payload_sha256) AS unique_payloads
       FROM github_webhook_deliveries WHERE repository_full_name = ?`,
  )
    .bind(repositoryFullName)
    .first<{ deliveries: number; unique_payloads: number }>();
  const plans = await env.DB.prepare(
    `SELECT plan_id, issue_number, status, plan_sha256, approved_at, run_id, created_at, updated_at
       FROM github_issue_plans ORDER BY updated_at DESC LIMIT ?`,
  )
    .bind(Math.min(Math.max(limit, 1), 100))
    .all<PlanRow>();
  const workflows = [];
  for (const plan of plans.results) {
    const runRow = plan.run_id
      ? await env.DB.prepare(
          "SELECT run_id, state, payload FROM self_development_runs WHERE run_id = ?",
        )
          .bind(plan.run_id)
          .first<RunRow>()
      : undefined;
    const run = parseRun(runRow ?? undefined);
    const planning = await env.DB.prepare(
      `SELECT job_id, actor_id, created_at, command_json, status, attempt_count, failure_reason FROM github_planning_jobs
        WHERE roundhouse_environment = ? AND repository_full_name = ? AND issue_number = ?
        ORDER BY created_at`,
    )
      .bind(environment, repositoryFullName, plan.issue_number)
      .all<{
        job_id: string;
        actor_id: string;
        created_at: string;
        command_json: string;
        status: string;
        attempt_count: number;
        failure_reason: string | null;
      }>();
    const reviews = plan.run_id
      ? await env.DB.prepare(
          "SELECT cycle, status, attempt_count, payload, created_at, updated_at FROM independent_reviews WHERE run_id = ? ORDER BY cycle",
        )
          .bind(plan.run_id)
          .all<{
            cycle: number;
            status: string;
            attempt_count: number;
            payload: string;
            created_at: string;
            updated_at: string;
          }>()
      : { results: [] };
    const pullNumber = pullRequestNumber(run?.publication?.pullRequestUrl);
    const ci = pullNumber
      ? await env.DB.prepare(
          `SELECT observed_at, status, conclusion FROM github_ci_outcomes
            WHERE repository_full_name = ? AND pull_request_number = ?
            ORDER BY observed_at`,
        )
          .bind(repositoryFullName, pullNumber)
          .all<{
            observed_at: string;
            status: string;
            conclusion: string | null;
          }>()
      : { results: [] };
    const planEvents = await env.DB.prepare(
      "SELECT event_type, actor_id, occurred_at FROM github_plan_events WHERE plan_id = ? ORDER BY sequence",
    )
      .bind(plan.plan_id)
      .all<{ event_type: string; actor_id: string; occurred_at: string }>();
    const operatorActions = plan.run_id
      ? await env.DB.prepare(
          "SELECT idempotency_key, action, actor_id FROM operator_mutations WHERE run_id = ? AND status = 'completed'",
        )
          .bind(plan.run_id)
          .all<{
            idempotency_key: string;
            action: string;
            actor_id: string;
          }>()
      : { results: [] };
    const manualFallback = planEvents.results.some(
      (event) => event.event_type === "implementation.manual_fallback",
    );
    const attempts = Array.isArray(run?.attempts) ? run.attempts : [];
    const events = Array.isArray(run?.events) ? run.events : [];
    const explicitImplementationAttempts = attempts.filter(
      (attempt) => attempt.stage === "implement",
    );
    // Trusted Cloudflare execution performs implementation and validation in
    // one model-backed `prepare` attempt and advances directly to approval.
    // Prefer explicit local `implement` attempts when present; otherwise the
    // prepare lineage is the implementation lineage for reliability output.
    const implementationAttempts =
      explicitImplementationAttempts.length > 0
        ? explicitImplementationAttempts
        : attempts.filter((attempt) => attempt.stage === "prepare");
    const repairAttempts = implementationAttempts.filter(
      (_attempt, index) =>
        index > 0 && implementationAttempts[index - 1]?.automaticRepair,
    ).length;
    const attemptsByStage = new Map<string, number>();
    for (const attempt of attempts)
      attemptsByStage.set(
        attempt.stage,
        (attemptsByStage.get(attempt.stage) ?? 0) + 1,
      );
    const awaitingApproval = events.find(
      (event) => event.state === "awaiting_approval",
    )?.occurredAt;
    const humanWaits = [
      duration(plan.created_at, plan.approved_at),
      duration(awaitingApproval, run?.approval?.approvedAt),
    ].filter(
      (value): value is { status: "available"; milliseconds: number } =>
        value.status === "available",
    );
    const terminal = run
      ? ["completed", "failed", "cancelled"].includes(run.state)
      : ["rejected"].includes(plan.status);
    const humanActions = new Set(
      planEvents.results
        .filter(
          (event) =>
            ["plan.approved", "implementation.manual_fallback"].includes(
              event.event_type,
            ) && !event.actor_id.startsWith("roundhouse:"),
        )
        .map(
          (event) =>
            `${event.event_type}:${event.actor_id}:${event.occurred_at}`,
        ),
    );
    for (const job of planning.results)
      if (!job.actor_id.startsWith("roundhouse:"))
        humanActions.add(`planning:${job.job_id}:${job.actor_id}`);
    for (const action of operatorActions.results)
      if (!action.actor_id.startsWith("roundhouse:"))
        humanActions.add(
          `operator:${action.idempotency_key}:${action.action}:${action.actor_id}`,
        );
    let replans = 0;
    for (const job of planning.results) {
      try {
        if (
          (JSON.parse(job.command_json) as { kind?: string }).kind === "replan"
        )
          replans += 1;
      } catch {
        // A malformed legacy command does not make the summary unreadable.
      }
    }
    workflows.push({
      schemaVersion: 1,
      environment,
      workflowId: `${environment}:${repositoryFullName}#${plan.issue_number}`,
      repositoryFullName,
      issueNumber: plan.issue_number,
      planId: plan.plan_id,
      runId: plan.run_id ?? undefined,
      durations: {
        startToPlan: duration(planning.results[0]?.created_at, plan.created_at),
        approvalToDraftPullRequest: duration(
          plan.approved_at,
          run?.publication?.verifiedAt,
        ),
        implementation: summedDuration(implementationAttempts),
        independentReview: summedDuration(
          reviews.results.map((review) => ({
            startedAt: review.created_at,
            completedAt: review.updated_at,
          })),
        ),
        ci: duration(
          ci.results[0]?.observed_at,
          ci.results.findLast(
            (outcome) =>
              outcome.status === "completed" || Boolean(outcome.conclusion),
          )?.observed_at,
        ),
        humanActionWait:
          humanWaits.length > 0
            ? {
                status: "available" as const,
                milliseconds: humanWaits.reduce(
                  (total, value) => total + value.milliseconds,
                  0,
                ),
              }
            : ({ status: "unavailable" } as const),
      },
      counts: {
        implementationAttempts: implementationAttempts.length,
        repairAttempts,
        retries: [...attemptsByStage.values()].reduce(
          (total, count) => total + Math.max(0, count - 1),
          0,
        ),
        replans,
        remediationCycles: Math.max(
          0,
          ...reviews.results.map((review) => review.cycle - 1),
        ),
        duplicateDeliveries: 0,
        distinctHumanActions: humanActions.size,
      },
      modelPhases: {
        planning: {
          attempts: planning.results.reduce(
            (total, job) => total + job.attempt_count,
            0,
          ),
          terminal: planningTerminal(planning.results.at(-1)),
        },
        implementation: {
          attempts: implementationAttempts.length,
          terminal: implementationTerminal(implementationAttempts.at(-1)),
        },
        independentReview: {
          attempts: reviews.results.reduce(
            (total, review) => total + review.attempt_count,
            0,
          ),
          terminal: reviewTerminal(reviews.results.at(-1)),
        },
      },
      manualFallbackRequired: manualFallback,
      terminal: terminal
        ? {
            status: "terminal" as const,
            outcome:
              run?.state === "completed"
                ? "succeeded"
                : run?.state === "cancelled"
                  ? "cancelled"
                  : "failed",
            failureClass: failureClass(run),
          }
        : { status: "nonterminal" as const },
    });
  }
  return {
    schemaVersion: 1,
    environment,
    repositoryFullName,
    counts: {
      duplicateDeliveries: Math.max(
        0,
        (deliveryCounts?.deliveries ?? 0) -
          (deliveryCounts?.unique_payloads ?? 0),
      ),
    },
    workflows,
  };
}

export async function markManualFallback(
  env: ControlPlaneEnv,
  input: {
    planId: string;
    expectedRevision: number;
    planSha256: string;
    actorId: string;
    now: Date;
  },
) {
  const plan = await env.DB.prepare(
    "SELECT revision, plan_sha256 FROM github_issue_plans WHERE plan_id = ?",
  )
    .bind(input.planId)
    .first<{ revision: number; plan_sha256: string }>();
  if (!plan) throw new Error("Plan not found");
  if (
    plan.revision !== input.expectedRevision ||
    plan.plan_sha256 !== input.planSha256
  )
    throw new Error("Manual fallback binding does not match");
  const eventId = `manual-fallback:${input.planId}:${input.actorId}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO github_plan_events(event_id, plan_id, sequence, event_type, actor_id, detail_json, occurred_at)
     SELECT ?, ?, COALESCE(MAX(sequence), 0) + 1, 'implementation.manual_fallback', ?, ?, ?
       FROM github_plan_events WHERE plan_id = ?`,
  )
    .bind(
      eventId,
      input.planId,
      input.actorId,
      JSON.stringify({
        planSha256: input.planSha256,
        expectedRevision: input.expectedRevision,
      }),
      input.now.toISOString(),
      input.planId,
    )
    .run();
  return {
    schemaVersion: 1,
    planId: input.planId,
    actorId: input.actorId,
    manualFallbackRequired: true,
  };
}
