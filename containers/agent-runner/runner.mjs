// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { createServer } from "node:http";
import { createHmac } from "node:crypto";
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

const acceptedAttempts = new Set();

export function completionRequest(assignment, callbackUrl, attemptSecret) {
  const acceptedHead = assignment.expectedHead;
  const payload = `${assignment.id}\n${assignment.runRevision}\n${acceptedHead}`;
  const signature = createHmac("sha256", attemptSecret)
    .update(payload)
    .digest("hex");
  return new Request(callbackUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      attemptId: assignment.id,
      expectedRevision: assignment.runRevision,
      acceptedHead,
      result: { outcome: "ok", checkpoint: acceptedHead },
      signature,
    }),
    signal: AbortSignal.timeout(
      Math.max(1, Math.min(30_000, assignment.deadlineAt - Date.now())),
    ),
  });
}

async function completeAssignment(assignment, headers) {
  const callbackUrl = headers["x-roundhouse-callback-url"];
  const attemptSecret = headers["x-roundhouse-attempt-secret"];
  if (typeof callbackUrl !== "string" || typeof attemptSecret !== "string")
    return;
  let lastError;
  for (
    let attempt = 0;
    attempt < 3 && Date.now() < assignment.deadlineAt;
    attempt++
  ) {
    try {
      const response = await fetch(
        completionRequest(assignment, callbackUrl, attemptSecret),
      );
      if (response.ok) return;
      lastError = new Error(`callback_http_${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2)
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw lastError ?? new Error("callback_failed");
}

function response(status, value, headers = {}) {
  return {
    status,
    headers: { ...jsonHeaders, ...headers },
    body: JSON.stringify(value),
  };
}

export function runnerResponse(method, rawUrl, body) {
  const path = new URL(rawUrl, "http://runner.invalid").pathname;
  if (path === "/health") {
    if (method !== "GET")
      return response(405, { error: "method_not_allowed" }, { allow: "GET" });
    return response(200, { ...runnerIdentity, ok: true });
  }
  if (path === "/assign") {
    if (method !== "POST")
      return response(405, { error: "method_not_allowed" }, { allow: "POST" });
    if (
      !body?.id ||
      !body?.runId ||
      !Number.isInteger(body?.runRevision) ||
      !Number.isInteger(body?.deadlineAt) ||
      !/^[a-f0-9]{40}$/.test(body?.expectedHead ?? "")
    )
      return response(400, { error: "invalid_assignment" });
    const duplicate = acceptedAttempts.has(body.id);
    acceptedAttempts.add(body.id);
    return response(202, { accepted: true, attemptId: body.id, duplicate });
  }
  return response(404, { error: "not_found" });
}

export function createRunnerServer() {
  return createServer((request, reply) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      let body;
      try {
        body = chunks.length
          ? JSON.parse(Buffer.concat(chunks).toString())
          : undefined;
      } catch {
        const invalid = response(400, { error: "invalid_json" });
        reply.writeHead(invalid.status, invalid.headers);
        reply.end(invalid.body);
        return;
      }
      const result = runnerResponse(
        request.method ?? "",
        request.url ?? "/",
        body,
      );
      reply.writeHead(result.status, result.headers);
      reply.end(result.body);
      if (result.status === 202 && body && !JSON.parse(result.body).duplicate) {
        const headers = {
          "x-roundhouse-callback-url":
            request.headers["x-roundhouse-callback-url"],
          "x-roundhouse-attempt-secret":
            request.headers["x-roundhouse-attempt-secret"],
        };
        setImmediate(() => {
          completeAssignment(body, headers).catch((error) => {
            console.error("attempt callback failed", error?.message ?? error);
          });
        });
      }
    });
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
