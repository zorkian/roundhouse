// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  defaultFindingDisposition,
  durableIndependentReviewSchema,
  independentReviewExecutionSchema,
  independentReviewRequestSchema,
  reviewDeliverySchema,
  reviewIdentity,
  type DurableIndependentReview,
  type IndependentReviewExecution,
  type IndependentReviewRequest,
  type ReviewDelivery,
} from "@roundhouse/self-development/cloudflare";

import type { ControlPlaneEnv } from "./environment.js";

const encoder = new TextEncoder();
const maximumAttempts = 3;
const maximumReclaims = maximumAttempts - 1;

type ReviewRow = {
  review_id: string;
  request_hash: string;
  revision: number;
  status: DurableIndependentReview["status"];
  attempt_count: number;
  lease_expires_at: string | null;
  dispatch_state: "pending" | "sent";
  payload: string;
};

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hash(value: unknown): Promise<string> {
  return hex(
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(JSON.stringify(value)),
    ),
  );
}

async function row(
  env: ControlPlaneEnv,
  reviewId: string,
): Promise<ReviewRow | null> {
  return env.DB.prepare(
    "SELECT review_id, request_hash, revision, status, attempt_count, lease_expires_at, dispatch_state, payload FROM independent_reviews WHERE review_id = ?",
  )
    .bind(reviewId)
    .first<ReviewRow>();
}

function record(value: ReviewRow): DurableIndependentReview {
  const parsed = durableIndependentReviewSchema.parse(
    JSON.parse(value.payload),
  );
  if (
    parsed.request.reviewId !== value.review_id ||
    parsed.revision !== value.revision ||
    parsed.status !== value.status ||
    parsed.attemptCount !== value.attempt_count
  )
    throw new Error("Independent review row projection does not match payload");
  return parsed;
}

async function writeCas(
  env: ControlPlaneEnv,
  previous: ReviewRow,
  next: DurableIndependentReview,
  dispatchState = previous.dispatch_state,
): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE independent_reviews SET revision = ?, status = ?, attempt_count = ?, lease_expires_at = ?, dispatch_state = ?, payload = ?, updated_at = ? WHERE review_id = ? AND revision = ?",
  )
    .bind(
      next.revision,
      next.status,
      next.attemptCount,
      next.lease?.expiresAt ?? null,
      dispatchState,
      JSON.stringify(next),
      next.updatedAt,
      next.request.reviewId,
      previous.revision,
    )
    .run();
  return (result.meta.changes ?? 0) === 1;
}

async function insertEvents(
  env: ControlPlaneEnv,
  value: DurableIndependentReview,
): Promise<void> {
  for (const event of value.events)
    await env.DB.prepare(
      "INSERT OR IGNORE INTO independent_review_events(event_id, review_id, sequence, event_type, detail_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        `${value.request.reviewId}:${event.sequence}`,
        value.request.reviewId,
        event.sequence,
        event.type,
        JSON.stringify(event.detail),
        event.occurredAt,
      )
      .run();
}

export async function reserveIndependentReview(
  env: ControlPlaneEnv,
  input: IndependentReviewRequest,
  now: Date,
): Promise<{ review: DurableIndependentReview; created: boolean }> {
  const request = independentReviewRequestSchema.parse(input);
  if (
    request.reviewId !==
      (await reviewIdentity({
        runId: request.runId,
        headCommit: request.headCommit,
        cycle: request.cycle,
      })) ||
    request.attemptNumber !== 1 ||
    request.attemptId !== `${request.reviewId}-attempt-1`
  )
    throw new Error("Independent review identity is not canonical");
  const requestHash = await hash(request);
  const timestamp = now.toISOString();
  const review = durableIndependentReviewSchema.parse({
    schemaVersion: 1,
    revision: 1,
    status: "pending",
    request,
    attemptCount: 0,
    dispositions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    events: [
      {
        sequence: 1,
        type: "review.reserved",
        occurredAt: timestamp,
        detail: { headCommit: request.headCommit, cycle: request.cycle },
      },
    ],
  });
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO independent_reviews(review_id, run_id, cycle, head_commit, request_hash, revision, status, attempt_count, dispatch_state, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 'pending', 0, 'pending', ?, ?, ?)",
  )
    .bind(
      request.reviewId,
      request.runId,
      request.cycle,
      request.headCommit,
      requestHash,
      JSON.stringify(review),
      timestamp,
      timestamp,
    )
    .run();
  const retained = await row(env, request.reviewId);
  if (!retained || retained.request_hash !== requestHash)
    throw new Error(
      "Independent review reservation conflicts with durable intent",
    );
  const value = record(retained);
  await insertEvents(env, value);
  return { review: value, created: (inserted.meta.changes ?? 0) === 1 };
}

