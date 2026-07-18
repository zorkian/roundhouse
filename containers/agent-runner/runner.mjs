// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const runnerIdentity = Object.freeze({
  schemaVersion: 2,
  service: "roundhouse-v2-agent-runner",
});

const jsonHeaders = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
});

function response(status, value, headers = {}) {
  return {
    status,
    headers: { ...jsonHeaders, ...headers },
    body: JSON.stringify(value),
  };
}

export function runnerResponse(method, rawUrl) {
  const path = new URL(rawUrl, "http://runner.invalid").pathname;
  if (path === "/health") {
    if (method !== "GET")
      return response(405, { error: "method_not_allowed" }, { allow: "GET" });
    return response(200, { ...runnerIdentity, ok: true });
  }
  return response(404, { error: "not_found" });
}

export function createRunnerServer() {
  return createServer((request, reply) => {
    const result = runnerResponse(request.method ?? "", request.url ?? "/");
    reply.writeHead(result.status, result.headers);
    reply.end(result.body);
  });
}

function configuredPort() {
  const value = Number.parseInt(process.env.PORT ?? "8080", 10);
  if (!Number.isInteger(value) || value < 1 || value > 65_535)
    throw new Error("invalid_runner_port");
  return value;
}

function start() {
  const server = createRunnerServer();
  server.listen(configuredPort(), "0.0.0.0");

  const shutdown = () => {
    server.close((error) => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === resolve(entry)) start();
