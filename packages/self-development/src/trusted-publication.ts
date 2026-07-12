// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import {
  approvalMatches,
  exactApprovalSchema,
  publicationAuthorEmailSchema,
  publicationAuthorNameSchema,
  publicationRequestSchema,
  trustedImplementationResultSchema,
  type ExactApproval,
  type PublicationRequest,
  type TrustedImplementationResult,
} from "./trusted-loop.js";
import { pushVerifiedCommit } from "./verified-push.js";

const execFileAsync = promisify(execFile);

export type TrustedPublicationInput = {
  repositoryPath: string;
  evidence: Array<{
    json: string;
    binding: ExactApproval["evidence"][number];
  }>;
  implementationEvidenceId: string;
  runRevision: number;
  approval: ExactApproval;
  publication: PublicationRequest;
  remote?: string;
  authorName: string;
  authorEmail: string;
};

export type TrustedPublicationResult = {
  runId: string;
  baseCommit: string;
  patchSha256: string;
  commit: string;
  branch: string;
  remoteUrl: string;
  verifiedAt: string;
};

export type TrustedPublicationDependencies = {
  remoteHead?: (
    repositoryPath: string,
    remote: string,
    branch: string,
  ) => Promise<string | null>;
  push?: typeof pushVerifiedCommit;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function approvalsEqual(left: ExactApproval, right: ExactApproval): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.runId === right.runId &&
    left.baseCommit === right.baseCommit &&
    left.patchSha256 === right.patchSha256 &&
    left.approver === right.approver &&
    left.approvedAt === right.approvedAt &&
    approvalMatches(left, {
      runId: right.runId,
      baseCommit: right.baseCommit,
      patchSha256: right.patchSha256,
      evidence: right.evidence,
    })
  );
}

async function git(
  cwd: string,
  args: string[],
  preserveOutput = false,
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return preserveOutput ? stdout : stdout.trim();
}

function gitWithInput(
  cwd: string,
  args: string[],
  input: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      shell: false,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-16 * 1024);
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`git ${args[0]} failed: ${stderr}`)),
    );
    child.stdin.end(input);
  });
}

async function remoteHead(
  cwd: string,
  remote: string,
  branch: string,
): Promise<string | null> {
  const output = await git(cwd, [
    "ls-remote",
    "--heads",
    remote,
    `refs/heads/${branch}`,
  ]);
  if (!output) return null;
  const head = output.split(/\s+/)[0];
  if (!head || !/^[a-f0-9]{40}$/.test(head))
    throw new Error("Remote returned an invalid branch head");
  return head;
}

async function restoreBase(
  repositoryPath: string,
  baseCommit: string,
): Promise<void> {
  await git(repositoryPath, ["reset", "--hard", baseCommit]);
  await git(repositoryPath, ["clean", "-fd"]);
}

