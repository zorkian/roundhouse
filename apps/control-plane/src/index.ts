// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { runSchemaVersion } from "@roundhouse/core";

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

const worker: ExportedHandler = {
  fetch(request) {
    return handleRequest(request);
  },
};

export default worker;
