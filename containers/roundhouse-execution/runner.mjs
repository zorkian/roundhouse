// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { connect } from "node:net";
import { chmod, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const workspace = "/home/runner/workspace";
const repositoryUrl = "https://github.com/zorkian/roundhouse.git";
const maxBodyBytes = 128 * 1024;
const interceptedCa = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
let prepared;
let trusted;
const codexHome = "/home/runner/.roundhouse-codex";

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
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(value.attemptId) ||
    !Number.isInteger(value.attemptNumber) ||
    value.attemptNumber <= 0 ||
    !Number.isInteger(value.expectedRevision) ||
    value.expectedRevision <= 0 ||
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

export function validRepositoryPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 300 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/[?*[\]{}!]/.test(value) &&
    value
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function validateTrusted(value) {
  if (
    value?.schemaVersion !== 1 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value.runId) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(value.attemptId) ||
    !Number.isInteger(value.attemptNumber) ||
    value.attemptNumber <= 0 ||
    !Number.isInteger(value.expectedRevision) ||
    value.expectedRevision <= 0 ||
    value.repositoryUrl !== repositoryUrl ||
    !/^[a-f0-9]{40}$/.test(value.baseCommit) ||
    typeof value.subject !== "string" ||
    value.subject.length < 1 ||
    value.subject.length > 500 ||
    typeof value.instructions !== "string" ||
    value.instructions.length < 1 ||
    value.instructions.length > 20_000 ||
    !Array.isArray(value.allowedPaths) ||
    value.allowedPaths.length < 1 ||
    value.allowedPaths.length > 50 ||
    !value.allowedPaths.every(validRepositoryPath) ||
    !["quick", "full"].includes(value.validationLevel) ||
    !Number.isInteger(value.agentTimeoutMs) ||
    value.agentTimeoutMs <= 0 ||
    value.agentTimeoutMs > 1_200_000 ||
    !Number.isInteger(value.validationTimeoutMs) ||
    value.validationTimeoutMs <= 0 ||
    value.validationTimeoutMs > 900_000 ||
    !Number.isInteger(value.maxPatchBytes) ||
    value.maxPatchBytes <= 0 ||
    value.maxPatchBytes > 512 * 1024 ||
    !Number.isInteger(value.maxChangedFiles) ||
    value.maxChangedFiles <= 0 ||
    value.maxChangedFiles > 50 ||
    !Number.isInteger(value.maxOutputBytes) ||
    value.maxOutputBytes <= 0 ||
    value.maxOutputBytes > 5 * 1024 * 1024 ||
    ![
      "success",
      "agent-failure",
      "timeout",
      "interrupt-once",
      "credential-cleanup-failure",
    ].includes(value.scenario ?? "success")
  )
    throw new Error("invalid_trusted_implementation_request");
  return value;
}

export async function command(executable, args, options = {}) {
  const started = Date.now();
  const child = spawn(executable, args, {
    cwd: options.cwd ?? workspace,
    env: {
      HOME: "/home/runner",
      PATH: process.env.PATH,
      LANG: "C.UTF-8",
      CI: "1",
      ...(existsSync(interceptedCa) ? { GIT_SSL_CAINFO: interceptedCa } : {}),
      ...(existsSync(interceptedCa)
        ? { NODE_EXTRA_CA_CERTS: interceptedCa }
        : {}),
      ...(options.env ?? {}),
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
  const exitCode = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback();
    };
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => resolve(code)));
  });
  return {
    exitCode,
    timedOut,
    durationMs: Date.now() - started,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
    outputTruncated,
  };
}

export function pathAllowed(path, allowedPaths) {
  return allowedPaths.includes(path);
}

export function changedPaths(output) {
  const entries = output.split("\0").filter(Boolean);
  const paths = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    if (status.includes("R")) {
      paths.push(entry.slice(3), entries[index + 1]);
      index += 1;
    } else if (status.includes("C")) {
      paths.push(entries[index + 1]);
      index += 1;
    } else paths.push(entry.slice(3));
  }
  return paths.filter(Boolean);
}

