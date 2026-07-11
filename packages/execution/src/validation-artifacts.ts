// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type {
  SupervisedValidationResult,
  ValidationEvidence,
} from "./supervised-validation.js";

const runIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;

export type ValidationArtifactManifest = {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  baseCommit: string;
  patch: { path: "patch.diff"; sha256: string; bytes: number };
  evidence: { path: "evidence.json"; sha256: string; bytes: number };
};

export type ValidationApproval = {
  schemaVersion: 1;
  runId: string;
  actorId: string;
  baseCommit: string;
  patchSha256: string;
  approvedAt: string;
};

export type VerifiedPublicationApproval = {
  manifest: ValidationArtifactManifest;
  evidence: ValidationEvidence;
  approval: ValidationApproval;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function byteLength(value: string): number {
  return Buffer.byteLength(value);
}

function assertRunId(runId: string): void {
  if (!runIdPattern.test(runId)) throw new Error("Invalid run ID");
}

function validationDirectory(root: string, runId: string): string {
  assertRunId(runId);
  return join(root, "runs", runId, "validation");
}

function parseJson<T>(source: string, label: string): T {
  try {
    return JSON.parse(source) as T;
  } catch {
    throw new Error(`Invalid ${label} JSON`);
  }
}

function validateApproval(approval: ValidationApproval): void {
  assertRunId(approval.runId);
  if (approval.schemaVersion !== 1) throw new Error("Invalid approval schema");
  if (!approval.actorId.trim()) throw new Error("Approval actor is required");
  if (!commitPattern.test(approval.baseCommit))
    throw new Error("Approval base commit is invalid");
  if (!sha256Pattern.test(approval.patchSha256))
    throw new Error("Approval patch hash is invalid");
  if (Number.isNaN(Date.parse(approval.approvedAt)))
    throw new Error("Approval timestamp is invalid");
}

async function readAndVerifyArtifacts(
  root: string,
  runId: string,
): Promise<{
  manifest: ValidationArtifactManifest;
  evidence: ValidationEvidence;
}> {
  const directory = validationDirectory(root, runId);
  const [manifestSource, patch, evidenceSource] = await Promise.all([
    readFile(join(directory, "manifest.json"), "utf8"),
    readFile(join(directory, "patch.diff"), "utf8"),
    readFile(join(directory, "evidence.json"), "utf8"),
  ]);
  const manifest = parseJson<ValidationArtifactManifest>(
    manifestSource,
    "artifact manifest",
  );
  const evidence = parseJson<ValidationEvidence>(evidenceSource, "evidence");

  if (
    manifest.schemaVersion !== 1 ||
    manifest.runId !== runId ||
    manifest.patch.path !== "patch.diff" ||
    manifest.evidence.path !== "evidence.json"
  ) {
    throw new Error("Artifact manifest identity is invalid");
  }
  if (
    sha256(patch) !== manifest.patch.sha256 ||
    byteLength(patch) !== manifest.patch.bytes
  ) {
    throw new Error("Persisted patch does not match its manifest");
  }
  if (
    sha256(evidenceSource) !== manifest.evidence.sha256 ||
    byteLength(evidenceSource) !== manifest.evidence.bytes
  ) {
    throw new Error("Persisted evidence does not match its manifest");
  }
  if (
    evidence.baseCommit !== manifest.baseCommit ||
    evidence.patchSha256 !== manifest.patch.sha256 ||
    evidence.patchBytes !== manifest.patch.bytes
  ) {
    throw new Error("Evidence does not match the artifact manifest");
  }
  return { manifest, evidence };
}

export async function persistValidationArtifacts(
  root: string,
  runId: string,
  result: SupervisedValidationResult,
  createdAt = new Date().toISOString(),
): Promise<ValidationArtifactManifest> {
  assertRunId(runId);
  if (!result.evidence.succeeded)
    throw new Error("Failed validation cannot be prepared for approval");
  if (
    sha256(result.patch) !== result.evidence.patchSha256 ||
    byteLength(result.patch) !== result.evidence.patchBytes
  ) {
    throw new Error("Validation patch does not match its evidence");
  }

  const runsDirectory = join(root, "runs");
  await mkdir(runsDirectory, { recursive: true, mode: 0o700 });
  const temporaryDirectory = await mkdtemp(join(runsDirectory, ".validation-"));
  const evidenceSource = `${JSON.stringify(result.evidence, null, 2)}\n`;
  const manifest: ValidationArtifactManifest = {
    schemaVersion: 1,
    runId,
    createdAt,
    baseCommit: result.evidence.baseCommit,
    patch: {
      path: "patch.diff",
      sha256: result.evidence.patchSha256,
      bytes: result.evidence.patchBytes,
    },
    evidence: {
      path: "evidence.json",
      sha256: sha256(evidenceSource),
      bytes: byteLength(evidenceSource),
    },
  };

  try {
    await Promise.all([
      writeFile(join(temporaryDirectory, "patch.diff"), result.patch, {
        mode: 0o600,
      }),
      writeFile(join(temporaryDirectory, "evidence.json"), evidenceSource, {
        mode: 0o600,
      }),
      writeFile(
        join(temporaryDirectory, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { mode: 0o600 },
      ),
    ]);
    await mkdir(join(runsDirectory, runId), { mode: 0o700 });
    await rename(temporaryDirectory, validationDirectory(root, runId));
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

export async function recordValidationApproval(
  root: string,
  approval: ValidationApproval,
): Promise<void> {
  validateApproval(approval);
  const { manifest, evidence } = await readAndVerifyArtifacts(
    root,
    approval.runId,
  );
  if (!evidence.succeeded) throw new Error("Validation did not succeed");
  if (approval.baseCommit !== manifest.baseCommit)
    throw new Error("Approval base commit does not match validation");
  if (approval.patchSha256 !== manifest.patch.sha256)
    throw new Error("Approval patch hash does not match validation");

  await writeFile(
    join(validationDirectory(root, approval.runId), "approval.json"),
    `${JSON.stringify(approval, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
}

export async function verifyPublicationApproval(
  root: string,
  runId: string,
): Promise<VerifiedPublicationApproval> {
  const { manifest, evidence } = await readAndVerifyArtifacts(root, runId);
  const approval = parseJson<ValidationApproval>(
    await readFile(
      join(validationDirectory(root, runId), "approval.json"),
      "utf8",
    ),
    "approval",
  );
  validateApproval(approval);
  if (approval.runId !== runId) throw new Error("Approval run does not match");
  if (approval.baseCommit !== manifest.baseCommit)
    throw new Error("Approved base commit is stale");
  if (approval.patchSha256 !== manifest.patch.sha256)
    throw new Error("Approved patch hash is stale");
  if (!evidence.succeeded)
    throw new Error("Approved validation did not succeed");
  return { manifest, evidence, approval };
}