export async function readIndependentReview(
  env: ControlPlaneEnv,
  reviewId: string,
): Promise<DurableIndependentReview | null> {
  const value = await row(env, reviewId);
  return value ? record(value) : null;
}

export async function readReviewByRemediationRun(
  env: ControlPlaneEnv,
  runId: string,
): Promise<DurableIndependentReview | null> {
  const value = await env.DB.prepare(
    "SELECT review_id, request_hash, revision, status, attempt_count, lease_expires_at, dispatch_state, payload FROM independent_reviews WHERE json_extract(payload, '$.remediationRunId') = ? LIMIT 1",
  )
    .bind(runId)
    .first<ReviewRow>();
  return value ? record(value) : null;
}

export async function isIssueRemediationRun(
  env: ControlPlaneEnv,
  input: {
    repositoryFullName: string;
    issueNumber: number;
    sourceRunId: string;
    remediationRunId: string;
  },
): Promise<boolean> {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(input.repositoryFullName))
    return false;
  const row = await env.DB.prepare(
    "SELECT review_id FROM independent_reviews WHERE run_id = ? AND json_extract(payload, '$.remediationRunId') = ? AND json_extract(payload, '$.request.repositoryUrl') = ? AND json_extract(payload, '$.request.issueNumber') = ? LIMIT 1",
  )
    .bind(
      input.sourceRunId,
      input.remediationRunId,
      `https://github.com/${input.repositoryFullName}.git`,
      input.issueNumber,
    )
    .first<{ review_id: string }>();
  return row !== null;
}

export async function listIndependentReviews(
  env: ControlPlaneEnv,
  limit = 50,
): Promise<DurableIndependentReview[]> {
  const rows = await env.DB.prepare(
    "SELECT review_id, request_hash, revision, status, attempt_count, lease_expires_at, dispatch_state, payload FROM independent_reviews ORDER BY updated_at DESC LIMIT ?",
  )
    .bind(Math.max(1, Math.min(limit, 100)))
    .all<ReviewRow>();
  return rows.results.map(record);
}

export async function listIssueReviews(
  env: ControlPlaneEnv,
  repositoryFullName: string,
  issueNumber: number,
  limit = 20,
): Promise<DurableIndependentReview[]> {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repositoryFullName))
    throw new Error("Repository identity is invalid");
  const rows = await env.DB.prepare(
    "SELECT review_id, request_hash, revision, status, attempt_count, lease_expires_at, dispatch_state, payload FROM independent_reviews WHERE json_extract(payload, '$.request.repositoryUrl') = ? AND json_extract(payload, '$.request.issueNumber') = ? ORDER BY updated_at DESC LIMIT ?",
  )
    .bind(
      `https://github.com/${repositoryFullName}.git`,
      issueNumber,
      Math.max(1, Math.min(limit, 100)),
    )
    .all<ReviewRow>();
  return rows.results.reverse().map(record);
}

export async function listPullRequestReviews(
  env: ControlPlaneEnv,
  repositoryFullName: string,
  pullRequestNumber: number,
  limit = 20,
): Promise<DurableIndependentReview[]> {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repositoryFullName)) return [];
  const rows = await env.DB.prepare(
    "SELECT review_id, request_hash, revision, status, attempt_count, lease_expires_at, dispatch_state, payload FROM independent_reviews WHERE json_extract(payload, '$.request.repositoryUrl') = ? AND json_extract(payload, '$.request.pullRequestNumber') = ? AND json_extract(payload, '$.request.advisoryOnly') = 1 ORDER BY updated_at DESC LIMIT ?",
  )
    .bind(
      `https://github.com/${repositoryFullName}.git`,
      pullRequestNumber,
      Math.max(1, Math.min(limit, 100)),
    )
    .all<ReviewRow>();
  return rows.results.map(record);
}

export async function listRunReviews(
  env: ControlPlaneEnv,
  runId: string,
): Promise<DurableIndependentReview[]> {
  const rows = await env.DB.prepare(
    "SELECT review_id, request_hash, revision, status, attempt_count, lease_expires_at, dispatch_state, payload FROM independent_reviews WHERE run_id = ? ORDER BY updated_at",
  )
    .bind(runId)
    .all<ReviewRow>();
  return rows.results.map(record);
}

export async function markReviewDispatched(
  env: ControlPlaneEnv,
  reviewId: string,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE independent_reviews SET dispatch_state = 'sent' WHERE review_id = ? AND status = 'pending'",
  )
    .bind(reviewId)
    .run();
}

