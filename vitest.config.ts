// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "/tmp/roundhouse-vitest",
  test: {
    include: [
      "apps/**/*.test.ts",
      "containers/**/*.test.mjs",
      "packages/**/*.test.ts",
      "scripts/**/*.test.mjs",
    ],
    testTimeout: 15_000,
  },
});
