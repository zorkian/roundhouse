// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { PreviewTransportHost } from "./attempt-sandbox-components.js";

export interface PreviewResponse {
  readonly status: number;
  readonly headers: [string, string][];
  readonly body: ArrayBuffer;
}

export class PreviewTransport {
  constructor(private readonly host: PreviewTransportHost) {}

  async fetch(
    attemptId: string,
    url: string,
    port: number,
    init: RequestInit = {},
  ): Promise<PreviewResponse> {
    const startedAt = Date.now();
    const parsedUrl = new URL(url);
    await this.host.trace(attemptId, "preview_fetch_started", undefined, {
      method: init.method ?? "GET",
      path: parsedUrl.pathname,
      port,
    });
    try {
      const response = await this.host.containerFetch(url, init, port);
      const headers: [string, string][] = [];
      response.headers.forEach((value, name) => headers.push([name, value]));
      const body = await response.arrayBuffer();
      await this.host.trace(attemptId, "preview_fetch_completed", startedAt, {
        method: init.method ?? "GET",
        path: parsedUrl.pathname,
        port,
        status: response.status,
        bodyBytes: body.byteLength,
      });
      return { status: response.status, headers, body };
    } catch (error) {
      await this.host.trace(attemptId, "preview_fetch_failed", startedAt, {
        method: init.method ?? "GET",
        path: parsedUrl.pathname,
        port,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
