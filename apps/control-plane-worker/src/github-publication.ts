// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  approvalMatches,
  trustedImplementationResultSchema,
  type GitHubPublicationResult,
  type SelfDevelopmentRun,
} from "@roundhouse/self-development/cloudflare";

import type { EvidenceBucketPort } from "./cloudflare-execution.js";
import { GitHubAppGateway } from "./github-gateway.js";

const encoder = new TextEncoder();

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hash(value: Uint8Array): Promise<string> {
  const owned = new Uint8Array(new ArrayBuffer(value.byteLength));
  owned.set(value);
  return hex(await crypto.subtle.digest("SHA-256", owned));
}

export async function publishApprovedGitHubRun(input: {
  run: SelfDevelopmentRun;
  expectedRevision: number;
  branch: string;
  commitMessage: string;
  pullRequestTitle: string;
  issueNumber: number;
  evidence: EvidenceBucketPort;
  github: GitHubAppGateway;
}): Promise<GitHubPublicationResult> {
  const { run } = input;
  if (
    run.state !== "awaiting_publication" ||
    run.revision !== input.expectedRevision ||
    !run.approval ||
    !run.implementation
  )
    throw new Error("Run is not exactly approved for GitHub publication");
  if (
    !approvalMatches(run.approval, {
      runId: run.runId,
      baseCommit: run.task.baseCommit,
      patchSha256: run.implementation.patchSha256,
      evidence: run.evidence.map((value) => ({
        evidenceId: value.evidenceId,
        objectKey: value.objectKey,
        sha256: value.sha256,
        size: value.size,
      })),
    })
  )
    throw new Error("Durable approval does not match complete evidence");

  const retained = await Promise.all(
    run.evidence.map(async (binding) => {
      const object = await input.evidence.get(binding.objectKey);
      if (!object) throw new Error("Approval-bound evidence is unavailable");
      const text = await object.text();
      const bytes = encoder.encode(text);
      if (
        bytes.byteLength !== binding.size ||
        (await hash(bytes)) !== binding.sha256
      )
        throw new Error("Approval-bound evidence failed verification");
      return { binding, text };
    }),
  );
  const implementation = retained.find(
    (value) => value.binding.evidenceId === run.implementation?.evidenceId,
  );
  if (!implementation)
    throw new Error("Implementation evidence is not approval-bound");
  const result = trustedImplementationResultSchema.parse(
    JSON.parse(implementation.text) as unknown,
  );
  if (
    result.runId !== run.runId ||
    result.baseCommit !== run.task.baseCommit ||
    result.patchSha256 !== run.implementation.patchSha256 ||
    !result.publicationManifest
  )
    throw new Error("Implementation publication binding did not match");
  const manifestValue = {
    schemaVersion: result.publicationManifest.schemaVersion,
    baseCommit: result.publicationManifest.baseCommit,
    patchSha256: result.publicationManifest.patchSha256,
    files: result.publicationManifest.files,
  };
  if (
    (await hash(encoder.encode(JSON.stringify(manifestValue)))) !==
    result.publicationManifest.sha256
  )
    throw new Error("Publication manifest failed verification");
  for (const file of result.publicationManifest.files) {
    if (file.operation !== "upsert") continue;
    const bytes = Uint8Array.from(atob(file.contentBase64), (value) =>
      value.charCodeAt(0),
    );
    if (bytes.byteLength !== file.size || (await hash(bytes)) !== file.sha256)
      throw new Error("Publication file failed verification");
  }
  return input.github.publish({
    manifest: result.publicationManifest,
    branch: input.branch,
    commitMessage: input.commitMessage,
    pullRequestTitle: input.pullRequestTitle,
    issueNumber: input.issueNumber,
    approvedAt: run.approval.approvedAt,
  });
}
