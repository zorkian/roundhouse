// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SupervisedValidationResult } from "./supervised-validation.js";
import {
  persistValidationArtifacts,
  recordValidationApproval,
  verifyPublicationApproval,
  type ValidationApproval,
} from "./validation-artifacts.js";

const roots: string[] = [];
const baseCommit = "a".repeat(40);
const patch = "diff --git a/file.ts b/file.ts\n+changed\n";
const patchSha256 = createHash("sha256").update(patch).digest("hex");

function result(): SupervisedValidationResult {
  return {
    patch,
    executions: [],
    evidence: {
      schemaVersion: 1,
      baseCommit,
      requestedLevel: "quick",
      effectiveLevel: "quick",
      changedFiles: [{ path: "file.ts", status: "modified" }],
      reasons: [],
      commands: [],
      succeeded: true,
      patchSha256,
      patchBytes: Buffer.byteLength(patch),
    },
  };
}

function approval(
  overrides: Partial<ValidationApproval> = {},
): ValidationApproval {
  return {
    schemaVersion: 1,
    runId: "run_test",
    actorId: "mark",
    baseCommit,
    patchSha256,
    approvedAt: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "roundhouse-artifacts-"));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("validation artifacts", () => {
  it("persists and verifies an approval bound to the exact patch", async () => {
    const artifactRoot = await root();
    const manifest = await persistValidationArtifacts(
      artifactRoot,
      "run_test",
      result(),
      "2026-07-11T00:00:00.000Z",
    );
    await recordValidationApproval(artifactRoot, approval());

    const verified = await verifyPublicationApproval(artifactRoot, "run_test");
    expect(verified.manifest).toEqual(manifest);
    expect(verified.approval.actorId).toBe("mark");
    expect(
      await readFile(
        join(artifactRoot, "runs/run_test/validation/patch.diff"),
        "utf8",
      ),
    ).toBe(patch);
  });

  it("rejects an approval for a different patch", async () => {
    const artifactRoot = await root();
    await persistValidationArtifacts(artifactRoot, "run_test", result());

    await expect(
      recordValidationApproval(
        artifactRoot,
        approval({ patchSha256: "b".repeat(64) }),
      ),
    ).rejects.toThrow("Approval patch hash does not match validation");
  });

  it("rejects patch tampering after approval", async () => {
    const artifactRoot = await root();
    await persistValidationArtifacts(artifactRoot, "run_test", result());
    await recordValidationApproval(artifactRoot, approval());
    await writeFile(
      join(artifactRoot, "runs/run_test/validation/patch.diff"),
      "tampered\n",
    );

    await expect(
      verifyPublicationApproval(artifactRoot, "run_test"),
    ).rejects.toThrow("Persisted patch does not match its manifest");
  });
});
