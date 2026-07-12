// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  dogfoodPublicationBranchSchema,
  repositoryRelativePathSchema,
  trustedImplementationResultSchema,
  consumeRunDelivery,
  D1JobStore,
  DispatchingStageExecutor,
  ResumableCoordinator,
} from "@roundhouse/self-development/cloudflare";
import { z } from "zod";

import { ConfiguredAuthorizer, type RequestAuthorizer } from "./auth.js";
import {
  CloudflareExecutionDispatcher,
  CloudflareRepositoryExecutionBackend,
  CloudflareTrustedExecutionDispatcher,
  CloudflareTrustedImplementationBackend,
} from "./cloudflare-execution.js";
import {
  approveRunSchema,
  idempotencyKeySchema,
  recordPublicationSchema,
  recoveryRequestSchema,
  revisionMutationSchema,
  submitRunSchema,
} from "./contracts.js";
import type { ControlPlaneEnv } from "./environment.js";
import { inspectRun } from "./inspection.js";
import { DeterministicLocalDispatcher } from "./local-dispatch.js";
import {
  IdempotencyConflictError,
  markDelivered,
  reserveSubmission,
} from "./submissions.js";
import {
  idempotentMutation,
  internalRecoveryActor,
  MutationConflictError,
  MutationPendingError,
  recordAlert,
  retentionReport,
  retryFailedRun,
  runRecoveryCycle,
} from "./operations.js";

const maxBodyBytes = 64 * 1024;
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const delegatedApprover = "mark-smith-delegated-trusted-loop-dogfood";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: jsonHeaders });
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function requestBody(
  request: Pick<Request, "headers" | "text">,
): Promise<unknown> {
  if (
    !(request.headers.get("content-type") ?? "")
      .toLowerCase()
      .startsWith("application/json")
  )
    throw new HttpError(415, "Expected an application/json request body");
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBodyBytes)
    throw new HttpError(413, "Request body is too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBodyBytes)
    throw new HttpError(413, "Request body is too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Malformed JSON request body");
  }
}

function coordinator(env: ControlPlaneEnv): ResumableCoordinator {
  if (
    ["cloudflare-container", "cloudflare-trusted-codex"].includes(
      env.EXECUTION_MODE,
    ) &&
    (!env.EXECUTION_CONTAINERS || !env.EXECUTION_EVIDENCE)
  )
    throw new Error("Cloudflare execution bindings are not configured");
  if (
    env.EXECUTION_MODE === "cloudflare-trusted-codex" &&
    !env.ROUNDHOUSE_CODEX_AUTH_JSON
  )
    throw new Error("Trusted Codex credential is not configured");
  const dispatcher =
    env.EXECUTION_MODE === "cloudflare-trusted-codex"
      ? new CloudflareTrustedExecutionDispatcher(
          new CloudflareTrustedImplementationBackend(
            env.EXECUTION_CONTAINERS!,
            env.EXECUTION_EVIDENCE!,
            env.ROUNDHOUSE_CODEX_AUTH_JSON!,
          ),
          env.TRUSTED_EXECUTION_SCENARIO ?? "success",
        )
      : env.EXECUTION_MODE === "cloudflare-container"
        ? new CloudflareExecutionDispatcher(
            new CloudflareRepositoryExecutionBackend(
              env.EXECUTION_CONTAINERS!,
              env.EXECUTION_EVIDENCE!,
            ),
            env.EXECUTION_SCENARIO ?? "success",
          )
        : new DeterministicLocalDispatcher(env.EXECUTION_MODE);
  return new ResumableCoordinator(
    new D1JobStore(env.DB),
    new DispatchingStageExecutor(dispatcher),
    { now: () => new Date() },
    {
      workerId: "roundhouse-dev-control-plane-queue",
      leaseMs: 300_000,
      maxAttemptsPerStage: 3,
    },
  );
}

