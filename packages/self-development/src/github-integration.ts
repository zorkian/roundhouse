// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

import {
  dogfoodPublicationBranchSchema,
  exactApprovalSchema,
  trustedPublicationManifestSchema,
  type TrustedPublicationManifest,
} from "./trusted-loop.js";

const commitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const githubIssueReferenceSchema = z.object({
  schemaVersion: z.literal(1),
  owner: z.literal("zorkian"),
  repository: z.literal("roundhouse"),
  number: z.number().int().positive(),
});

export type GitHubIssueReference = z.infer<typeof githubIssueReferenceSchema>;

export const githubIssueSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  owner: z.literal("zorkian"),
  repository: z.literal("roundhouse"),
  number: z.number().int().positive(),
  nodeId: z.string().min(1).max(200),
  url: z
    .string()
    .regex(/^https:\/\/github\.com\/zorkian\/roundhouse\/issues\/[1-9][0-9]*$/),
  title: z.string().min(1).max(500),
  body: z.string().max(20_000),
  updatedAt: z.iso.datetime(),
  fetchedAt: z.iso.datetime(),
  contentSha256: sha256Schema,
});

export type GitHubIssueSnapshot = z.infer<typeof githubIssueSnapshotSchema>;

export { trustedPublicationManifestSchema };
export type { TrustedPublicationManifest };

export const approvedGitHubPublicationSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/),
  expectedRevision: z.number().int().positive(),
  baseCommit: commitShaSchema,
  patchSha256: sha256Schema,
  implementationEvidenceId: z.string().min(1).max(200),
  approval: exactApprovalSchema,
  branch: dogfoodPublicationBranchSchema,
  commitMessage: z.string().min(1).max(200),
  pullRequestTitle: z.string().min(1).max(256),
  issueNumber: z.number().int().positive(),
});

export type ApprovedGitHubPublication = z.infer<
  typeof approvedGitHubPublicationSchema
>;

export type GitHubPublicationResult = {
  schemaVersion: 1;
  repository: "zorkian/roundhouse";
  baseCommit: string;
  patchSha256: string;
  tree: string;
  commit: string;
  branch: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  verifiedAt: string;
  reconciled: boolean;
};

export interface GitHubIssueSource {
  fetch(reference: GitHubIssueReference): Promise<GitHubIssueSnapshot>;
}

export interface ApprovedGitHubPublisher {
  publish(request: ApprovedGitHubPublication): Promise<GitHubPublicationResult>;
}
