// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Container } from "@cloudflare/containers";
import type { Attempt } from "@roundhouse/core";
import { verifyCallback } from "./callback.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";

interface AttemptAssignment extends Attempt {
  readonly artifact: {
    readonly remote: string;
    readonly hostname: string;
  };
  readonly issue?: unknown;
}

type AttemptContainerEnv = Cloudflare.Env & {
  readonly DB: D1Like;
  readonly MODEL_BROKER: Fetcher;
  readonly CALLBACK_SIGNING_SECRET: string;
};

const modelHost = "model.roundhouse.internal";
const containerCa = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";

async function modelEgress(request: Request, env: Cloudflare.Env) {
  const runtime = env as AttemptContainerEnv;
  const attemptId = request.headers.get("x-roundhouse-attempt-id") ?? "";
  const capability =
    request.headers.get("x-roundhouse-attempt-capability") ?? "";
  const validCapability =
    attemptId &&
    capability &&
    (await verifyCallback(
      runtime.CALLBACK_SIGNING_SECRET,
      attemptId,
      capability,
    ));
  if (!validCapability) {
    console.error(
      JSON.stringify({
        message: "model_egress_unauthorized",
        attemptIdPresent: Boolean(attemptId),
        capabilityPresent: Boolean(capability),
      }),
    );
    return new Response("unauthorized", { status: 401 });
  }
  const repository = new D1RunRepository(runtime.DB);
  const attempt = await repository.getAttempt(attemptId);
  if (
    !attempt ||
    attempt.stage !== "qualify" ||
    !["created", "dispatched"].includes(attempt.state) ||
    attempt.deadlineAt <= Date.now()
  ) {
    console.error(
      JSON.stringify({
        message: "model_egress_stale",
        attemptFound: Boolean(attempt),
        stage: attempt?.stage,
        state: attempt?.state,
        deadlineActive: Boolean(attempt && attempt.deadlineAt > Date.now()),
      }),
    );
    return new Response("stale_attempt", { status: 409 });
  }
  if (!(await repository.reserveModelCall(attemptId))) {
    console.error(JSON.stringify({ message: "model_egress_budget_exhausted" }));
    return new Response("model_budget_exhausted", { status: 429 });
  }
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("x-roundhouse-attempt-capability");
  headers.set("x-roundhouse-role", attempt.role);
  headers.set("x-roundhouse-task-type", "validation");
  headers.set("x-roundhouse-complexity", "unknown");
  const requestedUrl = new URL(request.url);
  const response = await runtime.MODEL_BROKER.fetch(
    new Request(
      `https://broker.roundhouse.internal${requestedUrl.pathname}${requestedUrl.search}`,
      {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
      },
    ),
  );
  const routing = {
    model: response.headers.get("x-roundhouse-routing-model"),
    reasoningEffort: response.headers.get("x-roundhouse-routing-effort"),
    rule: response.headers.get("x-roundhouse-routing-rule"),
  };
  if (routing.model && routing.reasoningEffort && routing.rule)
    await repository.recordModelRouting(attemptId, routing);
  return response;
}

export class RoundhouseAttemptContainer extends Container<Cloudflare.Env> {
  override defaultPort = 8080;
  override sleepAfter = "35m";
  override enableInternet = false;
  override interceptHttps = true;

  override async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST")
      return new Response("method_not_allowed", { status: 405 });
    const attempt = await request.json<AttemptAssignment>();
    if (attempt.deadlineAt <= Date.now())
      return new Response("attempt_deadline_expired", { status: 409 });

    this.allowedHosts = [
      modelHost,
      attempt.artifact.hostname,
      request.headers.get("x-roundhouse-callback-url")
        ? new URL(request.headers.get("x-roundhouse-callback-url")!).hostname
        : "",
    ].filter(Boolean);
    await this.startAndWaitForPorts({
      ports: this.defaultPort,
      cancellationOptions: { portReadyTimeoutMS: 30_000 },
      startOptions: {
        envVars: {
          ROUNDHOUSE_ATTEMPT_ID: attempt.id,
          ROUNDHOUSE_ATTEMPT_CAPABILITY:
            request.headers.get("x-roundhouse-attempt-secret") ?? "",
          ROUNDHOUSE_TASK_TYPE: "validation",
          ROUNDHOUSE_COMPLEXITY: "unknown",
          ROUNDHOUSE_DUMMY_TOKEN: "service-binding-auth-only",
          GIT_SSL_CAINFO: containerCa,
          NODE_EXTRA_CA_CERTS: containerCa,
        },
        enableInternet: false,
      },
    });
    const path = new URL(request.url).pathname;
    const response = await this.containerFetch(`http://runner${path}`, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(attempt),
    });
    if (path === "/validate") return response;
    return response.ok
      ? Response.json(
          { accepted: true, attemptId: attempt.id },
          { status: 202 },
        )
      : new Response("runner_rejected", { status: 503 });
  }
}

RoundhouseAttemptContainer.outboundByHost = { [modelHost]: modelEgress };