async function submit(
  request: Request,
  env: ControlPlaneEnv,
): Promise<Response> {
  const key = idempotencyKeySchema.parse(
    request.headers.get("idempotency-key"),
  );
  const input = submitRunSchema.parse(await requestBody(request));
  if (env.EXECUTION_MODE === "cloudflare-trusted-codex") {
    z.array(repositoryRelativePathSchema)
      .min(1)
      .max(50)
      .parse(input.task.allowedPaths);
    dogfoodPublicationBranchSchema.parse(input.task.publication.branch);
  }
  if (
    input.task.repositoryPath !== env.ALLOWED_REPOSITORY_PATH ||
    input.task.publication.remoteUrl !== env.ALLOWED_REMOTE_URL
  )
    throw new HttpError(403, "Repository is not enrolled");
  const jobs = new D1JobStore(env.DB);
  const now = new Date();
  const reservation = await reserveSubmission(env.DB, key, input.task, now);
  let run;
  try {
    run = await jobs.read(reservation.row.run_id);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.startsWith("Run not found:")
    )
      throw error;
    await jobs.submit(reservation.row.run_id, input.task, now);
    run = await jobs.read(reservation.row.run_id);
  }
  if (reservation.row.delivery_state === "pending") {
    if (env.SUBMISSION_SCENARIO === "interrupt-before-delivery")
      throw new Error("simulated interruption before Queue delivery");
    await env.RUN_QUEUE.send({
      schemaVersion: 1,
      runId: run.runId,
      deliveryId: reservation.row.delivery_id,
      expectedRevision: run.revision,
    });
    await markDelivered(env.DB, key, new Date());
  }
  return json(
    {
      schemaVersion: 1,
      runId: reservation.row.run_id,
      created: reservation.created,
      statusUrl: `/v1/runs/${reservation.row.run_id}`,
    },
    reservation.created ? 201 : 200,
  );
}

async function cancelRun(
  runId: string,
  expectedRevision: number,
  env: ControlPlaneEnv,
): Promise<Response> {
  const jobs = new D1JobStore(env.DB);
  let cancelled;
  try {
    cancelled = await jobs.cancel(runId, new Date(), expectedRevision);
  } catch (error) {
    if (error instanceof Error && error.message.includes("revision"))
      throw new HttpError(409, error.message);
    throw error;
  }
  const active = cancelled.attempts.at(-1);
  if (
    ["cloudflare-container", "cloudflare-trusted-codex"].includes(
      env.EXECUTION_MODE,
    ) &&
    active?.status === "failed" &&
    active.classification === "cancelled" &&
    env.EXECUTION_CONTAINERS
  )
    await env.EXECUTION_CONTAINERS.getByName(active.attemptId)
      .destroy()
      .catch((error: unknown) => {
        const reason = (
          error instanceof Error ? error.message : "unknown error"
        )
          .replace(/https?:\/\/\S+/g, "[url]")
          .replace(/\/(?:[^\s/:]+\/)+[^\s:]+/g, "[path]")
          .slice(0, 160);
        console.warn("Cloudflare Container cancellation teardown failed", {
          attemptId: active.attemptId,
          reason,
        });
      });
  return json(inspectRun(cancelled));
}

async function mutationResponse(
  request: Request,
  env: ControlPlaneEnv,
  actorId: string,
  action: string,
  runId: string,
  mutate: () => Promise<Response>,
): Promise<Response> {
  const key = idempotencyKeySchema.parse(
    request.headers.get("idempotency-key"),
  );
  const requestValue = await requestBody(request.clone());
  const result = await idempotentMutation(
    env,
    { key, action, runId, actorId, request: requestValue, now: new Date() },
    async () => {
      const response = await mutate();
      return { status: response.status, body: await response.json() };
    },
  );
  return json(result.value.body, result.value.status);
}

