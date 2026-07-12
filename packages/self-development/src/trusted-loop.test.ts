// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  approvalMatches,
  exactApprovalSchema,
  publicationRequestSchema,
  repositoryRelativePathSchema,
  trustedImplementationRequestSchema,
  trustedImplementationResultSchema,
} from "./trusted-loop.js";
import { selfDevelopmentRunSchema, selfDevelopmentTaskSchema } from "./task.js";

const binding = {
  evidenceId: "evidence_run_trusted_contract-implement-1",
  objectKey: "runs/run_trusted_contract/attempts/implement-1/result.json",
  sha256: "b".repeat(64),
  size: 123,
};

const approval = exactApprovalSchema.parse({
  schemaVersion: 1,
  runId: "run_trusted_contract",
  baseCommit: "a".repeat(40),
  patchSha256: "c".repeat(64),
  evidence: [binding],
  approver: "mark-smith-delegated-trusted-loop-dogfood",
  approvedAt: "2026-07-12T00:00:00.000Z",
});

describe("trusted self-development contracts", () => {
  it("rejects traversal, absolute paths, and oversized execution envelopes", () => {
    const request = {
      schemaVersion: 1,
      runId: "run_trusted_contract",
      attemptId: "run_trusted_contract-implement-1",
      attemptNumber: 1,
      expectedRevision: 3,
      repositoryUrl: "https://github.com/zorkian/roundhouse.git",
      baseCommit: "a".repeat(40),
      subject: "Document the trusted loop",
      instructions: "Change only the predeclared dogfood document.",
      allowedPaths: ["docs/dogfood/trusted-self-development-loop.md"],
      validationLevel: "full",
      agentTimeoutMs: 1_200_000,
      validationTimeoutMs: 900_000,
      maxPatchBytes: 512 * 1024,
      maxChangedFiles: 50,
      maxOutputBytes: 5 * 1024 * 1024,
      scenario: "success",
    };
    expect(trustedImplementationRequestSchema.parse(request)).toMatchObject({
      allowedPaths: ["docs/dogfood/trusted-self-development-loop.md"],
    });
    for (const path of ["../secret", "/etc/passwd", "docs\\file.md"])
      expect(() =>
        trustedImplementationRequestSchema.parse({
          ...request,
          allowedPaths: [path],
        }),
      ).toThrow();
    expect(() =>
      trustedImplementationRequestSchema.parse({
        ...request,
        runId: `r${"x".repeat(128)}`,
      }),
    ).toThrow();
    expect(() =>
      repositoryRelativePathSchema.parse("docs/../secret"),
    ).toThrow();
    expect(() => repositoryRelativePathSchema.parse("docs/**")).toThrow();
    expect(() =>
      repositoryRelativePathSchema.parse("docs/line\nbreak.md"),
    ).toThrow();
    for (const path of ["docs/./file.md", "docs//file.md", "docs/"])
      expect(() => repositoryRelativePathSchema.parse(path)).toThrow();
    expect(
      trustedImplementationResultSchema.shape.changedFiles.safeParse([])
        .success,
    ).toBe(false);
    expect(
      trustedImplementationResultSchema.shape.patch.safeParse("").success,
    ).toBe(false);
    expect(
      trustedImplementationResultSchema.shape.patchBytes.safeParse(0).success,
    ).toBe(false);
    expect(
      selfDevelopmentRunSchema.shape.implementation
        .unwrap()
        .shape.changedFiles.safeParse([]).success,
    ).toBe(false);
  });

  it("binds approval to the exact run, base, patch, and ordered evidence", () => {
    const expected = {
      runId: approval.runId,
      baseCommit: approval.baseCommit,
      patchSha256: approval.patchSha256,
      evidence: approval.evidence,
    };
    expect(approvalMatches(approval, expected)).toBe(true);
    expect(
      approvalMatches({ ...approval, patchSha256: "d".repeat(64) }, expected),
    ).toBe(false);
    expect(
      approvalMatches(
        { ...approval, evidence: [{ ...binding, size: 124 }] },
        expected,
      ),
    ).toBe(false);
    expect(approvalMatches({ schemaVersion: 1 }, expected)).toBe(false);
  });

  it("allows publication only to a bounded dogfood branch", () => {
    const request = {
      schemaVersion: 1,
      runId: approval.runId,
      expectedRevision: 5,
      approval,
      repositoryUrl: "https://github.com/zorkian/roundhouse.git",
      baseCommit: approval.baseCommit,
      branch: "codex/dogfood-trusted-loop-01",
      commitMessage: "Record trusted self-development dogfood",
    };
    expect(publicationRequestSchema.parse(request).branch).toBe(
      "codex/dogfood-trusted-loop-01",
    );
    expect(() =>
      publicationRequestSchema.parse({ ...request, branch: "main" }),
    ).toThrow();
    expect(() =>
      publicationRequestSchema.parse({
        ...request,
        commitMessage: "first\rsecond",
      }),
    ).toThrow();
    expect(() =>
      publicationRequestSchema.parse({
        ...request,
        commitMessage: "first\tsecond",
      }),
    ).toThrow();
  });

  it("aligns task publication identity with the Git boundary", () => {
    const publication = {
      remote: "origin",
      remoteUrl: "https://github.com/zorkian/roundhouse.git",
      branch: "codex/dogfood-trusted-loop-01",
      expectedRemoteHead: null,
      commitMessage: "Record dogfood",
      authorName: "Roundhouse",
      authorEmail: "roundhouse@example.test",
    };
    const schema = selfDevelopmentTaskSchema.shape.publication;
    expect(schema.safeParse(publication).success).toBe(true);
    expect(
      schema.safeParse({ ...publication, authorName: "Roundhouse\nInjected" })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...publication, authorName: "Roundhouse\tInjected" })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...publication, commitMessage: "Record\tdogfood" })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...publication,
        authorEmail: `${"a".repeat(310)}@example.test`,
      }).success,
    ).toBe(false);
  });
});
