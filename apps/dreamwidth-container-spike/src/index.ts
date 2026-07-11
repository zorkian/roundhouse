// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  Container,
  ContainerProxy,
  getContainer,
} from "@cloudflare/containers";
import { z } from "zod";

import { instanceIdSchema, verifyRequestSchema } from "./contracts.js";

export { ContainerProxy };

type Env = {
  CONTAINER_SPIKE_API_TOKEN: string;
  DREAMWIDTH_CONTAINER: DurableObjectNamespace<DreamwidthContainer>;
};

export class DreamwidthContainer extends Container<Env> {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "5m";
  override enableInternet = false;
  override interceptHttps = true;
  override allowedHosts = ["github.com"];
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health")
      return json({ ok: true });

    if (
      request.headers.get("authorization") !==
      `Bearer ${env.CONTAINER_SPIKE_API_TOKEN}`
    ) {
      return json({ error: "Unauthorized" }, 401);
    }

    const match = /^\/instances\/([^/]+)\/(health|verify)$/.exec(url.pathname);
    if (!match?.[1] || !match[2]) return json({ error: "Not found" }, 404);

    try {
      const instanceId = instanceIdSchema.parse(match[1]);
      const operation = match[2];
      const container = getContainer(env.DREAMWIDTH_CONTAINER, instanceId);

      if (request.method === "GET" && operation === "health") {
        return container.fetch("http://container/health");
      }
      if (request.method === "POST" && operation === "verify") {
        if (
          !(request.headers.get("content-type") ?? "").startsWith(
            "application/json",
          )
        ) {
          return json({ error: "Expected application/json" }, 415);
        }
        const input = verifyRequestSchema.parse(await request.json());
        return container.fetch("http://container/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
      }
      return json({ error: "Method not allowed" }, 405);
    } catch (error) {
      if (error instanceof z.ZodError)
        return json({ error: "Invalid request", issues: error.issues }, 400);
      console.error(error);
      return json({ error: "Container operation failed" }, 502);
    }
  },
} satisfies ExportedHandler<Env>;
