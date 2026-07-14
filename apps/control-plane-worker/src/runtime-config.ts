// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ControlPlaneEnv } from "./environment.js";

const environmentOrigins = {
  development: "https://roundhouse-dev.rm-rf.rip",
  production: "https://roundhouse.rm-rf.rip",
} as const;

export type RuntimeIdentity = {
  environment: "development" | "production";
  commandPrefix: "/rhd" | "/rh";
  commandPrefixes: readonly string[];
  commentNamespace: "dev" | "prod";
  origin: string;
  repositoryFullName: "zorkian/roundhouse";
  owner: "zorkian";
  repository: "roundhouse";
  workerId: string;
};

const environmentCommands = {
  development: {
    commandPrefix: "/rhd",
    commandPrefixes: ["/rhd", "/roundhouse-dev"],
    commentNamespace: "dev",
  },
  production: {
    commandPrefix: "/rh",
    commandPrefixes: ["/rh", "/roundhouse"],
    commentNamespace: "prod",
  },
} as const;

export function runtimeIdentity(env: ControlPlaneEnv): RuntimeIdentity {
  const environment = env.ROUNDHOUSE_ENVIRONMENT ?? "development";
  const origin =
    env.ROUNDHOUSE_PUBLIC_ORIGIN ?? "https://roundhouse-dev.rm-rf.rip";
  const repositoryFullName = env.ROUNDHOUSE_REPOSITORY ?? "zorkian/roundhouse";
  const workerId =
    env.ROUNDHOUSE_WORKER_ID ?? `roundhouse-${environment}-control-plane`;
  if (environment !== "development" && environment !== "production")
    throw new Error("Roundhouse environment identity is invalid");
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("Roundhouse public origin is invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("Roundhouse public origin must be an HTTPS origin");
  if (parsed.origin !== environmentOrigins[environment])
    throw new Error("Roundhouse public origin does not match its environment");
  if (repositoryFullName !== "zorkian/roundhouse")
    throw new Error("Roundhouse repository is not enrolled");
  if (!/^roundhouse-[a-z0-9-]{1,52}$/.test(workerId))
    throw new Error("Roundhouse Worker identity is invalid");
  return {
    environment,
    ...environmentCommands[environment],
    origin: parsed.origin,
    repositoryFullName,
    owner: "zorkian",
    repository: "roundhouse",
    workerId,
  };
}
