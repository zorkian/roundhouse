// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
  observeBufferedResponse,
  observeResponse,
  observeStreamingResponse,
} from "./index.mjs";

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

  it("redacts a JSON error response instead of logging raw chunks", async () => {
    const write = vi.fn();
    const response = await observeResponse(
      Response.json(
        { token: "secret-token", error: "bad request" },
        { status: 400 },
      ),
      { api: "workers_ai", operation: "run_model" },
      { write },
    );

    await expect(response.json()).resolves.toEqual({
      token: "secret-token",
      error: "bad request",
    });
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "api_response",
        body: { token: "[REDACTED]", error: "bad request" },
      }),
    );
    expect(write).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "api_response_body" }),
    );
  });

  it("does not make a body logging failure an API failure", async () => {
    const write = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("stream failed"));
        },
      }),
      { status: 502 },
    );

    await expect(
      observeBufferedResponse(
        response,
        { api: "github", operation: "request" },
        write,
      ),
    ).resolves.toBe(response);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "api_response_log_failed",
        status: 502,
        error: "stream failed",
      }),
    );
  });
});
