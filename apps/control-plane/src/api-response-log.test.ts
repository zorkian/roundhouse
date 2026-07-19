// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import { captureApiResponse, readJsonApiResponse } from "./api-response-log.js";

afterEach(() => vi.restoreAllMocks());

describe("API response logging", () => {
  it("logs a JSON response while redacting credentials", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = new Response(
      JSON.stringify({ token: "secret-token", value: "kept" }),
      { status: 201, headers: { "x-request-id": "request-1" } },
    );

    await expect(
      readJsonApiResponse<{ token: string; value: string }>(response, {
        api: "github",
        operation: "create_installation_token",
      }),
    ).resolves.toEqual({ token: "secret-token", value: "kept" });

    const entry = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(entry).toMatchObject({
      message: "api_response",
      api: "github",
      operation: "create_installation_token",
      status: 201,
      headers: { "x-request-id": "request-1" },
      body: { token: "[REDACTED]", value: "kept" },
    });
  });

  it("preserves a captured response for its caller", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const captured = await captureApiResponse(
      new Response("upstream detail", { status: 400 }),
      { api: "attempt_container", operation: "assign" },
    );

    expect(captured.status).toBe(400);
    await expect(captured.text()).resolves.toBe("upstream detail");
  });
});
