// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  handleRuntimeHostRequest,
  runtimeHostService,
} from "./runtime-host.js";

describe("runtime host Worker", () => {
  it("identifies the independently deployed runtime boundary", async () => {
    const response = handleRuntimeHostRequest(
      new Request("https://runtime.invalid/health"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: runtimeHostService,
    });
  });
});