function promptFor(request) {
  return [
    "You are a bounded implementation agent in an isolated exact-commit checkout.",
    "Do not inspect credentials or paths outside the checkout.",
    "Do not commit, push, create branches, install packages, or access external services.",
    "Tool network access is disabled.",
    `You may change only: ${request.allowedPaths.join(", ")}`,
    "Keep the patch minimal and include the Apache-2.0 header in new source or documentation files.",
    "Finish with a concise public-safe summary. Never include secrets or authentication data.",
    "",
    `Task: ${request.subject}`,
    request.instructions,
  ].join("\n");
}

function parseCodexEvents(stdout, maximum) {
  let sessionId;
  let inputTokens;
  let outputTokens;
  let summary = "";
  let outcome = "failed";
  const eventBytes = Buffer.byteLength(stdout);
  if (eventBytes > maximum) throw new Error("agent_event_limit_exceeded");
  for (const line of stdout.split("\n").filter(Boolean)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error("agent_invalid_jsonl");
    }
    if (event.type === "thread.started" && typeof event.thread_id === "string")
      sessionId = event.thread_id;
    if (
      event.type === "item.completed" &&
      event.item?.type === "agent_message" &&
      typeof event.item.text === "string"
    )
      summary = event.item.text.slice(-20_000);
    if (event.type === "turn.completed") {
      inputTokens = event.usage?.input_tokens;
      outputTokens = event.usage?.output_tokens;
      outcome = "succeeded";
    }
  }
  return { sessionId, inputTokens, outputTokens, summary, outcome, eventBytes };
}

export function secretStrings(value) {
  const found = [];
  const secretKey = (key) => {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    return (
      normalized.includes("token") ||
      normalized.includes("secret") ||
      normalized.includes("password") ||
      normalized.includes("apikey") ||
      normalized.includes("credential") ||
      normalized === "key" ||
      normalized.includes("privatekey")
    );
  };
  const visit = (current, sensitive = false) => {
    if (typeof current === "string") {
      if (sensitive && current.length >= 8) found.push(current);
    } else if (Array.isArray(current))
      current.forEach((item) => visit(item, sensitive));
    else if (current && typeof current === "object")
      Object.entries(current).forEach(([key, item]) =>
        visit(item, sensitive || secretKey(key)),
      );
  };
  visit(value);
  return found;
}

