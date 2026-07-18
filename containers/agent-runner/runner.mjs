// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
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
function workspaceRoot() {
  return process.env.ROUNDHOUSE_WORKSPACE_ROOT ?? "/home/runner/workspaces";
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, stable(child)]),
    );
  return value;
}

function unsignedCallback(assignment, checkpoint) {
  return {
    attemptId: assignment.id,
    expectedRevision: assignment.runRevision,
    checkpoint,
    artifactTokenId: assignment.artifact.tokenId,
    result: { outcome: "ok", checkpoint: checkpoint.outputHead },
  };
}

export function completionRequest(
  assignment,
  checkpoint,
  callbackUrl,
  attemptSecret,
) {
  const unsigned = unsignedCallback(assignment, checkpoint);
  const payload = JSON.stringify(stable(unsigned));
  const signature = createHmac("sha256", attemptSecret)
    .update(payload)
    .digest("hex");
  return new Request(callbackUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...unsigned, signature }),
    signal: AbortSignal.timeout(
      Math.max(1, Math.min(30_000, assignment.deadlineAt - Date.now())),
    ),
  });
}

function gitEnvironment(token) {
  return {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
    GIT_TERMINAL_PROMPT: "0",
  };
}

function command(commandName, args, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(commandName, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [],
      stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", rejectCommand);
    child.once("close", (code) => {
      if (code === 0) resolveCommand(Buffer.concat(stdout).toString().trim());
      else
        rejectCommand(
          new Error(
            `${commandName}_failed_${code}: ${Buffer.concat(stderr).toString().trim()}`,
          ),
        );
    });
  });
}

async function clone(artifact, directory) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(workspaceRoot(), { recursive: true });
  await command("git", ["clone", "--no-checkout", artifact.remote, directory], {
    env: gitEnvironment(artifact.token),
  });
}

