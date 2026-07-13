// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";

const sha40 = z.string().regex(/^[a-f0-9]{40}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const imageDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const resourceName = z.string().regex(/^[a-z][a-z0-9-]{1,62}$/);

export const releaseMigrationSchema = z.object({
  order: z.number().int().positive(),
  name: z.string().regex(/^[0-9]{4}_[a-z0-9_]+\.sql$/),
  sha256,
});

export const roundhouseReleaseManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    releaseId: z.string().regex(/^release_[a-f0-9]{40}$/),
    sourceCommit: sha40,
    sourceTree: sha40,
    createdAt: z.iso.datetime(),
    worker: z.object({
      bundleSha256: sha256,
      configurationSchemaSha256: sha256,
    }),
    container: z.object({
      image: resourceName,
      digest: imageDigest,
      dockerfileSha256: sha256,
    }),
    dependencies: z.object({
      lockfileSha256: sha256,
      profileSha256: sha256,
    }),
    migrations: z.array(releaseMigrationSchema).max(100),
    toolchain: z.object({
      node: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
      pnpm: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
      wrangler: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    }),
  })
  .superRefine((value, context) => {
    const ordered = [...value.migrations].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const [index, migration] of ordered.entries()) {
      if (
        migration.order !== index + 1 ||
        value.migrations[index] !== migration
      )
        context.addIssue({
          code: "custom",
          path: ["migrations", index],
          message: "Migrations must be complete and canonically ordered",
        });
    }
  });

export type RoundhouseReleaseManifest = z.infer<
  typeof roundhouseReleaseManifestSchema
>;

export const deploymentEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  environment: z.enum(["development", "production"]),
  releaseId: z.string().regex(/^release_[a-f0-9]{40}$/),
  releaseManifestSha256: sha256,
  sourceCommit: sha40,
  workerName: resourceName,
  workerVersionId: z.uuid(),
  workerBundleSha256: sha256,
  containerApplication: resourceName,
  containerImageDigest: imageDigest,
  appliedMigrations: z.array(releaseMigrationSchema).max(100),
  deployedAt: z.iso.datetime(),
  deployedBy: z.string().min(1).max(200),
  smoke: z.object({
    status: z.literal("passed"),
    completedAt: z.iso.datetime(),
    evidenceSha256: sha256,
  }),
});

export type DeploymentEvidence = z.infer<typeof deploymentEvidenceSchema>;

export const promotionApprovalSchema = z.object({
  schemaVersion: z.literal(1),
  releaseId: z.string().regex(/^release_[a-f0-9]{40}$/),
  releaseManifestSha256: sha256,
  developmentWorkerVersionId: z.uuid(),
  developmentEvidenceSha256: sha256,
  approvedBy: z.string().min(1).max(200),
  approvedAt: z.iso.datetime(),
});

export function assertPromotionBindings(
  release: RoundhouseReleaseManifest,
  releaseManifestSha256: string,
  development: DeploymentEvidence,
  developmentEvidenceSha256: string,
  approval: z.infer<typeof promotionApprovalSchema>,
): void {
  const migrationsMatch =
    JSON.stringify(development.appliedMigrations) ===
    JSON.stringify(release.migrations);
  if (
    development.environment !== "development" ||
    development.releaseId !== release.releaseId ||
    development.releaseManifestSha256 !== releaseManifestSha256 ||
    development.sourceCommit !== release.sourceCommit ||
    development.workerBundleSha256 !== release.worker.bundleSha256 ||
    development.containerImageDigest !== release.container.digest ||
    !migrationsMatch ||
    approval.releaseId !== release.releaseId ||
    approval.releaseManifestSha256 !== releaseManifestSha256 ||
    approval.developmentWorkerVersionId !== development.workerVersionId ||
    approval.developmentEvidenceSha256 !== developmentEvidenceSha256
  )
    throw new Error("Production promotion bindings do not match development");
}
