// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { ControlPlaneEnv } from "./environment.js";

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type RuntimeIdentity = {
  environment: "development" | "production";
  origin: string;
  repositoryFullName: "zorkian/roundhouse";
  owner: "zorkian";
  repository: "roundhouse";
  workerId: string;
};

export function runtimeIdentity(env: ControlPlaneEnv): RuntimeIdentity {
  const environment = env.ROUNDHOUSE_ENVIRONMENT ?? "development";
  const origin =
    env.ROUNDHOUSE_PUBLIC_ORIGIN ?? "https://roundhouse-dev.rm-rf.rip";
  const repositoryFullName = env.ROUNDHOUSE_REPOSITORY ?? "zorkian/roundhouse";
  const workerId =
    env.ROUNDHOUSE_WORKER_ID ?? `roundhouse-${environment}-control-plane`;
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
  if (!repositoryPattern.test(repositoryFullName))
    throw new Error("Roundhouse repository identity is invalid");
  return {
    environment,
    origin: parsed.origin,
    repositoryFullName,
    owner: "zorkian",
    repository: "roundhouse",
    workerId,
  };
}
