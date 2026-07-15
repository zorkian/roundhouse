// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  extractExactPaths,
  nonImplementationQualificationSchema,
  planningBindingSchema,
  qualifiedPlanSchema,
  qualifyAndPlan,
  rejectedQualificationSchema,
  selfDevelopmentPathPolicyForProfile,
} from "./planning.js";

const input = {
  issueNumber: 21,
  issueContentSha256: "a".repeat(64),
  subject: "Add a useful operator view",
  instructions: "Implement the requested view.",
  baseCommit: "b".repeat(40),
  requestedPaths: [
    "apps/control-plane-worker/src/operator-ui.ts",
    "apps/control-plane-worker/src/operator-ui.test.ts",
  ],
};

describe("issue qualification and planning", () => {
  it("extracts only the literal exact-scope section", () => {
    expect(
      extractExactPaths(
        `Acceptance criteria:\n\nScope is exactly:\n\n- \`packages/domain/src/a.ts\`\n- packages/domain/src/a.test.ts\n\nDo not change anything else.`,
      ),
    ).toEqual(["packages/domain/src/a.ts", "packages/domain/src/a.test.ts"]);
    expect(extractExactPaths("Change whatever is needed.")).toEqual([]);
  });

  it("produces one deterministic immutable plan", async () => {
    const first = await qualifyAndPlan(input, new Date("2026-07-12T00:00:00Z"));
    const replay = await qualifyAndPlan(
      input,
      new Date("2026-07-12T00:00:00Z"),
    );
    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      status: "proposed",
      risk: "medium",
      exactPaths: [...input.requestedPaths].sort(),
      limits: {
        maxFiles: 12,
        automaticAttemptLimit: 3,
        operatorAttemptLimit: 10,
      },
    });
  });

  it("does not confuse advisory path count with the hard patch file limit", async () => {
    const requestedPaths = Array.from(
      { length: 13 },
      (_, index) => `packages/domain/src/advisory-${index}.ts`,
    );
    await expect(
      qualifyAndPlan(
        { ...input, requestedPaths },
        new Date("2026-07-12T00:00:00Z"),
      ),
    ).resolves.toMatchObject({
      status: "proposed",
      exactPaths: [...requestedPaths].sort(),
      limits: { maxFiles: 12 },
    });
  });

  it("retains the bounded bug reproduction command in the approved plan", async () => {
    await expect(
      qualifyAndPlan(
        {
          ...input,
          bugReproduction: {
            applicability: "applicable",
            command: "pnpm vitest run packages/example.test.ts",
          },
        },
        new Date("2026-07-12T00:00:00Z"),
      ),
    ).resolves.toMatchObject({
      bugReproduction: {
        applicability: "applicable",
        command: "pnpm vitest run packages/example.test.ts",
      },
    });
  });

  it("normalizes the planning agent's empty non-duplicate sentinel", async () => {
    await expect(
      qualifyAndPlan(
        { ...input, duplicateOf: "" },
        new Date("2026-07-12T00:00:00Z"),
      ),
    ).resolves.toMatchObject({ status: "proposed" });
  });

  it("allows planning advice to raise but never lower policy risk", async () => {
    const attemptedDowngrade = await qualifyAndPlan(
      { ...input, suggestedRisk: "low" },
      new Date("2026-07-12T00:00:00Z"),
    );
    expect(attemptedDowngrade).toMatchObject({
      status: "proposed",
      risk: "medium",
    });
    const raised = await qualifyAndPlan(
      {
        ...input,
        requestedPaths: ["docs/v1-plan.md"],
        suggestedRisk: "high",
      },
      new Date("2026-07-12T00:00:00Z"),
    );
    expect(raised).toMatchObject({ status: "proposed", risk: "high" });
  });

  it("enrolls only the exact repository README path", async () => {
    await expect(
      qualifyAndPlan(
        { ...input, requestedPaths: ["README.md"] },
        new Date("2026-07-12T00:00:00Z"),
      ),
    ).resolves.toMatchObject({
      status: "proposed",
      profileVersion: 3,
      exactPaths: ["README.md"],
    });
    await expect(
      qualifyAndPlan(
        { ...input, requestedPaths: ["README.md/nested.md"] },
        new Date("2026-07-12T00:00:00Z"),
      ),
    ).resolves.toMatchObject({
      status: "rejected",
      findings: [
        expect.objectContaining({
          code: "path_not_enrolled",
          path: "README.md/nested.md",
        }),
      ],
    });
  });

  it("decodes historical profile bindings while issuing only the current version", async () => {
    const proposed = await qualifyAndPlan(
      input,
      new Date("2026-07-12T00:00:00Z"),
    );
    expect(proposed).toMatchObject({ profileVersion: 3 });
    expect(
      qualifiedPlanSchema.parse({ ...proposed, profileVersion: 1 }),
    ).toMatchObject({ profileVersion: 1 });
    expect(
      qualifiedPlanSchema.parse({ ...proposed, profileVersion: 2 }),
    ).toMatchObject({ profileVersion: 2 });
    expect(selfDevelopmentPathPolicyForProfile(1)).toBeUndefined();
    expect(selfDevelopmentPathPolicyForProfile(2)).toBeUndefined();
    expect(selfDevelopmentPathPolicyForProfile(3)).toMatchObject({
      maxChangedFiles: 12,
      deniedPrefixes: expect.arrayContaining(["containers/"]),
    });

    const rejected = await qualifyAndPlan(
      { ...input, requestedPaths: ["scripts/not-enrolled.mjs"] },
      new Date("2026-07-12T00:00:00Z"),
    );
    expect(
      rejectedQualificationSchema.parse({ ...rejected, profileVersion: 1 }),
    ).toMatchObject({ profileVersion: 1, status: "rejected" });

    const satisfied = await qualifyAndPlan(
      {
        ...input,
        requestedPaths: [],
        outcome: "already_satisfied",
        evidence: ["The requested behavior is already covered."],
      },
      new Date("2026-07-12T00:00:00Z"),
    );
    expect(
      nonImplementationQualificationSchema.parse({
        ...satisfied,
        profileVersion: 1,
      }),
    ).toMatchObject({ profileVersion: 1, status: "already_satisfied" });

    expect(
      planningBindingSchema.parse({
        planId: `plan_${"a".repeat(40)}`,
        planSha256: "b".repeat(64),
        profileId: "roundhouse-self-development-v1",
        profileVersion: 1,
        issueContentSha256: "c".repeat(64),
        exactPathsSha256: "d".repeat(64),
        approvedBy: "github:zorkian",
        approvedAt: "2026-07-12T00:00:00.000Z",
      }),
    ).toMatchObject({ profileVersion: 1 });
  });

  it("distinguishes non-implementation qualification outcomes", async () => {
    const clarification = await qualifyAndPlan(
      {
        ...input,
        requestedPaths: [],
        understanding: "The desired surface is ambiguous.",
        clarificationQuestions: ["Which status surface should change?"],
      },
      new Date("2026-07-12T00:00:00Z"),
    );
    expect(clarification).toMatchObject({
      status: "needs_clarification",
      questions: ["Which status surface should change?"],
    });

    await expect(
      qualifyAndPlan(
        {
          ...input,
          requestedPaths: [],
          outcome: "already_satisfied",
          understanding: "The behavior exists.",
          evidence: ["packages/domain/src/ids.ts is contract-tested."],
        },
        new Date("2026-07-12T00:00:00Z"),
      ),
    ).resolves.toMatchObject({
      status: "already_satisfied",
      evidence: ["packages/domain/src/ids.ts is contract-tested."],
    });

    await expect(
      qualifyAndPlan(
        {
          ...input,
          requestedPaths: [],
          outcome: "duplicate",
          understanding: "Another issue represents this work.",
          duplicateOf: "zorkian/roundhouse#20",
        },
        new Date("2026-07-12T00:00:00Z"),
      ),
    ).resolves.toMatchObject({
      status: "duplicate",
      duplicateOf: "zorkian/roundhouse#20",
    });
  });

  it.each([
    [".github/workflows/ci.yml", "protected_path"],
    ["containers/roundhouse-execution/Dockerfile", "protected_path"],
    ["apps/control-plane-worker/migrations/0008.sql", "protected_path"],
    ["apps/control-plane-worker/wrangler.deploy.jsonc", "protected_path"],
    ["LICENSE", "protected_path"],
    ["packages/domain/package.json", "protected_path"],
    ["apps/control-plane-worker/package-lock.json", "protected_path"],
    ["scripts/arbitrary.mjs", "path_not_enrolled"],
    ["packages/**/*.ts", "invalid_path"],
    ["../outside", "invalid_path"],
  ])("rejects out-of-policy scope %s", async (path, code) => {
    const decision = await qualifyAndPlan(
      { ...input, requestedPaths: [path] },
      new Date("2026-07-12T00:00:00Z"),
    );
    expect(decision.status).toBe("rejected");
    if (decision.status === "rejected")
      expect(decision.findings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code, path })]),
      );
  });

  it("returns a structured rejection for a large bounded scope", async () => {
    const decision = await qualifyAndPlan(
      {
        ...input,
        requestedPaths: Array.from(
          { length: 101 },
          (_, index) => `packages/domain/src/generated-${index}.ts`,
        ),
      },
      new Date("2026-07-12T00:00:00Z"),
    );
    expect(decision).toMatchObject({
      status: "rejected",
      findings: [expect.objectContaining({ code: "too_many_paths" })],
    });
  });
});