export async function recoverableReviewDeliveries(
  env: ControlPlaneEnv,
  now: Date,
  limit = 20,
): Promise<ReviewDelivery[]> {
  const rows = await env.DB.prepare(
    "SELECT review_id, revision FROM independent_reviews WHERE (status = 'pending' AND dispatch_state = 'pending') OR (status = 'running' AND lease_expires_at <= ?) ORDER BY updated_at LIMIT ?",
  )
    .bind(now.toISOString(), Math.max(1, Math.min(limit, 100)))
    .all<{ review_id: string; revision: number }>();
  return rows.results.map((value) =>
    reviewDeliverySchema.parse({
      schemaVersion: 1,
      kind: "independent_review",
      reviewId: value.review_id,
      deliveryId: `review_delivery_${value.review_id}_${value.revision}`,
    }),
  );
}

export async function claimIndependentReview(
  env: ControlPlaneEnv,
  reviewId: string,
  workerId: string,
  now: Date,
  leaseMs: number,
): Promise<{ review: DurableIndependentReview; token: string } | null> {
  for (let contention = 0; contention < 8; contention += 1) {
    const currentRow = await row(env, reviewId);
    if (!currentRow) return null;
    const current = record(currentRow);
    const expired =
      current.status === "running" &&
      current.lease !== undefined &&
      new Date(current.lease.expiresAt).getTime() <= now.getTime();
    if (current.status !== "pending" && !expired) return null;
    if (expired && current.reclaimCount >= maximumReclaims) {
      const timestamp = now.toISOString();
      const { lease: _lease, ...withoutLease } = current;
      const failed = durableIndependentReviewSchema.parse({
        ...withoutLease,
        revision: current.revision + 1,
        status: "failed",
        retryable: false,
        failureClassification: "review_lease_reclaim_exhausted",
        failureReason: "Independent review lease expired too many times",
        updatedAt: timestamp,
        events: [
          ...current.events,
          {
            sequence: current.events.length + 1,
            type: "review.failed",
            occurredAt: timestamp,
            detail: {
              classification: "review_lease_reclaim_exhausted",
              reclaimCount: current.reclaimCount,
            },
          },
        ],
      });
      if (await writeCas(env, currentRow, failed, "sent")) {
        await insertEvents(env, failed);
        return null;
      }
      continue;
    }
    const attemptCount = expired
      ? current.attemptCount
      : current.attemptCount + 1;
    if (attemptCount > maximumAttempts) return null;
    const token = `review_lease_${crypto.randomUUID()}`;
    const timestamp = now.toISOString();
    const attemptId = `${reviewId}-attempt-${attemptCount}`;
    const next = durableIndependentReviewSchema.parse({
      ...current,
      revision: current.revision + 1,
      status: "running",
      request: { ...current.request, attemptId, attemptNumber: attemptCount },
      attemptCount,
      reclaimCount: expired ? current.reclaimCount + 1 : current.reclaimCount,
      activeAttemptId: attemptId,
      lease: {
        token,
        workerId,
        acquiredAt: timestamp,
        expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      },
      retryable: undefined,
      failureClassification: undefined,
      failureReason: undefined,
      updatedAt: timestamp,
      events: [
        ...current.events,
        {
          sequence: current.events.length + 1,
          type: expired ? "review.reclaimed" : "review.claimed",
          occurredAt: timestamp,
          detail: { attemptId, attemptCount },
        },
      ],
    });
    if (await writeCas(env, currentRow, next, "sent")) {
      await insertEvents(env, next);
      return { review: next, token };
    }
  }
  throw new Error("Independent review claim contention exceeded");
}