async function approveRun(
  runId: string,
  request: Request,
  env: ControlPlaneEnv,
  actorId: string,
): Promise<Response> {
  const input = approveRunSchema.parse(await requestBody(request));
  const jobs = new D1JobStore(env.DB);
  const run = await jobs.read(runId);
  const delegated = input.approver === delegatedApprover;
  if (delegated) {
    if (
      !env.DELEGATED_ACTOR_ID ||
      actorId !== env.DELEGATED_ACTOR_ID ||
      run.task.allowedPaths.length !== 1 ||
      run.task.allowedPaths[0] !==
        "docs/dogfood/trusted-self-development-loop.md" ||
      run.implementation?.changedFiles.length !== 1 ||
      run.implementation.changedFiles[0] !==
        "docs/dogfood/trusted-self-development-loop.md"
    )
      throw new HttpError(403, "Delegated approval scope does not match");
  } else if (input.approver !== actorId) {
    throw new HttpError(403, "Approver identity does not match");
  }
  const now = new Date();
  let approved;
  try {
    approved = await jobs.approve(
      runId,
      {
        schemaVersion: 1,
        runId,
        baseCommit: run.task.baseCommit,
        patchSha256: input.patchSha256,
        evidence: input.evidence,
        approver: input.approver,
        approvedAt: now.toISOString(),
      },
      input.expectedRevision,
      now,
    );
  } catch (error) {
    throw new HttpError(
      409,
      error instanceof Error ? error.message : "Approval was rejected",
    );
  }
  return json(inspectRun(approved));
}

async function implementationEvidence(
  runId: string,
  env: ControlPlaneEnv,
): Promise<Response> {
  const run = await new D1JobStore(env.DB).read(runId);
  if (!run.implementation || !env.EXECUTION_EVIDENCE)
    throw new HttpError(404, "Implementation evidence not found");
  const reference = run.evidence.find(
    (value) => value.evidenceId === run.implementation!.evidenceId,
  );
  if (!reference) throw new HttpError(409, "Evidence binding is missing");
  const object = await env.EXECUTION_EVIDENCE.get(reference.objectKey);
  if (!object) throw new HttpError(409, "Evidence object is missing");
  const text = await object.text();
  const bytes = new TextEncoder().encode(text);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== reference.sha256 || bytes.byteLength !== reference.size)
    throw new HttpError(409, "Evidence object binding does not match");
  let result;
  try {
    result = trustedImplementationResultSchema.parse(JSON.parse(text));
  } catch {
    throw new HttpError(409, "Implementation evidence is invalid");
  }
  if (
    result.runId !== runId ||
    result.baseCommit !== run.task.baseCommit ||
    result.patchSha256 !== run.implementation.patchSha256
  )
    throw new HttpError(409, "Implementation binding does not match");
  return json({
    schemaVersion: 1,
    runId,
    baseCommit: result.baseCommit,
    patch: result.patch,
    patchSha256: result.patchSha256,
    changedFiles: result.changedFiles,
    evidence: reference,
  });
}

async function recordPublication(
  runId: string,
  request: Request,
  env: ControlPlaneEnv,
  actorId: string,
): Promise<Response> {
  const input = recordPublicationSchema.parse(await requestBody(request));
  const jobs = new D1JobStore(env.DB);
  const run = await jobs.read(runId);
  if (
    !run.approval ||
    (run.approval.approver !== actorId &&
      !(
        run.approval.approver === delegatedApprover &&
        env.DELEGATED_ACTOR_ID &&
        actorId === env.DELEGATED_ACTOR_ID
      ))
  )
    throw new HttpError(403, "Authenticated actor cannot publish this run");
  if (
    input.branch !== run.task.publication.branch ||
    input.remoteUrl !== run.task.publication.remoteUrl
  )
    throw new HttpError(409, "Publication target does not match the task");
  let completed;
  try {
    completed = await jobs.recordPublication(
      runId,
      {
        branch: input.branch,
        commit: input.commit,
        remoteUrl: input.remoteUrl,
        verifiedAt: new Date().toISOString(),
        pullRequestUrl: input.pullRequestUrl,
      },
      input.expectedRevision,
      new Date(),
    );
  } catch (error) {
    throw new HttpError(
      409,
      error instanceof Error ? error.message : "Publication was rejected",
    );
  }
  return json(inspectRun(completed));
}

