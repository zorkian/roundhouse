// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { extractExactPaths, qualifyAndPlan } from "./planning.js";

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
        maxFiles: 2,
        automaticAttemptLimit: 3,
        operatorAttemptLimit: 10,
      },
    });
  });

  it.each([
    [".github/workflows/ci.yml", "protected_path"],
    ["containers/roundhouse-execution/Dockerfile", "protected_path"],
    ["apps/control-plane-worker/migrations/0008.sql", "protected_path"],
    ["apps/control-plane-worker/wrangler.deploy.jsonc", "protected_path"],
    ["LICENSE", "protected_path"],
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
});
