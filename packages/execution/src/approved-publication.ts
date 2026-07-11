// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

import { inventoryChangedFiles } from "./changed-files.js";
import { captureRepositoryPatch } from "./supervised-validation.js";
import { verifyPublicationApproval } from "./validation-artifacts.js";

export type ApprovedPublicationInput = {
  repositoryPath: string;
  artifactRoot: string;
  runId: string;
  message: string;
};

export type ApprovedPublicationResult = {
  runId: string;
  actorId: string;
  baseCommit: string;
  commit: string;
  patchSha256: string;
  committedAt: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(
  repositoryPath: string,
  args: string[],
  acceptedExitCodes: number[] = [0],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd: repositoryPath, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
      (error, stdout) => {
        const exitCode =
          error && "code" in error && typeof error.code === "number"
            ? error.code
            : 0;
        if (error && !acceptedExitCodes.includes(exitCode)) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function approvedPaths(
  changedFiles: Awaited<ReturnType<typeof inventoryChangedFiles>>,
): string[] {
  return [
    ...new Set(
      changedFiles.flatMap((change) =>
        change.previousPath
          ? [change.previousPath, change.path]
          : [change.path],
      ),
    ),
  ];
}

async function unstage(repositoryPath: string, paths: string[]): Promise<void> {
  await git(repositoryPath, [
    "restore",
    "--staged",
    "--source=HEAD",
    "--",
    ...paths,
  ]);
}

export async function publishApprovedPatch(
  input: ApprovedPublicationInput,
): Promise<ApprovedPublicationResult> {
  if (!input.message.trim() || input.message.includes("\n"))
    throw new Error("Commit message must be a non-empty single line");
  if (input.message.length > 200)
    throw new Error("Commit message must not exceed 200 characters");

  const verified = await verifyPublicationApproval(
    input.artifactRoot,
    input.runId,
  );
  const head = (await git(input.repositoryPath, ["rev-parse", "HEAD"])).trim();
  if (head !== verified.approval.baseCommit)
    throw new Error("HEAD does not match the approved base commit");

  const staged = await git(input.repositoryPath, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
  ]);
  if (staged.length > 0)
    throw new Error("The Git index contains pre-existing staged changes");

  const changedFiles = await inventoryChangedFiles(
    input.repositoryPath,
    verified.approval.baseCommit,
  );
  const currentPatch = await captureRepositoryPatch(
    input.repositoryPath,
    verified.approval.baseCommit,
    changedFiles,
  );
  if (sha256(currentPatch) !== verified.approval.patchSha256)
    throw new Error("The live working tree does not match the approved patch");

  const paths = approvedPaths(verified.evidence.changedFiles);
  if (paths.length === 0)
    throw new Error("The approved patch has no changed paths");
  await git(input.repositoryPath, ["add", "--all", "--", ...paths]);

  try {
    const stagedPatch = await git(input.repositoryPath, [
      "diff",
      "--cached",
      "--binary",
      "--no-ext-diff",
      verified.approval.baseCommit,
      "--",
    ]);
    if (sha256(stagedPatch) !== verified.approval.patchSha256)
      throw new Error("The staged patch does not match the approval");
    await git(input.repositoryPath, [
      "commit",
      "--no-verify",
      "-m",
      input.message,
    ]);
  } catch (error) {
    await unstage(input.repositoryPath, paths);
    throw error;
  }

  const commit = (
    await git(input.repositoryPath, ["rev-parse", "HEAD"])
  ).trim();
  const committedPatch = await git(input.repositoryPath, [
    "diff",
    "--binary",
    "--no-ext-diff",
    verified.approval.baseCommit,
    commit,
    "--",
  ]);
  if (sha256(committedPatch) !== verified.approval.patchSha256)
    throw new Error("Committed patch does not match the approval");

  return {
    runId: input.runId,
    actorId: verified.approval.actorId,
    baseCommit: verified.approval.baseCommit,
    commit,
    patchSha256: verified.approval.patchSha256,
    committedAt: new Date().toISOString(),
  };
}
