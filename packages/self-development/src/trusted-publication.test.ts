// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { publishTrustedImplementation } from "./trusted-publication.js";
import type {
  ExactApproval,
  PublicationRequest,
  TrustedImplementationResult,
} from "./trusted-loop.js";

const exec = promisify(execFile);
const roots: string[] = [];
const publicUrl = "https://github.com/zorkian/roundhouse.git";

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "roundhouse-trusted-publish-"));
  roots.push(root);
  const bare = join(root, "origin.git");
  const seed = join(root, "seed");
  const implementation = join(root, "implementation");
  const publication = join(root, "publication");
  await git(root, ["init", "--bare", bare]);
  await git(root, ["clone", bare, seed]);
  await git(seed, ["config", "user.name", "Roundhouse Test"]);
  await git(seed, ["config", "user.email", "roundhouse@example.test"]);
  await writeFile(join(seed, "README.md"), "# Fixture\n");
  await git(seed, ["add", "README.md"]);
  await git(seed, ["commit", "-m", "fixture base"]);
  await git(seed, ["branch", "-M", "main"]);
  await git(seed, ["push", "origin", "main"]);
  const baseCommit = (await git(seed, ["rev-parse", "HEAD"])).trim();
  await git(root, ["clone", bare, implementation]);
  await git(implementation, ["checkout", "main"]);
  await git(root, ["clone", bare, publication]);
  await git(publication, ["checkout", "main"]);
  for (const repository of [implementation, publication]) {
    await git(repository, ["remote", "set-url", "origin", publicUrl]);
  }
  const path = "docs/dogfood/trusted-self-development-loop.md";
  await mkdir(join(implementation, "docs/dogfood"), { recursive: true });
  await writeFile(
    join(implementation, path),
    "<!--\nCopyright 2026 Mark Smith\nSPDX-License-Identifier: Apache-2.0\n-->\n\n# Trusted loop dogfood\n",
  );
  await git(implementation, ["add", "--intent-to-add", path]);
  const patch = await git(implementation, [
    "diff",
    "--binary",
    "--full-index",
    "--no-ext-diff",
    "--",
    path,
  ]);
  const now = "2026-07-12T00:00:00.000Z";
  const result: TrustedImplementationResult = {
    schemaVersion: 1,
    runId: "run_trusted_publication_contract",
    attemptId: "run_trusted_publication_contract-prepare-1",
    baseCommit,
    checkoutCommit: baseCommit,
    patch,
    patchSha256: hash(patch),
    patchBytes: Buffer.byteLength(patch),
    changedFiles: [path],
    startedAt: now,
    completedAt: now,
    startupDurationMs: 1,
    checkoutDurationMs: 1,
    agentDurationMs: 1,
    validationDurationMs: 1,
    agent: {
      provider: "codex-subscription",
      outcome: "succeeded",
      summary: "Created the dogfood document.",
      eventBytes: 1,
    },
    validation: [
      {
        name: "license",
        command: "node scripts/check-license-headers.mjs",
        exitCode: 0,
        timedOut: false,
        durationMs: 1,
        stdout: "",
        stderr: "",
        outputTruncated: false,
      },
    ],
    network: {
      checkoutHosts: ["github.com"],
      modelHosts: ["chatgpt.com"],
      agentToolInternetEnabled: false,
      validationInternetEnabled: false,
      deniedHttpProbe: true,
      deniedTcpProbe: true,
    },
    credential: {
      installedAtRuntime: true,
      removedBeforeValidation: true,
      absentFromEvidence: true,
    },
    resources: { diskBytes: 1, memoryBytes: 1 },
  };
  const evidenceJson = JSON.stringify(result);
  const evidenceBinding = {
    evidenceId: "evidence_trusted_publication_contract",
    objectKey: "runs/trusted/publication.json",
    sha256: hash(evidenceJson),
    size: Buffer.byteLength(evidenceJson),
  };
  const validationEvidenceJson = JSON.stringify({
    schemaVersion: 1,
    runId: result.runId,
    checks: ["license"],
  });
  const validationEvidenceBinding = {
    evidenceId: "evidence_trusted_publication_validation",
    objectKey: "runs/trusted/validation.json",
    sha256: hash(validationEvidenceJson),
    size: Buffer.byteLength(validationEvidenceJson),
  };
  const approval: ExactApproval = {
    schemaVersion: 1,
    runId: result.runId,
    baseCommit,
    patchSha256: result.patchSha256,
    evidence: [evidenceBinding, validationEvidenceBinding],
    approver: "mark-smith-delegated-trusted-loop-dogfood",
    approvedAt: now,
  };
  const publicationRequest: PublicationRequest = {
    schemaVersion: 1,
    runId: result.runId,
    expectedRevision: 5,
    approval,
    repositoryUrl: publicUrl,
    baseCommit,
    branch: "codex/dogfood-trusted-loop-contract",
    commitMessage: "Record trusted loop dogfood",
  };
  return {
    bare,
    publication,
    result,
    evidenceJson,
    evidenceBinding,
    validationEvidenceJson,
    validationEvidenceBinding,
    approval,
    publicationRequest,
    path,
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("publishTrustedImplementation", () => {
  it("commits and pushes only the exact approved patch", async () => {
    const value = await fixture();
    const published = await publishTrustedImplementation(
      {
        repositoryPath: value.publication,
        evidence: [
          { json: value.evidenceJson, binding: value.evidenceBinding },
          {
            json: value.validationEvidenceJson,
            binding: value.validationEvidenceBinding,
          },
        ],
        implementationEvidenceId: value.evidenceBinding.evidenceId,
        runRevision: value.publicationRequest.expectedRevision,
        approval: value.approval,
        publication: value.publicationRequest,
        authorName: "Roundhouse",
        authorEmail: "roundhouse@example.test",
      },
      {
        remoteHead: async () => value.result.baseCommit,
        push: async (input) => {
          await git(value.publication, [
            "push",
            `file://${value.bare}`,
            `${input.commit}:refs/heads/${input.branch}`,
          ]);
          return {
            remote: input.remote,
            remoteUrl: input.expectedRemoteUrl,
            branch: input.branch,
            previousHead: null,
            head: input.commit,
          };
        },
      },
    );
    expect(published.patchSha256).toBe(value.result.patchSha256);
    const remote = (
      await git(value.bare, [
        "rev-parse",
        "refs/heads/codex/dogfood-trusted-loop-contract",
      ])
    ).trim();
    expect(remote).toBe(published.commit);
    expect(
      await readFile(join(value.publication, value.path), "utf8"),
    ).toContain("# Trusted loop dogfood");
  });

  it("rejects tampered evidence before modifying the checkout", async () => {
    const value = await fixture();
    await expect(
      publishTrustedImplementation({
        repositoryPath: value.publication,
        evidence: [
          { json: value.evidenceJson, binding: value.evidenceBinding },
          {
            json: value.validationEvidenceJson,
            binding: value.validationEvidenceBinding,
          },
        ],
        implementationEvidenceId: value.evidenceBinding.evidenceId,
        runRevision: value.publicationRequest.expectedRevision + 1,
        approval: value.approval,
        publication: value.publicationRequest,
        authorName: "Roundhouse",
        authorEmail: "roundhouse@example.test",
      }),
    ).rejects.toThrow("Publication revision does not match durable run");
    await expect(
      publishTrustedImplementation({
        repositoryPath: value.publication,
        evidence: [
          {
            json: `${value.evidenceJson} `,
            binding: value.evidenceBinding,
          },
          {
            json: value.validationEvidenceJson,
            binding: value.validationEvidenceBinding,
          },
        ],
        implementationEvidenceId: value.evidenceBinding.evidenceId,
        runRevision: value.publicationRequest.expectedRevision,
        approval: value.approval,
        publication: value.publicationRequest,
        authorName: "Roundhouse",
        authorEmail: "roundhouse@example.test",
      }),
    ).rejects.toThrow("evidence binding");
    expect(
      (await git(value.publication, ["status", "--porcelain"])).trim(),
    ).toBe("");
    await expect(
      publishTrustedImplementation({
        repositoryPath: value.publication,
        evidence: [
          { json: value.evidenceJson, binding: value.evidenceBinding },
          {
            json: value.validationEvidenceJson,
            binding: value.validationEvidenceBinding,
          },
        ],
        implementationEvidenceId: value.evidenceBinding.evidenceId,
        runRevision: value.publicationRequest.expectedRevision,
        approval: value.approval,
        publication: {
          ...value.publicationRequest,
          approval: {
            ...value.approval,
            approvedAt: "2026-07-12T00:00:01.000Z",
          },
        },
        authorName: "Roundhouse",
        authorEmail: "roundhouse@example.test",
      }),
    ).rejects.toThrow("different approval");
  });

  it("classifies malformed approval-bound implementation evidence", async () => {
    const value = await fixture();
    const invalidJson = "{";
    const binding = {
      ...value.evidenceBinding,
      sha256: hash(invalidJson),
      size: Buffer.byteLength(invalidJson),
    };
    const approval = {
      ...value.approval,
      evidence: [binding, value.validationEvidenceBinding],
    };
    await expect(
      publishTrustedImplementation({
        repositoryPath: value.publication,
        evidence: [
          { json: invalidJson, binding },
          {
            json: value.validationEvidenceJson,
            binding: value.validationEvidenceBinding,
          },
        ],
        implementationEvidenceId: binding.evidenceId,
        runRevision: value.publicationRequest.expectedRevision,
        approval,
        publication: { ...value.publicationRequest, approval },
        authorName: "Roundhouse",
        authorEmail: "roundhouse@example.test",
      }),
    ).rejects.toThrow("Implementation evidence is not valid JSON");
  });
});