async function installCredential(value) {
  const request = validateTrusted(value?.request);
  if (
    !prepared ||
    prepared.attemptId !== request.attemptId ||
    prepared.baseCommit !== request.baseCommit
  )
    throw new Error("checkout_not_prepared");
  if (!validRuntimeCredentialSize(value.authJson))
    throw new Error("invalid_runtime_credential");
  let parsed;
  try {
    parsed = JSON.parse(value.authJson);
  } catch {
    throw new Error("invalid_runtime_credential");
  }
  if (!parsed || typeof parsed !== "object")
    throw new Error("invalid_runtime_credential");
  await rm(codexHome, { recursive: true, force: true });
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await writeFile(`${codexHome}/auth.json`, value.authJson, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(codexHome, 0o700);
  trusted = {
    request,
    secrets: secretStrings(parsed),
    credentialInstalled: true,
  };
  return { installed: true };
}

export function validRuntimeCredentialSize(value) {
  return typeof value === "string" && Buffer.byteLength(value) <= 24 * 1024;
}

async function implement(value) {
  const request = validateTrusted(value);
  if (
    !trusted?.credentialInstalled ||
    trusted.request.attemptId !== request.attemptId ||
    trusted.request.baseCommit !== request.baseCommit
  )
    throw new Error("runtime_credential_not_installed");
  const started = Date.now();
  const startedAt = new Date().toISOString();
  if (request.scenario === "interrupt-once" && request.attemptNumber === 1) {
    setTimeout(() => process.exit(98), 10);
    await new Promise(() => undefined);
  }
  const invocation =
    request.scenario === "agent-failure"
      ? ["node", ["-e", "process.exit(29)"]]
      : request.scenario === "timeout"
        ? ["node", ["-e", "setTimeout(() => {}, 300000)"]]
        : [
            "codex",
            [
              "exec",
              "--ephemeral",
              "--ignore-user-config",
              "--ignore-rules",
              "--sandbox",
              "workspace-write",
              "-c",
              "sandbox_workspace_write.network_access=false",
              "-c",
              'shell_environment_policy.inherit="none"',
              "--json",
              "-C",
              workspace,
              promptFor(request),
            ],
          ];
  let agent;
  const credentialSecrets = [...trusted.secrets];
  try {
    const result = await command(invocation[0], invocation[1], {
      timeoutMs: request.scenario === "timeout" ? 500 : request.agentTimeoutMs,
      maxOutputBytes: request.maxOutputBytes,
      env: {
        CODEX_HOME: codexHome,
        HOME: "/home/runner",
        ...(existsSync(interceptedCa) ? { SSL_CERT_FILE: interceptedCa } : {}),
        USERPROFILE: "/home/runner",
      },
    });
    assertCompleteAgentOutput(result);
    agent = parseCodexEvents(result.stdout, request.maxOutputBytes);
    if (result.exitCode !== 0 || agent.outcome !== "succeeded")
      throw new Error(
        `agent_failed: ${boundedAgentFailure(result.stderr, credentialSecrets)}`,
      );
  } finally {
    if (request.scenario !== "credential-cleanup-failure")
      await rm(codexHome, { recursive: true, force: true });
    trusted = withoutRuntimeCredential(trusted);
  }
  if (existsSync(`${codexHome}/auth.json`))
    throw new Error("credential_cleanup_failed");

  const status = await command("git", [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  if (status.exitCode !== 0) throw new Error("changed_file_inventory_failed");
  const files = changedPaths(status.stdout);
  if (files.length === 0) throw new Error("agent_produced_no_changes");
  if (files.length > request.maxChangedFiles)
    throw new Error("changed_file_limit_exceeded");
  if (!files.every((path) => validRepositoryPath(path)))
    throw new Error("invalid_changed_path");
  if (!files.every((path) => pathAllowed(path, request.allowedPaths)))
    throw new Error("changed_path_not_allowed");
  const intentPaths = files.filter((path) =>
    existsSync(`${workspace}/${path}`),
  );
  if (intentPaths.length > 0) {
    const intent = await command("git", [
      "add",
      "--intent-to-add",
      "--",
      ...intentPaths,
    ]);
    if (intent.exitCode !== 0) throw new Error("patch_inventory_failed");
  }
  const diff = await command(
    "git",
    ["diff", "--binary", "--full-index", "--no-ext-diff", "--", ...files],
    { maxOutputBytes: request.maxPatchBytes },
  );
  const patchBytes = Buffer.byteLength(diff.stdout);
  if (diff.exitCode !== 0 || patchBytes === 0)
    throw new Error("patch_capture_failed");
  if (patchBytes > request.maxPatchBytes || diff.outputTruncated)
    throw new Error("patch_limit_exceeded");
  const possibleEvidence = `${diff.stdout}\n${agent.summary}`;
  if (credentialSecrets.some((secret) => possibleEvidence.includes(secret)))
    throw new Error("credential_leak_detected");
  trusted = {
    request,
    agent,
    patch: diff.stdout,
    patchBytes,
    patchSha256: createHash("sha256").update(diff.stdout).digest("hex"),
    changedFiles: files,
    agentDurationMs: Date.now() - started,
    startedAt,
    credentialInstalled: false,
    secrets: [],
  };
  return {
    agent: { ...agent, summary: agent.summary },
    patchSha256: trusted.patchSha256,
    patchBytes,
    changedFiles: files,
    agentDurationMs: trusted.agentDurationMs,
    credentialRemoved: true,
  };
}

export function assertCompleteAgentOutput(result) {
  if (result.timedOut) throw new Error("agent_timeout");
  if (result.outputTruncated) throw new Error("agent_output_truncated");
}

export function withoutRuntimeCredential(state) {
  return { ...state, credentialInstalled: false, secrets: [] };
}

export function boundedAgentFailure(stderr, secrets) {
  let value = typeof stderr === "string" ? stderr : "";
  for (const secret of secrets)
    if (secret) value = value.split(secret).join("[redacted]");
  value = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return (value || "no stderr").slice(-1_000);
}

export function skippedValidation(name, commandName, reason) {
  return {
    name,
    command: commandName,
    exitCode: 0,
    timedOut: false,
    durationMs: 0,
    stdout: reason,
    stderr: "",
    outputTruncated: false,
  };
}

async function validationCommand(name, executable, args, request) {
  const result = await command(executable, args, {
    timeoutMs: request.validationTimeoutMs,
    maxOutputBytes: Math.min(request.maxOutputBytes, 512 * 1024),
  });
  return {
    name,
    command: [executable, ...args].join(" ").slice(0, 500),
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    outputTruncated: result.outputTruncated,
  };
}

async function validateImplementation(value) {
  const request = validateTrusted(value);
  if (
    !trusted ||
    trusted.request.attemptId !== request.attemptId ||
    trusted.request.baseCommit !== request.baseCommit ||
    !trusted.patch
  )
    throw new Error("implementation_not_prepared");
  if (trusted.result) return trusted.result;
  if (existsSync(`${codexHome}/auth.json`))
    throw new Error("credential_present_during_validation");
  const validationStarted = Date.now();
  const deniedHttp = await deniedHttpProbe();
  const deniedTcp = await deniedTcpProbe();
  if (!deniedHttp || !deniedTcp)
    throw new Error("validation_network_not_denied");
  const validation = [];
  validation.push(
    await validationCommand("diff-check", "git", ["diff", "--check"], request),
  );
  const formattable = trusted.changedFiles.filter((path) =>
    /\.(?:cjs|css|html|js|json|jsonc|jsx|md|mdx|mjs|ts|tsx|yaml|yml)$/.test(
      path,
    ),
  );
  validation.push(
    formattable.length > 0
      ? await validationCommand(
          "format",
          "prettier",
          ["--check", "--", ...formattable],
          request,
        )
      : skippedValidation(
          "format",
          "not-applicable",
          "Skipped because no changed file uses a supported formatter",
        ),
  );
  validation.push(
    await validationCommand(
      "license",
      "node",
      ["scripts/check-license-headers.mjs"],
      request,
    ),
  );
  const codeChanged = trusted.changedFiles.some((path) =>
    /\.(?:cjs|js|jsx|mjs|ts|tsx)$/.test(path),
  );
  if (request.validationLevel === "full" && codeChanged) {
    validation.push(
      await validationCommand("typecheck", "pnpm", ["typecheck"], request),
    );
    validation.push(await validationCommand("test", "pnpm", ["test"], request));
  } else {
    const reason = codeChanged
      ? "Skipped because the submitted validation level is quick"
      : "Skipped because the patch changes no JavaScript or TypeScript file";
    validation.push(skippedValidation("typecheck", "not-applicable", reason));
    validation.push(skippedValidation("test", "not-applicable", reason));
  }
  if (
    validation.some(
      (item) => item.exitCode !== 0 || item.timedOut || item.outputTruncated,
    )
  )
    throw new Error("validation_failed");
  const usage = await resourceUsage();
  const publicationManifest = await createPublicationManifest(
    trusted.changedFiles,
    request.baseCommit,
    trusted.patchSha256,
  );
  const result = {
    schemaVersion: 1,
    runId: request.runId,
    attemptId: request.attemptId,
    baseCommit: request.baseCommit,
    checkoutCommit: prepared.checkoutCommit,
    patch: trusted.patch,
    patchSha256: trusted.patchSha256,
    patchBytes: trusted.patchBytes,
    changedFiles: trusted.changedFiles,
    publicationManifest,
    startedAt: trusted.startedAt,
    completedAt: new Date().toISOString(),
    checkoutDurationMs: prepared.checkoutDurationMs,
    agentDurationMs: trusted.agentDurationMs,
    validationDurationMs: Date.now() - validationStarted,
    agent: {
      provider: "codex-subscription",
      sessionId: trusted.agent.sessionId,
      inputTokens: trusted.agent.inputTokens,
      outputTokens: trusted.agent.outputTokens,
      outcome: trusted.agent.outcome,
      summary: trusted.agent.summary,
      eventBytes: trusted.agent.eventBytes,
    },
    validation,
    network: {
      checkoutHosts: ["github.com"],
      modelHosts: ["chatgpt.com", "auth.openai.com"],
      agentToolInternetEnabled: false,
      validationInternetEnabled: false,
      deniedHttpProbe: deniedHttp,
      deniedTcpProbe: deniedTcp,
    },
    credential: {
      installedAtRuntime: true,
      removedBeforeValidation: true,
      absentFromEvidence: true,
    },
    resources: usage,
  };
  trusted.result = result;
  return result;
}

export async function createPublicationManifest(
  paths,
  baseCommit,
  patchSha256,
  root = workspace,
) {
  const files = [];
  let totalBytes = 0;
  for (const path of [...paths].sort()) {
    const absolute = `${root}/${path}`;
    if (!existsSync(absolute)) {
      files.push({ path, operation: "delete" });
      continue;
    }
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("publication_file_type_not_allowed");
    const content = await readFile(absolute);
    totalBytes += content.byteLength;
    if (content.byteLength > 512 * 1024 || totalBytes > 512 * 1024)
      throw new Error("publication_content_limit_exceeded");
    files.push({
      path,
      operation: "upsert",
      contentBase64: content.toString("base64"),
      size: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  const value = { schemaVersion: 1, baseCommit, patchSha256, files };
  return {
    ...value,
    sha256: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  };
}

async function prepare(value, mode) {
  const request = mode === "trusted" ? validateTrusted(value) : validate(value);
  if (prepared?.attemptId === request.attemptId) {
    if (prepared.baseCommit !== request.baseCommit)
      throw new Error("checkout_binding_mismatch");
    return prepared;
  }
  trusted = undefined;
  await rm(codexHome, { recursive: true, force: true });
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
    let settled = false;
    const finish = (denied) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(denied);
    };
    socket.once("connect", () => finish(false));
    socket.once("error", () => finish(true));
    socket.once("timeout", () => finish(true));
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
  if (
    !prepared ||
    prepared.attemptId !== request.attemptId ||
    prepared.baseCommit !== request.baseCommit
  )
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
    checkoutDurationMs: prepared.checkoutDurationMs,
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

if (import.meta.main)
  createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/ping")
        return json(response, 200, { ok: true });
      if (request.method === "POST" && request.url === "/prepare")
        return json(
          response,
          200,
          await prepare(await body(request), "legacy"),
        );
      if (request.method === "POST" && request.url === "/execute")
        return json(response, 200, await execute(await body(request)));
      if (request.method === "POST" && request.url === "/trusted/prepare")
        return json(
          response,
          200,
          await prepare(await body(request), "trusted"),
        );
      if (request.method === "POST" && request.url === "/trusted/credential")
        return json(
          response,
          200,
          await installCredential(await body(request)),
        );
      if (request.method === "POST" && request.url === "/trusted/implement")
        return json(response, 200, await implement(await body(request)));
      if (request.method === "POST" && request.url === "/trusted/validate")
        return json(
          response,
          200,
          await validateImplementation(await body(request)),
        );
      return json(response, 404, { error: "not_found" });
    } catch (error) {
      return json(response, 400, {
        error: error instanceof Error ? error.message : "runner_error",
      });
    }
  }).listen(8080, "0.0.0.0");