export async function createCheckpoint(assignment) {
  const directory = resolve(workspaceRoot(), assignment.id);
  await clone(assignment.artifact, directory);
  await command("git", ["checkout", "--detach", assignment.expectedHead], {
    cwd: directory,
  });
  await command(
    "git",
    [
      "merge-base",
      "--is-ancestor",
      assignment.baseCommit,
      assignment.expectedHead,
    ],
    { cwd: directory },
  );
  if (assignment.artifact.access === "read") {
    return {
      repositoryId: assignment.artifact.repositoryId,
      repository: assignment.artifact.repository,
      baseCommit: assignment.baseCommit,
      inputHead: assignment.expectedHead,
      outputHead: assignment.expectedHead,
      ref: assignment.artifact.ref,
      changedPaths: [],
    };
  }
  const checkpointDirectory = resolve(directory, ".roundhouse", "checkpoints");
  await mkdir(checkpointDirectory, { recursive: true });
  await writeFile(
    resolve(checkpointDirectory, `${assignment.id}.json`),
    `${JSON.stringify({ attemptId: assignment.id, inputHead: assignment.expectedHead })}\n`,
  );
  await command("git", ["add", ".roundhouse/checkpoints"], { cwd: directory });
  const deterministicEnvironment = {
    ...process.env,
    GIT_AUTHOR_NAME: "Roundhouse",
    GIT_AUTHOR_EMAIL: "roundhouse@invalid",
    GIT_COMMITTER_NAME: "Roundhouse",
    GIT_COMMITTER_EMAIL: "roundhouse@invalid",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
  await command(
    "git",
    ["commit", "-m", `Roundhouse checkpoint ${assignment.id}`],
    {
      cwd: directory,
      env: deterministicEnvironment,
    },
  );
  const outputHead = await command("git", ["rev-parse", "HEAD"], {
    cwd: directory,
  });
  const changed = await command(
    "git",
    ["diff", "--name-only", assignment.expectedHead, outputHead],
    { cwd: directory },
  );
  await command("git", ["push", "origin", `HEAD:${assignment.artifact.ref}`], {
    cwd: directory,
    env: gitEnvironment(assignment.artifact.token),
  });
  return {
    repositoryId: assignment.artifact.repositoryId,
    repository: assignment.artifact.repository,
    baseCommit: assignment.baseCommit,
    inputHead: assignment.expectedHead,
    outputHead,
    ref: assignment.artifact.ref,
    changedPaths: changed ? changed.split("\n") : [],
  };
}

export async function validateCheckpoint(assignment) {
  const directory = resolve(workspaceRoot(), `${assignment.id}-validation`);
  await clone(assignment.artifact, directory);
  const checkpoint = assignment.checkpoint;
  await command(
    "git",
    ["cat-file", "-e", `${checkpoint.outputHead}^{commit}`],
    {
      cwd: directory,
    },
  );
  await command(
    "git",
    [
      "merge-base",
      "--is-ancestor",
      checkpoint.inputHead,
      checkpoint.outputHead,
    ],
    { cwd: directory },
  );
  const changed = await command(
    "git",
    ["diff", "--name-only", checkpoint.inputHead, checkpoint.outputHead],
    { cwd: directory },
  );
  const changedPaths = changed ? changed.split("\n") : [];
  if (JSON.stringify(changedPaths) !== JSON.stringify(checkpoint.changedPaths))
    throw new Error("changed_paths_mismatch");
  if (
    changedPaths.some((path) =>
      assignment.protectedPaths.some(
        (protectedPath) =>
          path === protectedPath || path.startsWith(`${protectedPath}/`),
      ),
    )
  )
    throw new Error("protected_path_changed");
}

async function completeAssignment(assignment, headers) {
  const callbackUrl = headers["x-roundhouse-callback-url"];
  const attemptSecret = headers["x-roundhouse-attempt-secret"];
  if (typeof callbackUrl !== "string" || typeof attemptSecret !== "string")
    return;
  const checkpoint = await createCheckpoint(assignment);
  let lastError;
  for (
    let attempt = 0;
    attempt < 3 && Date.now() < assignment.deadlineAt;
    attempt++
  ) {
    try {
      const response = await fetch(
        completionRequest(assignment, checkpoint, callbackUrl, attemptSecret),
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

function validAssignment(body) {
  return Boolean(
    body?.id &&
    body?.runId &&
    Number.isInteger(body?.runRevision) &&
    Number.isInteger(body?.deadlineAt) &&
    /^[a-f0-9]{40}$/.test(body?.baseCommit ?? "") &&
    /^[a-f0-9]{40}$/.test(body?.expectedHead ?? "") &&
    body?.artifact?.repositoryId &&
    body?.artifact?.repository &&
    body?.artifact?.remote?.startsWith("https://") &&
    body?.artifact?.tokenId &&
    body?.artifact?.token &&
    ["read", "write"].includes(body?.artifact?.access) &&
    /^refs\/heads\/[A-Za-z0-9._\/-]+$/.test(body?.artifact?.ref ?? ""),
  );
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
    if (!validAssignment(body))
      return response(400, { error: "invalid_assignment" });
    const duplicate = acceptedAttempts.has(body.id);
    acceptedAttempts.add(body.id);
    return response(202, { accepted: true, attemptId: body.id, duplicate });
  }
  if (path === "/validate") {
    if (method !== "POST")
      return response(405, { error: "method_not_allowed" }, { allow: "POST" });
    if (!validAssignment(body) || !body.checkpoint)
      return response(400, { error: "invalid_validation" });
    return response(202, { accepted: true, attemptId: body.id });
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
      if (request.url === "/validate" && request.method === "POST" && body) {
        validateCheckpoint(body).then(
          () => {
            reply.writeHead(204, jsonHeaders);
            reply.end();
          },
          () => {
            reply.writeHead(422, jsonHeaders);
            reply.end(JSON.stringify({ error: "invalid_checkpoint" }));
          },
        );
        return;
      }
      const result = runnerResponse(
        request.method ?? "",
        request.url ?? "/",
        body,
      );
      reply.writeHead(result.status, result.headers);
      reply.end(result.body);
      if (result.status === 202 && body) {
        {
          const headers = {
            "x-roundhouse-callback-url":
              request.headers["x-roundhouse-callback-url"],
            "x-roundhouse-attempt-secret":
              request.headers["x-roundhouse-attempt-secret"],
          };
          setImmediate(() =>
            completeAssignment(body, headers).catch((error) =>
              console.error("attempt callback failed", error?.message ?? error),
            ),
          );
        }
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
  const shutdown = () =>
    server.close((error) => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
    });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === resolve(entry)) start();
