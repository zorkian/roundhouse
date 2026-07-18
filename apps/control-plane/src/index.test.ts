// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { RoundhouseAttemptContainer } from "./attempt-container.js";
import {
  controlPlaneService,
  handleRequest,
  successorWakeup,
} from "./index.js";

describe("V2 control plane", () => {
  it("reports a small versioned health contract", async () => {
    const response = handleRequest(new Request("https://v2.invalid/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 2,
      ok: true,
      service: controlPlaneService,
    });
  });

  it("reconciles immediate successor wakeups through review", () => {
    const processed = { runId: "run_1", expectedRevision: 1 };
    const run = {
      schemaVersion: 2,
      id: "run_1",
      repository: "zorkian/roundhouse",
      issueNumber: 1,
      baseCommit: "a".repeat(40),
      currentHead: "a".repeat(40),
      profileVersion: "v2",
      status: "active",
      stage: "reproduce",
      revision: 2,
    } as const;
    expect(successorWakeup(run, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, stage: "plan" }, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, stage: "implement" }, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, stage: "review" }, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, revision: 3 }, processed)).toBeUndefined();
  });

  it("does not expose undeclared routes or methods", async () => {
    const missing = handleRequest(new Request("https://v2.invalid/v1/runs"));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: "not_found" });

    const mutation = handleRequest(
      new Request("https://v2.invalid/health", { method: "POST" }),
    );
    expect(mutation.status).toBe(405);
    expect(mutation.headers.get("allow")).toBe("GET");
  });

  it("registers the private model egress handler with the Containers SDK", () => {
    expect(
      RoundhouseAttemptContainer.outboundByHost?.["model.roundhouse.internal"],
    ).toBeTypeOf("function");
  });
});
