// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { SelfDevelopmentRun } from "@roundhouse/self-development/cloudflare";
import { describe, expect, it } from "vitest";

import type { EvidenceBucketPort } from "./cloudflare-execution.js";
import type { GitHubAppGateway } from "./github-gateway.js";
import { publishApprovedGitHubRun } from "./github-publication.js";

const encoder = new TextEncoder();

async function hash(value: string): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("approved GitHub publication", () => {
  it("verifies exact approval and retained manifest before calling the gateway", async () => {
    const content = "<!-- SPDX-License-Identifier: Apache-2.0 -->\nDogfood\n";
    const contentBase64 = Buffer.from(content).toString("base64");
    const patch =
      "diff --git a/docs/dogfood/github-integrated-poc.md b/docs/dogfood/github-integrated-poc.md\n";
    const patchSha256 = await hash(patch);
    const manifestValue = {
      schemaVersion: 1 as const,
      baseCommit: "a".repeat(40),
      patchSha256,
      files: [
        {
          path: "docs/dogfood/github-integrated-poc.md",
          operation: "upsert" as const,
          contentBase64,
          size: Buffer.byteLength(content),
          sha256: await hash(content),
        },
      ],
    };
    const result = {
      schemaVersion: 1 as const,
      runId: "run_github_publication",
      attemptId: "run_github_publication-prepare-1",
      baseCommit: "a".repeat(40),
      checkoutCommit: "a".repeat(40),
      patch,
      patchSha256,
      patchBytes: Buffer.byteLength(patch),
      changedFiles: ["docs/dogfood/github-integrated-poc.md"],
      publicationManifest: {
        ...manifestValue,
        sha256: await hash(JSON.stringify(manifestValue)),
      },
      startedAt: "2026-07-12T00:00:00.000Z",
      completedAt: "2026-07-12T00:01:00.000Z",
      startupDurationMs: 1,
      checkoutDurationMs: 1,
      agentDurationMs: 1,
      validationDurationMs: 1,
      agent: {
        provider: "codex-subscription" as const,
        outcome: "succeeded" as const,
        summary: "Created the bounded file.",
        eventBytes: 1,
      },
      validation: [
        {
          name: "license" as const,
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
        checkoutHosts: ["github.com" as const],
        modelHosts: ["chatgpt.com"],
        agentToolInternetEnabled: false as const,
        validationInternetEnabled: false as const,
        deniedHttpProbe: true as const,
        deniedTcpProbe: true as const,
      },
      credential: {
        installedAtRuntime: true as const,
        removedBeforeValidation: true as const,
        absentFromEvidence: true as const,
      },
      resources: { diskBytes: 1, memoryBytes: 1 },
    };
    const evidenceJson = JSON.stringify(result);
    const evidenceSha256 = await hash(evidenceJson);
    const approval = {
      schemaVersion: 1 as const,
      runId: result.runId,
      baseCommit: result.baseCommit,
      patchSha256,
      evidence: [
        {
          evidenceId: "evidence_github_publication",
          objectKey: "runs/github/publication.json",
          sha256: evidenceSha256,
          size: Buffer.byteLength(evidenceJson),
        },
      ],
      approver: "operator@example.test",
      approvedAt: "2026-07-12T00:02:00.000Z",
    };
    const run = {
      schemaVersion: 1,
      runId: result.runId,
      revision: 6,
      task: {
        schemaVersion: 1,
        taskId: "task_github_publication",
        subject: "Dogfood",
        instructions: "Create the file.",
        repositoryPath: "/workspace/roundhouse",
        baseCommit: result.baseCommit,
        validationLevel: "full",
        allowedPaths: result.changedFiles,
        source: {
          kind: "github_issue",
          owner: "zorkian",
          repository: "roundhouse",
          issueNumber: 7,
          issueUrl: "https://github.com/zorkian/roundhouse/issues/7",
          nodeId: "issue-7",
          contentSha256: "b".repeat(64),
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
        publication: {
          remote: "origin",
          remoteUrl: "https://github.com/zorkian/roundhouse.git",
          branch: "codex/dogfood-issue-7",
          expectedRemoteHead: null,
          commitMessage: "Implement issue 7",
          authorName: "Roundhouse Development",
          authorEmail: "roundhouse@example.invalid",
        },
      },
      state: "awaiting_publication",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: approval.approvedAt,
      attempts: [],
      evidence: [
        {
          schemaVersion: 1,
          evidenceId: approval.evidence[0]!.evidenceId,
          attemptId: result.attemptId,
          objectKey: approval.evidence[0]!.objectKey,
          sha256: evidenceSha256,
          size: Buffer.byteLength(evidenceJson),
          mediaType: "application/json",
          createdAt: result.completedAt,
        },
      ],
      implementation: {
        patchSha256,
        patchBytes: result.patchBytes,
        changedFiles: result.changedFiles,
        evidenceId: approval.evidence[0]!.evidenceId,
        objectKey: approval.evidence[0]!.objectKey,
      },
      approval,
      events: [
        {
          sequence: 1,
          type: "run.created",
          state: "created",
          occurredAt: "2026-07-12T00:00:00.000Z",
          detail: {},
        },
      ],
    } as SelfDevelopmentRun;
    const evidence = {
      get: async () => ({ text: async () => evidenceJson }),
    } as unknown as EvidenceBucketPort;
    let published = 0;
    let receivedExpectedHead: string | null | undefined;
    const github = {
      publish: async (input: { expectedRemoteHead: string | null }) => {
        published += 1;
        receivedExpectedHead = input.expectedRemoteHead;
        return {
          schemaVersion: 1 as const,
          repository: "zorkian/roundhouse" as const,
          baseCommit: result.baseCommit,
          patchSha256,
          tree: "c".repeat(40),
          commit: "d".repeat(40),
          branch: "codex/dogfood-issue-7",
          pullRequestNumber: 11,
          pullRequestUrl: "https://github.com/zorkian/roundhouse/pull/11",
          verifiedAt: "2026-07-12T00:03:00.000Z",
          reconciled: false,
        };
      },
    } as unknown as GitHubAppGateway;
    await expect(
      publishApprovedGitHubRun({
        run,
        expectedRevision: 6,
        branch: "codex/dogfood-issue-7",
        commitMessage: "Implement issue 7",
        pullRequestTitle: "Dogfood",
        issueNumber: 7,
        evidence,
        github,
      }),
    ).resolves.toMatchObject({ pullRequestNumber: 11 });
    expect(published).toBe(1);
    expect(receivedExpectedHead).toBeNull();
  });
});
