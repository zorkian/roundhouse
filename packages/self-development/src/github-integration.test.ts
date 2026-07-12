// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  approvedGitHubPublicationSchema,
  githubIssueReferenceSchema,
  trustedPublicationManifestSchema,
} from "./github-integration.js";

describe("GitHub integration contracts", () => {
  it("enrolls only the Roundhouse repository", () => {
    expect(
      githubIssueReferenceSchema.parse({
        schemaVersion: 1,
        owner: "zorkian",
        repository: "roundhouse",
        number: 1,
      }),
    ).toMatchObject({ number: 1 });
    expect(() =>
      githubIssueReferenceSchema.parse({
        schemaVersion: 1,
        owner: "someone-else",
        repository: "roundhouse",
        number: 1,
      }),
    ).toThrow();
  });

  it("bounds publication files and branches", () => {
    const manifest = trustedPublicationManifestSchema.parse({
      schemaVersion: 1,
      baseCommit: "a".repeat(40),
      patchSha256: "b".repeat(64),
      files: [
        {
          path: "docs/dogfood/github-integrated-poc.md",
          operation: "upsert",
          contentBase64: Buffer.from("safe text").toString("base64"),
          size: 9,
          sha256: "c".repeat(64),
        },
      ],
      sha256: "d".repeat(64),
    });
    expect(manifest.files).toHaveLength(1);
    expect(() =>
      approvedGitHubPublicationSchema.parse({
        schemaVersion: 1,
        runId: "run_test",
        expectedRevision: 1,
        baseCommit: "a".repeat(40),
        patchSha256: "b".repeat(64),
        implementationEvidenceId: "evidence_test",
        approval: {
          schemaVersion: 1,
          runId: "run_test",
          baseCommit: "a".repeat(40),
          patchSha256: "b".repeat(64),
          evidence: [
            {
              evidenceId: "evidence_test",
              objectKey: "runs/test/evidence.json",
              sha256: "e".repeat(64),
              size: 1,
            },
          ],
          approver: "operator@example.test",
          approvedAt: "2026-07-12T00:00:00.000Z",
        },
        branch: "main",
        commitMessage: "Publish dogfood",
        pullRequestTitle: "Dogfood",
        issueNumber: 1,
      }),
    ).toThrow();
  });
});
