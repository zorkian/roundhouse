// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import type { ControlPlaneEnv } from "./environment.js";
import { runtimeIdentity } from "./runtime-config.js";

const env = (value: Partial<ControlPlaneEnv> = {}) => value as ControlPlaneEnv;

describe("runtime identity", () => {
  it("retains development defaults for local and existing deployments", () => {
    expect(runtimeIdentity(env())).toEqual({
      environment: "development",
      commandPrefix: "/rhd",
      commandPrefixes: ["/rhd", "/roundhouse-dev"],
      commentNamespace: "dev",
      origin: "https://roundhouse-dev.rm-rf.rip",
      repositoryFullName: "zorkian/roundhouse",
      owner: "zorkian",
      repository: "roundhouse",
      workerId: "roundhouse-development-control-plane",
    });
  });

  it("represents an isolated production deployment", () => {
    expect(
      runtimeIdentity(
        env({
          ROUNDHOUSE_ENVIRONMENT: "production",
          ROUNDHOUSE_PUBLIC_ORIGIN: "https://roundhouse.rm-rf.rip",
          ROUNDHOUSE_REPOSITORY: "zorkian/roundhouse",
          ROUNDHOUSE_WORKER_ID: "roundhouse-prod-control-plane",
        }),
      ),
    ).toMatchObject({
      environment: "production",
      commandPrefix: "/rh",
      commandPrefixes: ["/rh", "/roundhouse"],
      commentNamespace: "prod",
      origin: "https://roundhouse.rm-rf.rip",
      workerId: "roundhouse-prod-control-plane",
    });
  });

  it.each([
    { ROUNDHOUSE_PUBLIC_ORIGIN: "http://roundhouse.rm-rf.rip" },
    { ROUNDHOUSE_PUBLIC_ORIGIN: "https://roundhouse.rm-rf.rip/path" },
    { ROUNDHOUSE_PUBLIC_ORIGIN: "https://roundhouse.rm-rf.rip" },
    { ROUNDHOUSE_ENVIRONMENT: "staging" },
    { ROUNDHOUSE_REPOSITORY: "roundhouse" },
    { ROUNDHOUSE_REPOSITORY: "another/roundhouse" },
    { ROUNDHOUSE_WORKER_ID: "../another-worker" },
  ])("rejects unsafe identity configuration %#", (value) => {
    expect(() =>
      runtimeIdentity(env(value as Partial<ControlPlaneEnv>)),
    ).toThrow();
  });
});
