// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

export const roundhouseFormatterWriteCommand = Object.freeze({
  command: "pnpm" as const,
  args: ["exec", "prettier", "--write"] as const,
});
