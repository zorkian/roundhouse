// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { RoundhouseAttemptContainer } from "./attempt-container.js";
import { controlPlaneService, handleRequest } from "./index.js";

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