async function route(
  request: Request,
  env: ControlPlaneEnv,
  actorId: string,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health")
    return json({ schemaVersion: 1, ok: true });
  if (request.method === "GET" && url.pathname === "/ready") {
    await env.DB.prepare("SELECT 1").first();
    return json({ schemaVersion: 1, ready: true });
  }
  if (request.method === "POST" && url.pathname === "/v1/runs")
    return submit(request, env);
  const match = /^\/v1\/runs\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})$/.exec(
    url.pathname,
  );
  if (request.method === "GET" && match?.[1]) {
    try {
      return json(inspectRun(await new D1JobStore(env.DB).read(match[1])));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Run not found:"))
        throw new HttpError(404, "Run not found");
      throw error;
    }
  }
  const implementationMatch =
    /^\/v1\/runs\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\/implementation$/.exec(
      url.pathname,
    );
  if (request.method === "GET" && implementationMatch?.[1])
    return implementationEvidence(implementationMatch[1], env);
  const approvalMatch =
    /^\/v1\/runs\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\/approval$/.exec(
      url.pathname,
    );
  if (request.method === "POST" && approvalMatch?.[1])
    return mutationResponse(
      request,
      env,
      actorId,
      "approve",
      approvalMatch[1],
      () => approveRun(approvalMatch[1]!, request, env, actorId),
    );
  const publicationMatch =
    /^\/v1\/runs\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\/publication$/.exec(
      url.pathname,
    );
  if (request.method === "POST" && publicationMatch?.[1])
    return mutationResponse(
      request,
      env,
      actorId,
      "publish",
      publicationMatch[1],
      () => recordPublication(publicationMatch[1]!, request, env, actorId),
    );
  const cancelMatch =
    /^\/v1\/runs\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\/cancel$/.exec(
      url.pathname,
    );
  if (request.method === "POST" && cancelMatch?.[1]) {
    try {
      const input = revisionMutationSchema.parse(
        await requestBody(request.clone()),
      );
      return await mutationResponse(
        request,
        env,
        actorId,
        "cancel",
        cancelMatch[1],
        () => cancelRun(cancelMatch[1]!, input.expectedRevision, env),
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Run not found:"))
        throw new HttpError(404, "Run not found");
      throw error;
    }
  }
  const retryMatch =
    /^\/v1\/runs\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})\/retry$/.exec(url.pathname);
  if (request.method === "POST" && retryMatch?.[1]) {
    const input = revisionMutationSchema.parse(
      await requestBody(request.clone()),
    );
    return mutationResponse(
      request,
      env,
      actorId,
      "retry",
      retryMatch[1],
      async () => {
        const run = await retryFailedRun(
          env,
          retryMatch[1]!,
          input.expectedRevision,
          new Date(),
        );
        await env.RUN_QUEUE.send({
          schemaVersion: 1,
          runId: run.runId,
          deliveryId: `operator_retry_${run.runId}_${run.revision}`,
          expectedRevision: run.revision,
        });
        return json(inspectRun(run));
      },
    );
  }
  if (request.method === "GET" && url.pathname === "/v1/operations/alerts") {
    const rows = await env.DB.prepare(
      "SELECT alert_key, kind, severity, run_id, detail_json, first_seen_at, last_seen_at, occurrences, resolved_at FROM operational_alerts ORDER BY last_seen_at DESC LIMIT 100",
    ).all<{
      alert_key: string;
      kind: string;
      severity: string;
      run_id: string | null;
      detail_json: string;
      first_seen_at: string;
      last_seen_at: string;
      occurrences: number;
      resolved_at: string | null;
    }>();
    return json({
      schemaVersion: 1,
      alerts: rows.results.map((row) => ({
        alertKey: row.alert_key,
        kind: row.kind,
        severity: row.severity,
        runId: row.run_id ?? undefined,
        detail: JSON.parse(row.detail_json) as unknown,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        occurrences: row.occurrences,
        resolvedAt: row.resolved_at ?? undefined,
      })),
    });
  }
  if (request.method === "GET" && url.pathname === "/v1/operations/retention")
    return json(await retentionReport(env));
  if (request.method === "POST" && url.pathname === "/v1/operations/recover") {
    recoveryRequestSchema.parse(await requestBody(request.clone()));
    return mutationResponse(
      request,
      env,
      actorId,
      "recover",
      "operations",
      async () => json(await runRecoveryCycle(env, new Date())),
    );
  }
  throw new HttpError(404, "Not found");
}

