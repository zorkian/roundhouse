// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { rm, mkdir } from "node:fs/promises";
import { createServer } from "node:http";

const port = 8080;
const workspace = "/workspace";
const maxTailBytes = 16 * 1024;
let busy = false;

function appendTail(current, chunk) {
  const next = Buffer.concat([current, chunk]);
  return next.length <= maxTailBytes
    ? next
    : next.subarray(next.length - maxTailBytes);
}

async function runCommand(label, command, args, timeoutMs, cwd = workspace) {
  const startedAt = new Date();
  const stdoutHash = createHash("sha256");
  const stderrHash = createHash("sha256");
  let stdoutTail = Buffer.alloc(0);
  let stderrTail = Buffer.alloc(0);
  let timedOut = false;

  const child = spawn(command, args, {
    cwd,
    detached: true,
    env: { ...process.env, LJHOME: workspace },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    stdoutHash.update(chunk);
    stdoutTail = appendTail(stdoutTail, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderrHash.update(chunk);
    stderrTail = appendTail(stderrTail, chunk);
  });

  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid) process.kill(-child.pid, "SIGTERM");
  }, timeoutMs);

  const { exitCode, signal } = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => resolve({ exitCode, signal }));
  }).finally(() => clearTimeout(timer));
  const completedAt = new Date();

  return {
    label,
    command: [command, ...args],
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    exitCode,
    signal,
    timedOut,
    stdoutSha256: stdoutHash.digest("hex"),
    stderrSha256: stderrHash.digest("hex"),
    stdoutTail: stdoutTail.toString("utf8"),
    stderrTail: stderrTail.toString("utf8"),
  };
}

async function verify(commit) {
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });

  const stages = [
    ["git-init", "git", ["init", workspace], 10_000, "/"],
    [
      "git-fetch",
      "git",
      [
        "-C",
        workspace,
        "fetch",
        "--depth",
        "1",
        "https://github.com/dreamwidth/dreamwidth.git",
        commit,
      ],
      120_000,
      "/",
    ],
    [
      "git-checkout",
      "git",
      ["-C", workspace, "checkout", "--detach", "FETCH_HEAD"],
      30_000,
      "/",
    ],
    [
      "bootstrap",
      "/bin/bash",
      [
        "-lc",
        'mkdir -p "$LJHOME/ext/local" "$LJHOME/build" && ' +
          '{ ln -ns "$LJHOME/.devcontainer/config/etc/dw-etc" "$LJHOME/ext/local/etc" 2>/dev/null || true; } && ' +
          'ln -snf /opt/dreamwidth-static "$LJHOME/build/static" && service mysql start && t/bin/initialize-db',
      ],
      120_000,
    ],
    [
      "format",
      "perl",
      [
        "/opt/dreamwidth-extlib/bin/tidyall",
        "--check-only",
        "--all",
        "--jobs",
        "10",
      ],
      120_000,
    ],
    ["compile", "prove", ["-v", "t/00-compile.t"], 180_000],
    [
      "targeted",
      "/bin/bash",
      [
        "-lc",
        "prove t/request-*.t t/plack-*.t t/cleaner-*.t t/routing-*.t t/rate-limit.t " +
          "t/auth-*.t t/post.t t/proto-post-edit-roundtrip.t t/entry-lookup.t t/draftset.t " +
          "t/comment-create.t t/entrycomment-create.t t/talkpost-*.t t/privs.t t/caps.t " +
          "t/media-security.t t/captcha-request.t t/settings.t",
      ],
      300_000,
    ],
  ];

  const results = [];
  for (const [label, command, args, timeoutMs, cwd] of stages) {
    const result = await runCommand(label, command, args, timeoutMs, cwd);
    results.push(result);
    if (result.exitCode !== 0) break;
  }
  return {
    commit,
    succeeded:
      results.length === stages.length &&
      results.every((result) => result.exitCode === 0),
    results,
  };
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 8 * 1024) throw new Error("Request body exceeds 8 KiB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function respond(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return respond(response, 200, { ok: true, busy, node: process.version });
    }
    if (request.method !== "POST" || request.url !== "/verify") {
      return respond(response, 404, { error: "Not found" });
    }
    if (busy)
      return respond(response, 409, {
        error: "A verification is already running",
      });

    const input = await readJson(request);
    if (
      !input ||
      typeof input.commit !== "string" ||
      !/^[a-f0-9]{40}$/.test(input.commit)
    ) {
      return respond(response, 400, {
        error: "A full lowercase commit SHA is required",
      });
    }

    busy = true;
    try {
      const result = await verify(input.commit);
      return respond(response, result.succeeded ? 200 : 422, result);
    } finally {
      busy = false;
    }
  } catch (error) {
    console.error(error);
    return respond(response, 500, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}).listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "runner.ready", port }));
});
