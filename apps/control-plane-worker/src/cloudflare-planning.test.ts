// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  CloudflarePlanningBackend,
  isDeterministicPlanningFailure,
  isRetryablePlanningInterruption,
  planningSchemaDiagnostics,
} from "./cloudflare-planning.js";

const request = {
  schemaVersion: 1 as const,
  attemptId: `planning_${"a".repeat(40)}`,
  repositoryUrl: "https://github.com/zorkian/roundhouse.git" as const,
  baseCommit: "b".repeat(40),
  issueNumber: 31,
  subject: "Expose release identity",
  instructions: "Show the exact release on the status page.",
  timeoutMs: 900_000,
  maxOutputBytes: 256 * 1024,
};

describe("Cloudflare planning backend", () => {
  it("classifies only bounded deployment transport failures as retryable", () => {
    expect(
      isRetryablePlanningInterruption(
        new Error("Durable Object reset because its code was updated."),
      ),
    ).toBe(true);
    expect(isRetryablePlanningInterruption({ overloaded: true })).toBe(true);
    expect(
      isRetryablePlanningInterruption(new Error("Planning output was invalid")),
    ).toBe(false);
  });

  it("classifies invalid output and binding failures as deterministic", () => {
    expect(
      isDeterministicPlanningFailure(
        new Error(
          "Container runner failed with HTTP 400: planning_invalid_structured_output",
        ),
      ),
    ).toBe(true);
    expect(
      isDeterministicPlanningFailure(
        new Error("Planning result binding does not match request"),
      ),
    ).toBe(true);
    expect(
      isDeterministicPlanningFailure(
        new Error(
          "Container runner failed with HTTP 400: planning_credential_leak_detected",
        ),
      ),
    ).toBe(true);
    expect(
      isDeterministicPlanningFailure(
        new Error(
          "Container runner failed with HTTP 400: planning_modified_checkout",
        ),
      ),
    ).toBe(true);
    expect(
      isDeterministicPlanningFailure(new Error("instance disappeared")),
    ).toBe(false);
  });

  it("reports bounded field diagnostics without echoing invalid content", async () => {
    let invocations = 0;
    const backend = new CloudflarePlanningBackend(
      {
        getByName: () => ({
          runJob: async () => ({}),
          runPlanningJob: async () => {
            invocations += 1;
            return {
              schemaVersion: 1,
              attemptId: request.attemptId,
              baseCommit: request.baseCommit,
              status: "proposed",
              summary: "secret-invalid-content",
              exactPaths: [],
              acceptanceCriteria: [],
              questions: [],
              risk: "low",
            };
          },
          destroy: async () => undefined,
        }),
      },
      "credential",
    );
    let failure = "";
    try {
      await backend.execute(request);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    expect(failure).toMatch(
      /Planning result failed schema validation: .*acceptanceCriteria/,
    );
    expect(failure).not.toContain("secret-invalid-content");
    expect(invocations).toBe(1);
  });

  it("bounds unknown schema diagnostics", () => {
    expect(planningSchemaDiagnostics(new Error("raw secret"))).toBe(
      "unknown_contract_violation",
    );
  });

  it("binds a structured result to the exact planning attempt", async () => {
    const backend = new CloudflarePlanningBackend(
      {
        getByName: () => ({
          runJob: async () => ({}),
          runPlanningJob: async () => ({
            schemaVersion: 1,
            attemptId: request.attemptId,
            baseCommit: request.baseCommit,
            status: "proposed",
            summary: "Expose existing release metadata.",
            exactPaths: ["apps/control-plane-worker/src/operator-ui.ts"],
            acceptanceCriteria: ["The status page names the exact release."],
            questions: [],
            duplicateOf: "",
            risk: "low",
          }),
          destroy: async () => undefined,
        }),
      },
      "credential",
    );
    await expect(backend.execute(request)).resolves.toMatchObject({
      status: "proposed",
      attemptId: request.attemptId,
    });
  });

  it("destroys the Container after a binding mismatch", async () => {
    let destroyed = false;
    const backend = new CloudflarePlanningBackend(
      {
        getByName: () => ({
          runJob: async () => ({}),
          runPlanningJob: async () => ({
            schemaVersion: 1,
            attemptId: `planning_${"c".repeat(40)}`,
            baseCommit: request.baseCommit,
            status: "clarification",
            summary: "Clarification is required.",
            exactPaths: [],
            acceptanceCriteria: ["The behavior is specified."],
            questions: ["Which status surface should change?"],
            risk: "medium",
          }),
          destroy: async () => {
            destroyed = true;
          },
        }),
      },
      "credential",
    );
    await expect(backend.execute(request)).rejects.toThrow();
    expect(destroyed).toBe(true);
  });

  it("recovers automatically after a deployment resets the planning object", async () => {
    let invocations = 0;
    let destroyed = 0;
    const waits: number[] = [];
    const backend = new CloudflarePlanningBackend(
      {
        getByName: () => ({
          runJob: async () => ({}),
          runPlanningJob: async () => {
            invocations += 1;
            if (invocations === 1)
              throw new Error(
                "Durable Object reset because its code was updated.",
              );
            return {
              schemaVersion: 1,
              attemptId: request.attemptId,
              baseCommit: request.baseCommit,
              status: "proposed",
              summary: "Expose existing release metadata.",
              exactPaths: ["apps/control-plane-worker/src/operator-ui.ts"],
              acceptanceCriteria: ["The status page names the exact release."],
              questions: [],
              duplicateOf: "",
              risk: "low",
            };
          },
          destroy: async () => {
            destroyed += 1;
          },
        }),
      },
      "credential",
      async (milliseconds) => {
        waits.push(milliseconds);
      },
    );
    await expect(backend.execute(request)).resolves.toMatchObject({
      status: "proposed",
    });
    expect(invocations).toBe(2);
    expect(destroyed).toBe(1);
    expect(waits).toEqual([250]);
  });
});