export async function completeIndependentReview(
  env: ControlPlaneEnv,
  reviewId: string,
  token: string,
  executionValue: IndependentReviewExecution,
  now: Date,
): Promise<DurableIndependentReview> {
  const execution = independentReviewExecutionSchema.parse(executionValue);
  for (let contention = 0; contention < 8; contention += 1) {
    const currentRow = await row(env, reviewId);
    if (!currentRow) throw new Error("Independent review not found");
    const current = record(currentRow);
    if (current.execution) {
      if (JSON.stringify(current.execution) !== JSON.stringify(execution))
        throw new Error("Independent review completion conflicts");
      return current;
    }
    if (
      current.status !== "running" ||
      current.lease?.token !== token ||
      execution.result.reviewId !== reviewId ||
      execution.result.attemptId !== current.activeAttemptId ||
      execution.result.headCommit !== current.request.headCommit
    )
      throw new Error("Independent review completion binding mismatch");
    const timestamp = now.toISOString();
    const dispositions = execution.result.findings.map((finding) => {
      const disposition = defaultFindingDisposition(
        reviewId,
        finding,
        current.request.allowedPaths,
        now,
      );
      return (current.request.advisoryOnly || current.request.cycle === 2) &&
        disposition.disposition === "accepted"
        ? {
            ...disposition,
            disposition: "deferred" as const,
            rationale: current.request.advisoryOnly
              ? "This independently requested review is advisory; merge and remediation authority remains human-only."
              : "The bounded two-cycle remediation limit was reached; this finding remains visible for later work.",
          }
        : disposition;
    });
    const accepted = dispositions.filter(
      (value) => value.disposition === "accepted",
    );
    const { lease: _lease, ...withoutLease } = current;
    const next = durableIndependentReviewSchema.parse({
      ...withoutLease,
      revision: current.revision + 1,
      status: accepted.length > 0 ? "remediation_pending" : "completed",
      execution,
      dispositions,
      updatedAt: timestamp,
      events: [
        ...current.events,
        {
          sequence: current.events.length + 1,
          type: "review.completed",
          occurredAt: timestamp,
          detail: {
            findingCount: execution.result.findings.length,
            acceptedCount: accepted.length,
            evidenceSha256: execution.evidence.sha256,
          },
        },
      ],
    });
    if (!(await writeCas(env, currentRow, next))) continue;
    for (const finding of execution.result.findings) {
      const disposition = dispositions.find(
        (value) => value.findingId === finding.findingId,
      )!;
      await env.DB.prepare(
        "INSERT OR IGNORE INTO independent_review_findings(finding_id, review_id, head_commit, severity, path, line, disposition, finding_json, disposition_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          finding.findingId,
          reviewId,
          current.request.headCommit,
          finding.severity,
          finding.path,
          finding.line ?? null,
          disposition.disposition,
          JSON.stringify(finding),
          JSON.stringify(disposition),
          timestamp,
        )
        .run();
    }
    await insertEvents(env, next);
    return next;
  }
  throw new Error("Independent review completion contention exceeded");
}

export async function failIndependentReview(
  env: ControlPlaneEnv,
  reviewId: string,
  token: string,
  failure: {
    attemptId: string;
    retryable: boolean;
    classification: string;
    reason: string;
  },
  now: Date,
): Promise<DurableIndependentReview> {
  for (let contention = 0; contention < 8; contention += 1) {
    const currentRow = await row(env, reviewId);
    if (!currentRow) throw new Error("Independent review not found");
    const current = record(currentRow);
    const classification = failure.classification.slice(0, 100);
    const reason = failure.reason.slice(0, 500);
    if (current.status !== "running" || current.lease?.token !== token) {
      if (
        ["pending", "failed"].includes(current.status) &&
        current.activeAttemptId === failure.attemptId &&
        current.failureClassification === classification &&
        current.failureReason === reason
      )
        return current;
      throw new Error("Independent review failure binding mismatch");
    }
    if (current.activeAttemptId !== failure.attemptId)
      throw new Error("Independent review failure attempt mismatch");
    const retryable =
      failure.retryable && current.attemptCount < maximumAttempts;
    const timestamp = now.toISOString();
    const { lease: _lease, ...withoutLease } = current;
    const next = durableIndependentReviewSchema.parse({
      ...withoutLease,
      revision: current.revision + 1,
      status: retryable ? "pending" : "failed",
      retryable,
      failureClassification: classification,
      failureReason: reason,
      updatedAt: timestamp,
      events: [
        ...current.events,
        {
          sequence: current.events.length + 1,
          type: retryable ? "review.retry_scheduled" : "review.failed",
          occurredAt: timestamp,
          detail: {
            classification,
            attemptCount: current.attemptCount,
          },
        },
      ],
    });
    if (await writeCas(env, currentRow, next, retryable ? "pending" : "sent")) {
      await insertEvents(env, next);
      return next;
    }
  }
  throw new Error("Independent review failure contention exceeded");
}

export async function recordReviewRemediation(
  env: ControlPlaneEnv,
  reviewId: string,
  remediationRunId: string,
  now: Date,
): Promise<DurableIndependentReview> {
  for (let contention = 0; contention < 8; contention += 1) {
    const currentRow = await row(env, reviewId);
    if (!currentRow) throw new Error("Independent review not found");
    const current = record(currentRow);
    if (current.remediationRunId) {
      if (current.remediationRunId !== remediationRunId)
        throw new Error("Independent review remediation conflicts");
      return current;
    }
    if (current.status !== "remediation_pending")
      throw new Error("Independent review does not require remediation");
    const timestamp = now.toISOString();
    const next = durableIndependentReviewSchema.parse({
      ...current,
      revision: current.revision + 1,
      status: "remediated",
      remediationRunId,
      updatedAt: timestamp,
      events: [
        ...current.events,
        {
          sequence: current.events.length + 1,
          type: "review.remediation_started",
          occurredAt: timestamp,
          detail: { remediationRunId },
        },
      ],
    });
    if (await writeCas(env, currentRow, next)) {
      await insertEvents(env, next);
      return next;
    }
  }
  throw new Error("Independent review remediation contention exceeded");
}
