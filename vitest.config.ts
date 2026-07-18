// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  cacheDir: "/tmp/roundhouse-vitest",
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./tests/cloudflare-workers.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: [
      "apps/**/*.test.ts",
      "apps/**/*.test.mjs",
      "containers/**/*.test.mjs",
      "packages/**/*.test.ts",
    ],
    testTimeout: 15_000,
  },
});
