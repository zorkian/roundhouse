// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertPromotionBindings,
  deploymentEvidenceSchema,
  promotionApprovalSchema,
  roundhouseReleaseManifestSchema,
} from "../../packages/domain/dist/index.js";

const root = resolve(import.meta.dirname, "../..");
const digestPattern = /^sha256:[a-f0-9]{64}$/;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function bytes(path) {
  return readFileSync(resolve(root, path));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashFile(path) {
  return sha256(bytes(path));
}

function jsonFile(path) {
  return JSON.parse(bytes(path).toString("utf8"));
}

function writeJson(path, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(resolve(root, path), serialized, { flag: "wx" });
  process.stdout.write(
    `${JSON.stringify({ path, sha256: sha256(serialized) })}\n`,
  );
}

function migrations() {
  return readdirSync(resolve(root, "apps/control-plane-worker/migrations"))
    .filter((name) => /^[0-9]{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name, index) => ({
      order: index + 1,
      name,
      sha256: hashFile(`apps/control-plane-worker/migrations/${name}`),
    }));
}

function requireArguments(expected, usage) {
  if (process.argv.length !== expected + 3) fail(`Usage: ${usage}`);
}

function manifest() {
  requireArguments(
    3,
    "roundhouse-release.mjs manifest <worker-bundle> <image-digest> <output>",
  );
  const [, , , workerBundle, digest, output] = process.argv;
  if (!digestPattern.test(digest)) fail("Container digest is not immutable");
  const packageJson = jsonFile("package.json");
  const wrangler = jsonFile("node_modules/wrangler/package.json");
  const sourceCommit = git("rev-parse", "HEAD");
  const value = roundhouseReleaseManifestSchema.parse({
    schemaVersion: 1,
    releaseId: `release_${sourceCommit}`,
    sourceCommit,
    sourceTree: git("rev-parse", "HEAD^{tree}"),
    createdAt: new Date().toISOString(),
    worker: {
      bundleSha256: hashFile(workerBundle),
      configurationSchemaSha256: hashFile(
        "apps/control-plane-worker/src/environment.ts",
      ),
    },
    container: {
      image: "roundhouse-execution",
      digest,
      dockerfileSha256: hashFile("containers/roundhouse-execution/Dockerfile"),
    },
    dependencies: {
      lockfileSha256: hashFile("pnpm-lock.yaml"),
      profileSha256: hashFile("profiles/roundhouse.v1.yaml"),
    },
    migrations: migrations(),
    toolchain: {
      node: process.versions.node,
      pnpm: packageJson.packageManager.replace(/^pnpm@/, ""),
      wrangler: wrangler.version,
    },
  });
  writeJson(output, value);
}

function evidence() {
  requireArguments(
    8,
    "roundhouse-release.mjs evidence <environment> <manifest> <worker-name> <worker-version-id> <container-app> <smoke-evidence> <deployed-by> <output>",
  );
  const [
    ,
    ,
    ,
    environment,
    manifestPath,
    workerName,
    workerVersionId,
    containerApplication,
    smokePath,
    deployedBy,
    output,
  ] = process.argv;
  const release = roundhouseReleaseManifestSchema.parse(jsonFile(manifestPath));
  const timestamp = new Date().toISOString();
  writeJson(
    output,
    deploymentEvidenceSchema.parse({
      schemaVersion: 1,
      environment,
      releaseId: release.releaseId,
      releaseManifestSha256: hashFile(manifestPath),
      sourceCommit: release.sourceCommit,
      workerName,
      workerVersionId,
      workerBundleSha256: release.worker.bundleSha256,
      containerApplication,
      containerImageDigest: release.container.digest,
      appliedMigrations: release.migrations,
      deployedAt: timestamp,
      deployedBy,
      smoke: {
        status: "passed",
        completedAt: timestamp,
        evidenceSha256: hashFile(smokePath),
      },
    }),
  );
}

function approval() {
  requireArguments(
    4,
    "roundhouse-release.mjs approval <manifest> <development-evidence> <approved-by> <output>",
  );
  const [, , , manifestPath, evidencePath, approvedBy, output] = process.argv;
  const release = roundhouseReleaseManifestSchema.parse(jsonFile(manifestPath));
  const development = deploymentEvidenceSchema.parse(jsonFile(evidencePath));
  if (
    development.environment !== "development" ||
    development.releaseId !== release.releaseId
  )
    fail("Approval input is not matching development evidence");
  writeJson(
    output,
    promotionApprovalSchema.parse({
      schemaVersion: 1,
      releaseId: release.releaseId,
      releaseManifestSha256: hashFile(manifestPath),
      developmentWorkerVersionId: development.workerVersionId,
      developmentEvidenceSha256: hashFile(evidencePath),
      approvedBy,
      approvedAt: new Date().toISOString(),
    }),
  );
}

function verifyPromotion() {
  requireArguments(
    3,
    "roundhouse-release.mjs verify-promotion <manifest> <development-evidence> <approval>",
  );
  const [, , , manifestPath, evidencePath, approvalPath] = process.argv;
  const release = roundhouseReleaseManifestSchema.parse(jsonFile(manifestPath));
  const development = deploymentEvidenceSchema.parse(jsonFile(evidencePath));
  const approved = promotionApprovalSchema.parse(jsonFile(approvalPath));
  assertPromotionBindings(
    release,
    hashFile(manifestPath),
    development,
    hashFile(evidencePath),
    approved,
  );
  process.stdout.write(
    `${JSON.stringify({ verified: true, releaseId: release.releaseId })}\n`,
  );
}

const command = process.argv[2];
if (command === "manifest") manifest();
else if (command === "evidence") evidence();
else if (command === "approval") approval();
else if (command === "verify-promotion") verifyPromotion();
else fail(`Unknown release command: ${command ?? "(missing)"}`);
