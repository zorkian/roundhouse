// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { pathToFileURL } from "node:url";

import { loadRepositoryProfile } from "@roundhouse/repository-profile";

import { publishApprovedPatch } from "./approved-publication.js";
import { LocalExecutionBackend } from "./local-execution-backend.js";
import { runSupervisedValidation } from "./supervised-validation.js";
import {
  persistValidationArtifacts,
  recordValidationApproval,
  verifyPublicationApproval,
  type ValidationApproval,
} from "./validation-artifacts.js";
import type { ValidationLevel } from "./types.js";

type PrepareInvocation = {
  command: "prepare";
  runId: string;
  baseCommit: string;
  level: ValidationLevel;
  repositoryPath: string;
  profilePath: string;
  artifactRoot: string;
};

type ApproveInvocation = {
  command: "approve";
  runId: string;
  actorId: string;
  baseCommit: string;
  patchSha256: string;
  artifactRoot: string;
};

type VerifyInvocation = {
  command: "verify";
  runId: string;
  artifactRoot: string;
};

type CommitInvocation = {
  command: "commit";
  runId: string;
  message: string;
  repositoryPath: string;
  artifactRoot: string;
};

export type SelfDevelopmentInvocation =
  PrepareInvocation | ApproveInvocation | VerifyInvocation | CommitInvocation;

const commitPattern = /^[a-f0-9]{40}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const runIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

function options(args: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (
      !name?.startsWith("--") ||
      value === undefined ||
      value.startsWith("--")
    )
      throw new Error("Options must use --name value pairs");
    if (result.has(name)) throw new Error(`Duplicate option: ${name}`);
    result.set(name, value);
  }
  return result;
}

function take(
  values: Map<string, string>,
  name: string,
  fallback?: string,
): string {
  const value = values.get(name) ?? fallback;
  values.delete(name);
  if (value === undefined || value.length === 0)
    throw new Error(`Missing required option: ${name}`);
  return value;
}

function finish(values: Map<string, string>): void {
  const unknown = [...values.keys()];
  if (unknown.length > 0) throw new Error(`Unknown option: ${unknown[0]}`);
}

function common(values: Map<string, string>): {
  runId: string;
  artifactRoot: string;
} {
  const runId = take(values, "--run-id");
  if (!runIdPattern.test(runId)) throw new Error("Invalid run ID");
  return {
    runId,
    artifactRoot: take(values, "--artifacts", ".roundhouse/artifacts"),
  };
}

export function parseSelfDevelopmentInvocation(
  argv: string[],
): SelfDevelopmentInvocation {
  const [command, ...rawOptions] = argv;
  if (!command || !["prepare", "approve", "verify", "commit"].includes(command))
    throw new Error("Command must be prepare, approve, verify, or commit");
  const values = options(rawOptions);
  const shared = common(values);

  if (command === "prepare") {
    const baseCommit = take(values, "--base");
    if (!commitPattern.test(baseCommit))
      throw new Error("Base must be a full lowercase commit SHA");
    const level = take(values, "--level", "quick");
    if (!(["quick", "full", "release"] as string[]).includes(level))
      throw new Error("Level must be quick, full, or release");
    const invocation: PrepareInvocation = {
      command,
      ...shared,
      baseCommit,
      level: level as ValidationLevel,
      repositoryPath: take(values, "--repository", process.cwd()),
      profilePath: take(values, "--profile", "profiles/roundhouse.v1.yaml"),
    };
    finish(values);
    return invocation;
  }

  if (command === "approve") {
    const baseCommit = take(values, "--base");
    const patchSha256 = take(values, "--patch-sha256");
    if (!commitPattern.test(baseCommit))
      throw new Error("Base must be a full lowercase commit SHA");
    if (!hashPattern.test(patchSha256))
      throw new Error("Patch SHA-256 must be 64 lowercase hex characters");
    const invocation: ApproveInvocation = {
      command,
      ...shared,
      actorId: take(values, "--actor"),
      baseCommit,
      patchSha256,
    };
    finish(values);
    return invocation;
  }

  if (command === "commit") {
    const invocation: CommitInvocation = {
      command,
      ...shared,
      message: take(values, "--message"),
      repositoryPath: take(values, "--repository", process.cwd()),
    };
    finish(values);
    return invocation;
  }

  const invocation: VerifyInvocation = { command: "verify", ...shared };
  finish(values);
  return invocation;
}

export async function runSelfDevelopmentCli(argv: string[]): Promise<unknown> {
  const invocation = parseSelfDevelopmentInvocation(argv);
  if (invocation.command === "prepare") {
    const profile = await loadRepositoryProfile(invocation.profilePath);
    const result = await runSupervisedValidation({
      repositoryPath: invocation.repositoryPath,
      baseCommit: invocation.baseCommit,
      level: invocation.level,
      profile,
      backend: new LocalExecutionBackend(),
      limits: {
        timeoutMs: profile.validation.timeoutMinutes * 60_000,
        maxOutputBytes: 1024 * 1024,
      },
    });
    if (!result.evidence.succeeded)
      throw new Error(
        `Validation failed at ${result.evidence.failedCommand ?? "unknown"}`,
      );
    const manifest = await persistValidationArtifacts(
      invocation.artifactRoot,
      invocation.runId,
      result,
    );
    return {
      state: "awaiting_approval",
      manifest,
      approval: {
        requiredActorOption: "--actor",
        requiredBase: manifest.baseCommit,
        requiredPatchSha256: manifest.patch.sha256,
      },
    };
  }

  if (invocation.command === "approve") {
    const approval: ValidationApproval = {
      schemaVersion: 1,
      runId: invocation.runId,
      actorId: invocation.actorId,
      baseCommit: invocation.baseCommit,
      patchSha256: invocation.patchSha256,
      approvedAt: new Date().toISOString(),
    };
    await recordValidationApproval(invocation.artifactRoot, approval);
    return { state: "approved", approval };
  }

  if (invocation.command === "commit") {
    return {
      state: "committed",
      publication: await publishApprovedPatch({
        repositoryPath: invocation.repositoryPath,
        artifactRoot: invocation.artifactRoot,
        runId: invocation.runId,
        message: invocation.message,
      }),
    };
  }

  const verified = await verifyPublicationApproval(
    invocation.artifactRoot,
    invocation.runId,
  );
  return {
    state: "ready_for_publication",
    runId: verified.approval.runId,
    actorId: verified.approval.actorId,
    baseCommit: verified.approval.baseCommit,
    patchSha256: verified.approval.patchSha256,
    approvedAt: verified.approval.approvedAt,
  };
}

async function main(): Promise<void> {
  try {
    console.log(
      JSON.stringify(
        await runSelfDevelopmentCli(process.argv.slice(2)),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        { error: error instanceof Error ? error.message : "Unknown error" },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