export async function publishTrustedImplementation(
  input: TrustedPublicationInput,
  dependencies: TrustedPublicationDependencies = {},
): Promise<TrustedPublicationResult> {
  const approval = exactApprovalSchema.parse(input.approval);
  const publication = publicationRequestSchema.parse(input.publication);
  if (
    !publicationAuthorNameSchema.safeParse(input.authorName).success ||
    !publicationAuthorEmailSchema.safeParse(input.authorEmail).success
  )
    throw new Error("Publication author identity is invalid");
  if (input.runRevision !== publication.expectedRevision)
    throw new Error("Publication revision does not match durable run");
  if (input.evidence.length !== approval.evidence.length)
    throw new Error("Complete approval evidence is required");
  for (const [index, value] of input.evidence.entries()) {
    const approved = approval.evidence[index];
    if (
      !approved ||
      value.binding.evidenceId !== approved.evidenceId ||
      value.binding.objectKey !== approved.objectKey ||
      value.binding.sha256 !== approved.sha256 ||
      value.binding.size !== approved.size ||
      sha256(value.json) !== value.binding.sha256 ||
      Buffer.byteLength(value.json) !== value.binding.size
    )
      throw new Error("Implementation evidence binding does not match");
  }
  const implementationEvidence = input.evidence.find(
    (value) => value.binding.evidenceId === input.implementationEvidenceId,
  );
  if (!implementationEvidence)
    throw new Error("Implementation evidence is not approval-bound");
  let implementationValue: unknown;
  try {
    implementationValue = JSON.parse(implementationEvidence.json);
  } catch {
    throw new Error("Implementation evidence is not valid JSON");
  }
  const result = trustedImplementationResultSchema.parse(implementationValue);
  if (!approvalsEqual(publication.approval, approval))
    throw new Error("Publication embeds a different approval");
  if (publication.runId !== result.runId || approval.runId !== result.runId)
    throw new Error("Publication run binding does not match");
  if (
    publication.baseCommit !== result.baseCommit ||
    approval.baseCommit !== result.baseCommit
  )
    throw new Error("Publication base binding does not match");
  const patchSha256 = sha256(result.patch);
  if (
    patchSha256 !== result.patchSha256 ||
    Buffer.byteLength(result.patch) !== result.patchBytes
  )
    throw new Error("Implementation patch binding does not match");
  if (
    !approvalMatches(approval, {
      runId: result.runId,
      baseCommit: result.baseCommit,
      patchSha256,
      evidence: input.evidence.map((value) => value.binding),
    })
  )
    throw new Error("Exact approval does not match publication inputs");
  const remote = input.remote ?? "origin";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(remote))
    throw new Error("Publication remote name is invalid");
  if (
    (await git(input.repositoryPath, ["rev-parse", "HEAD"])) !==
    result.baseCommit
  )
    throw new Error("Local HEAD does not match the approved base");
  if ((await git(input.repositoryPath, ["status", "--porcelain"])) !== "")
    throw new Error("Publication workspace is not clean");
  if (
    (await git(input.repositoryPath, ["remote", "get-url", remote])) !==
    publication.repositoryUrl
  )
    throw new Error("Configured remote URL does not match publication");
  if (
    (await (dependencies.remoteHead ?? remoteHead)(
      input.repositoryPath,
      remote,
      "main",
    )) !== result.baseCommit
  )
    throw new Error("Remote base moved after implementation");
  try {
    await gitWithInput(
      input.repositoryPath,
      ["apply", "--index", "--binary", "--whitespace=nowarn", "-"],
      result.patch,
    );
    const stagedPatch = await git(
      input.repositoryPath,
      [
        "diff",
        "--cached",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        result.baseCommit,
        "--",
      ],
      true,
    );
    if (sha256(stagedPatch) !== patchSha256)
      throw new Error("Staged patch does not match exact approval");
  } catch (error) {
    await restoreBase(input.repositoryPath, result.baseCommit);
    throw error;
  }
  await git(input.repositoryPath, [
    "-c",
    `user.name=${input.authorName}`,
    "-c",
    `user.email=${input.authorEmail}`,
    "commit",
    "--no-verify",
    "--no-gpg-sign",
    "-m",
    publication.commitMessage,
  ]);
  const commit = await git(input.repositoryPath, ["rev-parse", "HEAD"]);
  const committedPatch = await git(
    input.repositoryPath,
    [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      result.baseCommit,
      commit,
      "--",
    ],
    true,
  );
  if (sha256(committedPatch) !== patchSha256) {
    await restoreBase(input.repositoryPath, result.baseCommit);
    throw new Error("Committed patch does not match exact approval");
  }
  try {
    await (dependencies.push ?? pushVerifiedCommit)({
      repositoryPath: input.repositoryPath,
      remote,
      expectedRemoteUrl: publication.repositoryUrl,
      branch: publication.branch,
      expectedRemoteHead: null,
      commit,
    });
  } catch (error) {
    let publishedHead: string | null;
    try {
      publishedHead = await (dependencies.remoteHead ?? remoteHead)(
        input.repositoryPath,
        remote,
        publication.branch,
      );
    } catch (verificationError) {
      throw new Error(
        "Push outcome is indeterminate; local commit retained for inspection",
        { cause: verificationError },
      );
    }
    if (publishedHead !== commit) {
      await restoreBase(input.repositoryPath, result.baseCommit);
      throw error;
    }
  }
  return {
    runId: result.runId,
    baseCommit: result.baseCommit,
    patchSha256,
    commit,
    branch: publication.branch,
    remoteUrl: publication.repositoryUrl,
    verifiedAt: new Date().toISOString(),
  };
}
