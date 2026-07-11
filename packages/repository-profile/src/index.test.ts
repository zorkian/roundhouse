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
});