export function createControlPlaneHandler(
  authorizer: RequestAuthorizer = new ConfiguredAuthorizer(),
): ExportedHandler<ControlPlaneEnv> {
  return {
    async fetch(request, env): Promise<Response> {
      try {
        const url = new URL(request.url);
        let actorId = "unauthenticated-health";
        if (url.pathname !== "/health") {
          const decision = await authorizer.authorize(request, env);
          if (!decision.authorized)
            return json(
              { error: { code: "unauthorized", message: "Unauthorized" } },
              401,
            );
          actorId = decision.actorId;
        }
        return await route(request, env, actorId);
      } catch (error) {
        if (error instanceof HttpError)
          return json(
            { error: { code: "request_error", message: error.message } },
            error.status,
          );
        if (error instanceof IdempotencyConflictError)
          return json(
            {
              error: {
                code: "idempotency_conflict",
                message: "Idempotency key was used for a different request",
              },
            },
            409,
          );
        if (error instanceof MutationConflictError)
          return json(
            { error: { code: "idempotency_conflict", message: error.message } },
            409,
          );
        if (error instanceof MutationPendingError)
          return json(
            { error: { code: "mutation_pending", message: error.message } },
            409,
          );
        if (error instanceof z.ZodError)
          return json(
            {
              error: {
                code: "invalid_request",
                message: "Invalid request",
                issues: error.issues,
              },
            },
            400,
          );
        return json(
          {
            error: { code: "internal_error", message: "Internal server error" },
          },
          500,
        );
      }
    },
    async queue(batch, env): Promise<void> {
      const worker = coordinator(env);
      const jobs = new D1JobStore(env.DB);
      for (const message of batch.messages) {
        await consumeRunDelivery(
          {
            body: message.body,
            ack: () => message.ack(),
            retry: () => message.retry(),
          },
          worker,
          async (delivery, processed) => {
            let run = processed;
            if (!run)
              try {
                run = await jobs.read(delivery.runId);
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.message.startsWith("Run not found:")
                )
                  return;
                throw error;
              }
            const latest = run.attempts.at(-1);
            if (
              run.state !== "failed" &&
              latest?.status === "failed" &&
              latest.retryable
            )
              await env.RUN_QUEUE.send({
                schemaVersion: 1,
                runId: run.runId,
                deliveryId: `retry_${run.runId}_${run.revision}`,
                expectedRevision: run.revision,
              });
          },
        );
      }
    },
    async scheduled(_controller, env): Promise<void> {
      try {
        await runRecoveryCycle(env, new Date());
      } catch (error) {
        await recordAlert(env, {
          key: "scheduled_recovery_failed",
          kind: "scheduled_recovery_failed",
          severity: "error",
          detail: {
            actorId: internalRecoveryActor,
            reason:
              error instanceof Error ? error.message.slice(0, 160) : "unknown",
          },
          now: new Date(),
        });
        throw error;
      }
    },
  };
}

export default createControlPlaneHandler();
