// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type {
  EvidenceBucketPort,
  ExecutionContainerNamespacePort,
} from "./cloudflare-execution.js";

export type ControlPlaneEnv = {
  DB: D1Database;
  RUN_QUEUE: Queue<unknown>;
  EXECUTION_CONTAINERS?: ExecutionContainerNamespacePort;
  EXECUTION_EVIDENCE?: EvidenceBucketPort;
  AUTH_MODE?: "local" | "access";
  LOCAL_API_TOKEN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_POLICY_AUD?: string;
  DELEGATED_ACTOR_ID?: string;
  EXECUTION_MODE: string;
  EXECUTION_SCENARIO?: "success" | "nonzero" | "timeout" | "interrupt-once";
  TRUSTED_EXECUTION_SCENARIO?:
    | "success"
    | "agent-failure"
    | "timeout"
    | "interrupt-once"
    | "credential-cleanup-failure";
  SUBMISSION_SCENARIO?: "success" | "interrupt-before-delivery";
  ROUNDHOUSE_CODEX_AUTH_JSON?: string;
  ALLOWED_REPOSITORY_PATH: string;
  ALLOWED_REMOTE_URL: string;
};
