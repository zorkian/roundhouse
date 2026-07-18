// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Container } from "@cloudflare/containers";
import type { Attempt } from "@roundhouse/core";

export class RoundhouseAttemptContainer extends Container {
  override defaultPort = 8080;
  override sleepAfter = "35m";

  override async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST")
      return new Response("method_not_allowed", { status: 405 });
    const attempt = await request.json<Attempt>();
    if (attempt.deadlineAt <= Date.now())
      return new Response("attempt_deadline_expired", { status: 409 });

    await this.startAndWaitForPorts({
      ports: this.defaultPort,
      cancellationOptions: { portReadyTimeoutMS: 30_000 },
      startOptions: {
        envVars: { ROUNDHOUSE_ATTEMPT_ID: attempt.id },
        enableInternet: true,
      },
    });
    const response = await this.containerFetch("http://runner/assign", {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(attempt),
    });
    return response.ok
      ? Response.json(
          { accepted: true, attemptId: attempt.id },
          { status: 202 },
        )
      : new Response("runner_rejected", { status: 503 });
  }
}
