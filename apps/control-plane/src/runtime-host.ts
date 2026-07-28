// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { runSchemaVersion } from "@roundhouse/core";
import { RoundhouseAttemptSandbox } from "./attempt-container.js";

export { ContainerProxy } from "@cloudflare/sandbox";
export { RoundhouseAttemptSandbox } from "./attempt-container.js";

export const runtimeHostService = "roundhouse-v2-runtime-host";

export function handleRuntimeHostRequest(request: Request): Response {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json(
      {
        schemaVersion: runSchemaVersion,
        ok: true,
        service: runtimeHostService,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  return Response.json(
    { error: request.method === "GET" ? "not_found" : "method_not_allowed" },
    {
      status: request.method === "GET" ? 404 : 405,
      headers: { "cache-control": "no-store" },
    },
  );
}

const worker = {
  fetch(request: Request): Response {
    const startedAt = Date.now();
    const response = handleRuntimeHostRequest(request);
    console.log(
      JSON.stringify({
        message: "runtime_host_request_completed",
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
        durationMs: Date.now() - startedAt,
      }),
    );
    return response;
  },
};

export default worker;
