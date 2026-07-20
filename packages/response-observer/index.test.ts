// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { observeBufferedResponse, observeStreamingResponse } from "./index.mjs";

describe("API response observer", () => {
  it("observes a buffered response without consuming it", async () => {
    const write = vi.fn();
    const response = new Response(
      JSON.stringify({ token: "secret-token", value: "kept" }),
      {
        status: 201,
        headers: {
          authorization: "secret-header",
          "x-request-id": "request-1",
        },
      },
    );

    const observed = await observeBufferedResponse(
      response,
      { api: "github", operation: "create_installation_token" },
      write,
    );

    await expect(observed.json()).resolves.toEqual({
      token: "secret-token",
      value: "kept",
    });
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "api_response",
        status: 201,
        headers: {
          authorization: "[REDACTED]",
          "content-type": "text/plain;charset=UTF-8",
          "x-request-id": "request-1",
        },
        body: { token: "[REDACTED]", value: "kept" },
      }),
    );
  });

  it("observes an ordered stream without buffering or consuming it", async () => {
    const write = vi.fn();
    const onText = vi.fn();
    const response = observeStreamingResponse(
      new Response("upstream detail", { status: 400 }),
      { api: "workers_ai", operation: "run_model" },
      { write, onText },
    );

    await expect(response.text()).resolves.toBe("upstream detail");
    expect(onText).toHaveBeenCalledWith("upstream detail");
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "api_response_body",
        sequence: 0,
        body: "upstream detail",
      }),
    );
  });
});
