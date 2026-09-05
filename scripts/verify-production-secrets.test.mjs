// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
  assertRuntimeHostSecrets,
  assertSecretStoreInventory,
  cloudflareJson,
  secretStoreRequirements,
} from "./verify-production-secrets.mjs";

const storeId = "store-1";
const configs = [
  {
    env: {
      production: {
        name: "roundhouse-v2-control-plane-production",
        secrets_store_secrets: [
          {
            binding: "CALLBACK_SIGNING_SECRET",
            store_id: storeId,
            secret_name: "callback-secret",
          },
        ],
      },
    },
  },
  {
    env: {
      production: {
        name: "roundhouse-v2-runtime-host-production",
        secrets_store_secrets: [
          {
            binding: "CALLBACK_SIGNING_SECRET",
            store_id: storeId,
            secret_name: "callback-secret",
          },
        ],
      },
    },
  },
];

describe("production secret preflight", () => {
  it("deduplicates Secrets Store bindings from rendered configs", () => {
    expect(secretStoreRequirements(configs)).toEqual([
      { storeId, secretName: "callback-secret" },
    ]);
  });

  it.each([
    ["missing", []],
    [
      "inactive",
      [{ name: "callback-secret", status: "pending", scopes: ["workers"] }],
    ],
    [
      "wrong scope",
      [{ name: "callback-secret", status: "active", scopes: ["ai"] }],
    ],
  ])("rejects a %s Secrets Store entry", (_case, inventory) => {
    expect(() =>
      assertSecretStoreInventory(
        [{ storeId, secretName: "callback-secret" }],
        new Map([[storeId, inventory]]),
      ),
    ).toThrow("missing active workers secret callback-secret");
  });

  it("accepts active Worker-scoped Secrets Store entries", () => {
    expect(() =>
      assertSecretStoreInventory(
        [{ storeId, secretName: "callback-secret" }],
        new Map([
          [
            storeId,
            [
              {
                name: "callback-secret",
                status: "active",
                scopes: ["workers"],
              },
            ],
          ],
        ]),
      ),
    ).not.toThrow();
  });

  it("requires both runtime-host R2 Worker secrets", () => {
    expect(() =>
      assertRuntimeHostSecrets({
        bindings: [{ type: "secret_text", name: "R2_ACCESS_KEY_ID" }],
      }),
    ).toThrow("runtime-host is missing Worker secret R2_SECRET_ACCESS_KEY");
  });

  it("accepts both runtime-host R2 Worker secrets", () => {
    expect(() =>
      assertRuntimeHostSecrets({
        bindings: [
          { type: "secret_text", name: "R2_ACCESS_KEY_ID" },
          { type: "secret_text", name: "R2_SECRET_ACCESS_KEY" },
        ],
      }),
    ).not.toThrow();
  });

  it("retries bounded Cloudflare API failures", async () => {
    const sleep = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(Response.json({ success: true, result: [1] }));

    await expect(
      cloudflareJson("https://api.cloudflare.invalid", "token", {
        attempts: 2,
        fetchImpl,
        retryDelayMs: 0,
        sleep,
      }),
    ).resolves.toEqual([1]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("fails closed on a malformed Cloudflare API response", async () => {
    await expect(
      cloudflareJson("https://api.cloudflare.invalid", "token", {
        attempts: 1,
        fetchImpl: vi.fn(async () => Response.json({ result: [] })),
      }),
    ).rejects.toThrow("Cloudflare API response failed");
  });
});
