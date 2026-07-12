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

const checkoutHosts = ["github.com"];

export { ContainerProxy };

export class RoundhouseExecutionContainer extends Container<ControlPlaneEnv> {
  override defaultPort = 8080;
  override sleepAfter = "1m";
  override enableInternet = false;
  override interceptHttps = true;
  override allowedHosts: string[] = [];

  static override outboundHandlers = {
    auditedCheckout: async (
      request: Request,
      env: ControlPlaneEnv,
      context: { containerId: string; params?: unknown },
    ): Promise<Response> => {
      const url = new URL(request.url);
      if (!checkoutHosts.includes(url.hostname))
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
      return fetch(request);
    },
  };

  private async post(path: string, request: RepositoryExecutionRequest) {
    const response = await this.containerFetch(`http://container${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const value: unknown = await response.json();
    if (!response.ok) throw new Error("Container runner phase failed");
    return value;
  }

  async runJob(
    input: RepositoryExecutionRequest,
  ): Promise<RepositoryExecutionResult> {
    const request = repositoryExecutionRequestSchema.parse(input);
    await this.setAllowedHosts(checkoutHosts);
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
    try {
      await this.post("/prepare", request);
      await this.setOutboundByHosts({});
      await this.setAllowedHosts([]);
      return repositoryExecutionResultSchema.parse(
        await this.post("/execute", request),
      );
    } finally {
      await this.setOutboundByHosts({});
      await this.setAllowedHosts([]);
      await this.stop().catch(() => undefined);
    }
  }
}
