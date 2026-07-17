// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  resolve: {
    alias: {
      "@roundhouse/repository-profile/contracts": fileURLToPath(
        new URL("../../repository-profile/src/contracts.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: [
      "packages/self-development/reproductions/exact-scope-plus.repro.ts",
    ],
  },
});
