// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { connect } from "node:net";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const workspace = "/home/runner/workspace";
const repositoryUrl = "https://github.com/zorkian/roundhouse.git";
const maxBodyBytes = 32 * 1024;
const interceptedCa = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
let prepared;

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validate(value) {
  if (
    value?.schemaVersion !== 1 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value.runId) ||
    typeof value.attemptId !== "string" ||
    value.repositoryUrl !== repositoryUrl ||
    !/^[a-f0-9]{40}$/.test(value.baseCommit) ||
    value.profile !== "roundhouse.v1" ||
    value.command !== "license" ||
    !["success", "nonzero", "timeout", "interrupt-once"].includes(
      value.scenario ?? "success",
    ) ||
    !Number.isInteger(value.timeoutMs) ||
    value.timeoutMs <= 0 ||
    value.timeoutMs > 120_000 ||
    !Number.isInteger(value.maxOutputBytes) ||
    value.maxOutputBytes <= 0 ||
    value.maxOutputBytes > 262_144
  )
    throw new Error("invalid_execution_request");
  return value;
}

async function command(executable, args, options = {}) {
  const started = Date.now();
  const child = spawn(executable, args, {
    cwd: options.cwd ?? workspace,
    env: {
      HOME: "/home/runner",
      PATH: process.env.PATH,
      LANG: "C.UTF-8",
      CI: "1",
      ...(existsSync(interceptedCa) ? { GIT_SSL_CAINFO: interceptedCa } : {}),
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const maximum = options.maxOutputBytes ?? 262_144;
  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let outputTruncated = false;
  const capture = (target, chunk, current) => {
    const remaining = maximum - current;
    if (remaining <= 0) {
      outputTruncated = true;
      return current;
    }
    target.push(chunk.subarray(0, remaining));
    outputTruncated ||= chunk.length > remaining;
    return current + Math.min(chunk.length, remaining);
  };
  child.stdout.on("data", (chunk) => {
    stdoutBytes = capture(stdout, chunk, stdoutBytes);
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes = capture(stderr, chunk, stderrBytes);
  });
  let timedOut = false;
  const timer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, options.timeoutMs)
    : undefined;
  const [exitCode] = await once(child, "close");
  if (timer) clearTimeout(timer);
  return {
    exitCode,
    timedOut,
    durationMs: Date.now() - started,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
    outputTruncated,
  };
}

async function prepare(value) {
  const request = validate(value);
  if (prepared?.attemptId === request.attemptId) return prepared;
  await rm(workspace, { recursive: true, force: true });
  const init = await command("git", ["init", "--quiet", workspace], {
    cwd: "/home/runner",
  });
  if (init.exitCode !== 0) throw new Error("checkout_init_failed");
  const remote = await command("git", [
    "remote",
    "add",
    "origin",
    repositoryUrl,
  ]);
  if (remote.exitCode !== 0) throw new Error("checkout_remote_failed");
  const fetched = await command("git", [
    "fetch",
    "--quiet",
    "--depth=1",
    "origin",
    request.baseCommit,
  ]);
  if (fetched.exitCode !== 0) throw new Error("checkout_fetch_failed");
  const checkout = await command("git", [
    "checkout",
    "--quiet",
    "--detach",
    "FETCH_HEAD",
  ]);
  if (checkout.exitCode !== 0) throw new Error("checkout_failed");
  const head = await command("git", ["rev-parse", "HEAD"]);
  const checkoutCommit = head.stdout.trim();
  if (head.exitCode !== 0 || checkoutCommit !== request.baseCommit)
    throw new Error("checkout_binding_mismatch");
  prepared = {
    schemaVersion: 1,
    runId: request.runId,
    attemptId: request.attemptId,
    baseCommit: request.baseCommit,
    checkoutCommit,
    checkoutDurationMs:
      init.durationMs +
      remote.durationMs +
      fetched.durationMs +
      checkout.durationMs +
      head.durationMs,
  };
  return prepared;
}

async function deniedHttpProbe() {
  try {
    await fetch("https://example.com/", {
      signal: AbortSignal.timeout(2_000),
    });
    return false;
  } catch {
    return true;
  }
}

async function deniedTcpProbe() {
  return new Promise((resolve) => {
    const socket = connect({ host: "1.1.1.1", port: 53, timeout: 2_000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(true);
    });
  });
}

async function resourceUsage() {
  const disk = await command("du", ["-sb", workspace]);
  return {
    diskBytes: Number.parseInt(disk.stdout.split(/\s+/)[0] ?? "0", 10) || 0,
    memoryBytes: process.memoryUsage().rss,
  };
}

async function execute(value) {
  const request = validate(value);
  if (!prepared || prepared.attemptId !== request.attemptId)
    throw new Error("checkout_not_prepared");
  const deniedProbe = (await deniedHttpProbe()) && (await deniedTcpProbe());
  if (!deniedProbe) throw new Error("execution_network_not_denied");
  const scenario = request.scenario ?? "success";
  if (scenario === "interrupt-once" && request.attemptNumber === 1) {
    setTimeout(() => process.exit(99), 10);
    await new Promise(() => undefined);
  }
  const startedAt = new Date();
  const invocation =
    scenario === "nonzero"
      ? ["node", ["-e", "process.exit(23)"]]
      : scenario === "timeout"
        ? ["node", ["-e", "setTimeout(() => {}, 300000)"]]
        : ["pnpm", ["license:check"]];
  const result = await command(invocation[0], invocation[1], {
    timeoutMs: scenario === "timeout" ? 500 : request.timeoutMs,
    maxOutputBytes: request.maxOutputBytes,
  });
  const completedAt = new Date();
  const changed = await command("git", ["status", "--porcelain=v1"]);
  return {
    schemaVersion: 1,
    runId: request.runId,
    attemptId: request.attemptId,
    baseCommit: request.baseCommit,
    checkoutCommit: prepared.checkoutCommit,
    command: "license",
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    stdout: result.stdout,
    stderr: result.stderr,
    outputTruncated: result.outputTruncated,
    changedFiles: changed.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3)),
    network: {
      checkoutHosts: ["github.com"],
      executionInternetEnabled: false,
      deniedProbe,
    },
    resources: await resourceUsage(),
  };
}

createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/ping")
      return json(response, 200, { ok: true });
    if (request.method === "POST" && request.url === "/prepare")
      return json(response, 200, await prepare(await body(request)));
    if (request.method === "POST" && request.url === "/execute")
      return json(response, 200, await execute(await body(request)));
    return json(response, 404, { error: "not_found" });
  } catch (error) {
    return json(response, 400, {
      error: error instanceof Error ? error.message : "runner_error",
    });
  }
}).listen(8080, "0.0.0.0");
