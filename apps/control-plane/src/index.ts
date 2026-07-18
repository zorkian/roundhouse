// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { runSchemaVersion, type Attempt, type Wakeup } from "@roundhouse/core";
import { coordinate, type AttemptDispatcher } from "./coordinator.js";
import { acceptCallbackAndAdvance, signCallback } from "./callback.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";
export { RoundhouseAttemptContainer } from "./attempt-container.js";

export const controlPlaneService = "roundhouse-v2-control-plane";

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function handleRequest(request: Request): Response {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    if (request.method !== "GET")
      return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
    return json({
      schemaVersion: runSchemaVersion,
      ok: true,
      service: controlPlaneService,
    });
  }

  return json({ error: "not_found" }, 404);
}

interface AttemptStub {
  fetch(request: Request): Promise<Response>;
}

interface AttemptNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): AttemptStub;
}

interface QueueBinding {
  send(wakeup: Wakeup): Promise<void>;
}

interface Env {
  DB: D1Like;
  ATTEMPT_CONTAINERS: AttemptNamespace;
  RUN_WAKEUPS: QueueBinding;
  CALLBACK_SIGNING_SECRET: string;
  CONTROL_PLANE_ORIGIN: string;
}

class ContainerDispatcher implements AttemptDispatcher {
  constructor(
    private readonly containers: AttemptNamespace,
    private readonly callbackSigningSecret: string,
    private readonly controlPlaneOrigin: string,
  ) {}

  async submit(attempt: Attempt): Promise<void> {
    const id = this.containers.idFromName(attempt.id);
    const attemptSecret = await signCallback(
      this.callbackSigningSecret,
      attempt.id,
    );
    const response = await this.containers.get(id).fetch(
      new Request("https://attempt.invalid/assign", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-roundhouse-attempt-secret": attemptSecret,
          "x-roundhouse-callback-url": new URL(
            "/attempts/callback",
            this.controlPlaneOrigin,
          ).toString(),
        },
        body: JSON.stringify(attempt),
      }),
    );
    if (response.status !== 202) throw new Error("container_dispatch_failed");
  }
}

const worker: ExportedHandler<Env, Wakeup> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/attempts/callback" && request.method === "POST") {
      const input =
        await request.json<Parameters<typeof acceptCallbackAndAdvance>[2]>();
      const outcome = await acceptCallbackAndAdvance(
        new D1RunRepository(env.DB),
        await signCallback(env.CALLBACK_SIGNING_SECRET, input.attemptId),
        input,
        (wakeup) => env.RUN_WAKEUPS.send(wakeup),
      );
      return json(
        { outcome },
        outcome === "unauthorized" ? 401 : outcome === "stale" ? 409 : 202,
      );
    }
    return handleRequest(request);
  },
  async queue(batch, env) {
    const repository = new D1RunRepository(env.DB);
    const dispatcher = new ContainerDispatcher(
      env.ATTEMPT_CONTAINERS,
      env.CALLBACK_SIGNING_SECRET,
      env.CONTROL_PLANE_ORIGIN,
    );
    for (const message of batch.messages) {
      try {
        await coordinate(repository, dispatcher, message.body, Date.now());
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
  async scheduled(_controller, env) {
    const repository = new D1RunRepository(env.DB);
    for (const wakeup of await repository.expiredLeases(Date.now()))
      await env.RUN_WAKEUPS.send(wakeup);
  },
};

export default worker;
