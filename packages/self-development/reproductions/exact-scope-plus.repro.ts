// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { expect, it } from "vitest";

import { extractExactPaths } from "../src/planning.js";

it("accepts plus bullets in the exact-scope section", () => {
  expect(
    extractExactPaths(
      `Scope is exactly:\n\n+ packages/domain/src/a.ts\n+ \`packages/domain/src/a.test.ts\``,
    ),
  ).toEqual(["packages/domain/src/a.ts", "packages/domain/src/a.test.ts"]);
});
