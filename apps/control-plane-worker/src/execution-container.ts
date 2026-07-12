// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Container, ContainerProxy } from "@cloudflare/containers";
import {
  repositoryExecutionRequestSchema,
  repositoryExecutionResultSchema,
  type RepositoryExecutionRequest,
  type RepositoryExecutionResult,
} from "@roundhouse/self-development/cloudflare";

import type { ControlPlaneEnv } from "./environment.js";
import {
  allowedCheckoutHosts,
  isCheckoutRequestAllowed,
} from "./execution-egress.js";

export { ContainerProxy };

async function auditedCheckout(
  request: Request,
  env: ControlPlaneEnv,
  context: { containerId: string; params?: unknown },
): Promise<Response> {
  const url = new URL(request.url);
  if (!isCheckoutRequestAllowed(request))
    return new Response("Forbidden", { status: 403 });
  const params = context.params as { attemptId?: unknown } | undefined;
  const attemptId = params?.attemptId;
  if (typeof attemptId !== "string")
    return new Response("Forbidden", { status: 403 });
  await env.DB.prepare(
    "INSERT INTO execution_egress_events(event_id, attempt_id, container_id, hostname, method, occurred_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      attemptId,
      context.containerId,
      url.hostname,
      request.method,
      new Date().toISOString(),
    )
    .run();
  return fetch(request, { redirect: "manual" });
}

export class RoundhouseExecutionContainer extends Container<ControlPlaneEnv> {
  override defaultPort = 8080;
  override sleepAfter = "1m";
  override enableInternet = false;
  override interceptHttps = true;
  override allowedHosts: string[] = [];

  private async post(path: string, request: RepositoryExecutionRequest) {
    const response = await this.containerFetch(`http://container${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const text = await response.text();
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(
        `Container runner ${path} returned non-JSON HTTP ${response.status}`,
      );
    }
    if (!response.ok) {
      const detail =
        typeof value === "object" &&
        value !== null &&
        "error" in value &&
        typeof value.error === "string"
          ? value.error.slice(0, 160)
          : "unknown runner error";
      throw new Error(
        `Container runner ${path} failed with HTTP ${response.status}: ${detail}`,
      );
    }
    return value;
  }

  async runJob(
    input: RepositoryExecutionRequest,
  ): Promise<RepositoryExecutionResult> {
    const request = repositoryExecutionRequestSchema.parse(input);
    const startupStarted = Date.now();
    try {
      await this.setAllowedHosts(allowedCheckoutHosts);
      await this.setOutboundByHosts({
        "github.com": {
          method: "auditedCheckout",
          params: { attemptId: request.attemptId },
        },
      });
      await this.startAndWaitForPorts({
        ports: 8080,
        startOptions: {
          enableInternet: false,
          envVars: {},
          labels: { attemptId: request.attemptId },
        },
        cancellationOptions: {
          instanceGetTimeoutMS: 30_000,
          portReadyTimeoutMS: 60_000,
          waitInterval: 250,
        },
      });
      const startupDurationMs = Date.now() - startupStarted;
      const prepared = (await this.post("/prepare", request)) as {
        checkoutDurationMs?: unknown;
      };
      await this.setOutboundByHosts({});
      await this.setAllowedHosts([]);
      return repositoryExecutionResultSchema.parse({
        ...((await this.post("/execute", request)) as object),
        startupDurationMs,
        checkoutDurationMs: prepared.checkoutDurationMs,
      });
    } finally {
      const cleanup = await Promise.allSettled([
        this.setOutboundByHosts({}),
        this.setAllowedHosts([]),
        this.destroy(),
      ]);
      const failures = cleanup.filter((result) => result.status === "rejected");
      if (failures.length > 0)
        console.warn("Cloudflare Container cleanup was incomplete", {
          attemptId: request.attemptId,
          failures: failures.length,
        });
    }
  }
}

RoundhouseExecutionContainer.outboundHandlers = { auditedCheckout };
