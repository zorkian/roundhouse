import { newId } from "@roundhouse/domain";
import { z } from "zod";

import {
  approvalSchema,
  startRunSchema,
  type ApprovalEvent,
} from "./contracts.js";
import { workflowInstanceId } from "./crypto.js";
import type { Env } from "./environment.js";
import {
  appendEvent,
  createRun,
  getRun,
  IdempotencyConflictError,
  recordApproval,
  runDetail,
} from "./persistence.js";

export { ApprovalWorkflow } from "./workflow.js";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: jsonHeaders });
}

async function body(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Expected an application/json request body");
  }
  return request.json();
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function startRun(request: Request, env: Env): Promise<Response> {
  const input = startRunSchema.parse(await body(request));
  const instanceId = await workflowInstanceId(input.idempotencyKey);
  const result = await createRun(env.DB, input, instanceId);

  if (result.created) {
    try {
      await env.APPROVAL_WORKFLOW.create({
        id: instanceId,
        params: {
          runId: result.run.id,
          subject: result.run.subject,
          planRevision: result.run.plan_revision,
        },
      });
    } catch (error) {
      const now = new Date().toISOString();
      await env.DB.prepare(
        "UPDATE runs SET state = 'failed', updated_at = ?1 WHERE id = ?2",
      )
        .bind(now, result.run.id)
        .run();
      await appendEvent(env.DB, {
        runId: result.run.id,
        type: "workflow.create_failed",
        actorType: "system",
        actorId: "control-plane-spike",
        occurredAt: now,
        payload: {
          message:
            error instanceof Error
              ? error.message
              : "Unknown workflow creation error",
        },
      });
      throw error;
    }
  }

  return json(
    {
      id: result.run.id,
      workflowInstanceId: result.run.workflow_instance_id,
      created: result.created,
      statusUrl: `/runs/${result.run.id}`,
    },
    result.created ? 201 : 200,
  );
}

async function status(runId: string, env: Env): Promise<Response> {
  const detail = await runDetail(env.DB, runId);
  if (!detail) throw new HttpError(404, "Run not found");
  const run = detail.run as { workflow_instance_id: string };
  const instance = await env.APPROVAL_WORKFLOW.get(run.workflow_instance_id);
  return json({ ...detail, workflow: await instance.status() });
}

async function approve(
  request: Request,
  runId: string,
  env: Env,
): Promise<Response> {
  const input = approvalSchema.parse(await body(request));
  const run = await getRun(env.DB, runId);
  if (!run) throw new HttpError(404, "Run not found");
  if (run.plan_revision !== input.planRevision) {
    throw new HttpError(
      409,
      `Approval is for plan revision ${input.planRevision}; current revision is ${run.plan_revision}`,
    );
  }
  if (run.state !== "awaiting_plan_approval") {
    throw new HttpError(
      409,
      `Run cannot be approved while in state ${run.state}`,
    );
  }

  const approval: ApprovalEvent = {
    approvalId: newId("approval"),
    actorId: input.actorId,
    planRevision: input.planRevision,
    occurredAt: new Date().toISOString(),
  };
  const recorded = await recordApproval(env.DB, run, approval);
  const instance = await env.APPROVAL_WORKFLOW.get(run.workflow_instance_id);
  await instance.sendEvent({ type: "plan_approved", payload: approval });
  return json(
    { accepted: true, recorded, workflow: await instance.status() },
    202,
  );
}

async function cancel(runId: string, env: Env): Promise<Response> {
  const run = await getRun(env.DB, runId);
  if (!run) throw new HttpError(404, "Run not found");
  if (["completed", "cancelled"].includes(run.state)) {
    throw new HttpError(
      409,
      `Run cannot be cancelled while in state ${run.state}`,
    );
  }

  const instance = await env.APPROVAL_WORKFLOW.get(run.workflow_instance_id);
  await instance.terminate();
  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE runs SET state = 'cancelled', updated_at = ?1, completed_at = ?1 WHERE id = ?2",
  )
    .bind(now, run.id)
    .run();
  await appendEvent(env.DB, {
    runId,
    type: "run.cancelled",
    actorType: "human",
    actorId: "spike-api-user",
    occurredAt: now,
    payload: {},
  });
  return json({ cancelled: true, workflow: await instance.status() });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health")
    return json({ ok: true });
  if (request.method === "POST" && url.pathname === "/runs")
    return startRun(request, env);

  const match =
    /^\/runs\/([0-9A-HJKMNP-TV-Z]{26})(?:\/(approve|cancel))?$/.exec(
      url.pathname,
    );
  if (!match?.[1]) throw new HttpError(404, "Not found");
  const [, runId, action] = match;
  if (request.method === "GET" && !action) return status(runId, env);
  if (request.method === "POST" && action === "approve")
    return approve(request, runId, env);
  if (request.method === "POST" && action === "cancel")
    return cancel(runId, env);
  throw new HttpError(405, "Method not allowed");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (
        url.pathname !== "/health" &&
        request.headers.get("authorization") !== `Bearer ${env.SPIKE_API_TOKEN}`
      ) {
        return json({ error: "Unauthorized" }, 401);
      }
      return await route(request, env);
    } catch (error) {
      if (error instanceof HttpError)
        return json({ error: error.message }, error.status);
      if (error instanceof IdempotencyConflictError)
        return json({ error: error.message }, 409);
      if (error instanceof z.ZodError)
        return json({ error: "Invalid request", issues: error.issues }, 400);
      console.error(error);
      return json({ error: "Internal server error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
