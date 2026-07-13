// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  assertPromotionBindings,
  deploymentEvidenceSchema,
  promotionApprovalSchema,
  roundhouseReleaseManifestSchema,
} from "./release.js";

const a = "a".repeat(40);
const b = "b".repeat(40);
const hash = "c".repeat(64);
const digest = `sha256:${"d".repeat(64)}`;
const version = "11111111-1111-4111-8111-111111111111";

const release = roundhouseReleaseManifestSchema.parse({
  schemaVersion: 1,
  releaseId: `release_${a}`,
  sourceCommit: a,
  sourceTree: b,
  createdAt: "2026-07-13T20:00:00.000Z",
  worker: { bundleSha256: hash, configurationSchemaSha256: hash },
  container: {
    image: "roundhouse-execution",
    digest,
    dockerfileSha256: hash,
  },
  dependencies: { lockfileSha256: hash, profileSha256: hash },
  migrations: [
    { order: 1, name: "0001_control_plane.sql", sha256: hash },
    { order: 2, name: "0002_execution_evidence.sql", sha256: hash },
  ],
  toolchain: { node: "24.4.1", pnpm: "10.13.1", wrangler: "4.110.0" },
});

const development = deploymentEvidenceSchema.parse({
  schemaVersion: 1,
  environment: "development",
  releaseId: release.releaseId,
  releaseManifestSha256: hash,
  sourceCommit: release.sourceCommit,
  workerName: "roundhouse-dev-control-plane",
  workerVersionId: version,
  workerBundleSha256: release.worker.bundleSha256,
  containerApplication: "roundhouse-dev-execution",
  containerImageDigest: release.container.digest,
  appliedMigrations: release.migrations,
  deployedAt: "2026-07-13T20:10:00.000Z",
  deployedBy: "github:zorkian",
  smoke: {
    status: "passed",
    completedAt: "2026-07-13T20:11:00.000Z",
    evidenceSha256: hash,
  },
});

const approval = promotionApprovalSchema.parse({
  schemaVersion: 1,
  releaseId: release.releaseId,
  releaseManifestSha256: development.releaseManifestSha256,
  developmentWorkerVersionId: development.workerVersionId,
  developmentEvidenceSha256: hash,
  approvedBy: "github:zorkian",
  approvedAt: "2026-07-13T20:12:00.000Z",
});

describe("Roundhouse release promotion", () => {
  it("binds production promotion to exact accepted development artifacts", () => {
    expect(() =>
      assertPromotionBindings(release, hash, development, hash, approval),
    ).not.toThrow();
  });

  it("rejects an image change after development acceptance", () => {
    expect(() =>
      assertPromotionBindings(
        release,
        hash,
        { ...development, containerImageDigest: `sha256:${"e".repeat(64)}` },
        hash,
        approval,
      ),
    ).toThrow(/bindings/);
  });

  it("rejects substituted development evidence", () => {
    expect(() =>
      assertPromotionBindings(
        release,
        hash,
        development,
        "e".repeat(64),
        approval,
      ),
    ).toThrow(/bindings/);
  });

  it("rejects an incomplete development migration set", () => {
    expect(() =>
      assertPromotionBindings(
        release,
        hash,
        {
          ...development,
          appliedMigrations: development.appliedMigrations.slice(0, 1),
        },
        hash,
        approval,
      ),
    ).toThrow(/bindings/);
  });

  it("requires canonical, complete migration ordering", () => {
    expect(() =>
      roundhouseReleaseManifestSchema.parse({
        ...release,
        migrations: [...release.migrations].reverse(),
      }),
    ).toThrow();
  });
});
