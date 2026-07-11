// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parseRepositoryProfile } from "./index.js";

const validProfile = `
version: 1
runtime:
  image: roundhouse/runner:dev
  workspace: /workspace
bootstrap:
  command: pnpm
  args: [install, --frozen-lockfile]
validation:
  format: { command: pnpm, args: [format:check] }
  compile: { command: pnpm, args: [typecheck] }
  targeted: { command: pnpm, args: [test] }
  timeoutMinutes: 15
network:
  default: deny
  capabilities: []
protectedPaths: []
artifacts:
  include: [.roundhouse/artifacts/**]
`;

describe("repository profiles", () => {
  it("parses a version-one profile", () => {
    expect(parseRepositoryProfile(validProfile).runtime.workspace).toBe(
      "/workspace",
    );
  });

  it("rejects profiles that permit network by default", () => {
    expect(() =>
      parseRepositoryProfile(
        validProfile.replace("default: deny", "default: allow"),
      ),
    ).toThrow();
  });

  it.each(["profiles/roundhouse.v1.yaml", "profiles/dreamwidth.v1.yaml"])(
    "validates the checked-in profile %s",
    async (path) => {
      const profile = parseRepositoryProfile(await readFile(path, "utf8"));
      expect(profile.version).toBe(1);
      expect(profile.network.default).toBe("deny");
    },
  );
});
