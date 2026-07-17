// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "/tmp/roundhouse-vitest-reproductions",
  resolve: {
    alias: {
      "@roundhouse/repository-profile/contracts": new URL(
        "../../repository-profile/src/contracts.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    include: [
      "packages/self-development/reproductions/exact-scope-plus.repro.ts",
    ],
  },
});
