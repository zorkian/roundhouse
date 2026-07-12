// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  consumeRunDelivery,
  D1JobStore,
  DispatchingStageExecutor,
  ResumableCoordinator,
} from "@roundhouse/self-development/cloudflare";
import { z } from "zod";

import { ConfiguredAuthorizer, type RequestAuthorizer } from "./auth.js";
import { idempotencyKeySchema, submitRunSchema } from "./contracts.js";
import type { ControlPlaneEnv } from "./environment.js";
import { inspectRun } from "./inspection.js";
import { DeterministicLocalDispatcher } from "./local-dispatch.js";
import {
  IdempotencyConflictError,
  markDelivered,
  reserveSubmission,
} from "./submissions.js";

const maxBodyBytes = 64 * 1024;
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

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

async function requestBody(request: Request): Promise<unknown> {
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
  return new ResumableCoordinator(
    new D1JobStore(env.DB),
    new DispatchingStageExecutor(
      new DeterministicLocalDispatcher(env.EXECUTION_MODE),
    ),
    { now: () => new Date() },
    { workerId: "local-control-plane-queue", maxAttemptsPerStage: 3 },
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

async function route(
  request: Request,
  env: ControlPlaneEnv,
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
  throw new HttpError(404, "Not found");
}

export function createControlPlaneHandler(
  authorizer: RequestAuthorizer = new ConfiguredAuthorizer(),
): ExportedHandler<ControlPlaneEnv> {
  return {
    async fetch(request, env): Promise<Response> {
      try {
        const url = new URL(request.url);
        if (url.pathname !== "/health") {
          const decision = await authorizer.authorize(request, env);
          if (!decision.authorized)
            return json(
              { error: { code: "unauthorized", message: "Unauthorized" } },
              401,
            );
        }
        return await route(request, env);
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
  };
}

export default createControlPlaneHandler();
