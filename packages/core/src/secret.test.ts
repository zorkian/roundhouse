// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { resolveSecretText } from "./secret.js";

describe("resolveSecretText", () => {
  it("returns a per-Worker secret", async () => {
    await expect(resolveSecretText("secret", "missing")).resolves.toBe(
      "secret",
    );
  });

  it("resolves a Secrets Store binding", async () => {
    const get = vi.fn().mockResolvedValue("stored-secret");
    await expect(resolveSecretText({ get }, "missing")).resolves.toBe(
      "stored-secret",
    );
    expect(get).toHaveBeenCalledOnce();
  });

  it.each([undefined, ""])("rejects a missing value", async (value) => {
    await expect(
      resolveSecretText(value, "required_secret_missing"),
    ).rejects.toThrow("required_secret_missing");
  });
});
