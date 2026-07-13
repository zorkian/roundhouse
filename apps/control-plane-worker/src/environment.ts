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
  ROUNDHOUSE_CLAUDE_AUTH_JSON?: string;
  INDEPENDENT_REVIEW_SCENARIO?:
    "success" | "timeout" | "interrupt-once" | "invalid-output";
  INDEPENDENT_REVIEW_ENABLED?: "true";
  GITHUB_REVIEW_CHECKS_ENABLED?: "true";
  ROUNDHOUSE_GITHUB_APP_PRIVATE_KEY?: string;
  ROUNDHOUSE_GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_APP_ID?: string;
  GITHUB_INSTALLATION_ID?: string;
  GITHUB_API_FETCHER?: typeof fetch;
  ROUNDHOUSE_ENVIRONMENT?: "development" | "production";
  ROUNDHOUSE_PUBLIC_ORIGIN?: string;
  ROUNDHOUSE_REPOSITORY?: "zorkian/roundhouse";
  ROUNDHOUSE_WORKER_ID?: string;
  ALLOWED_REPOSITORY_PATH: string;
  ALLOWED_REMOTE_URL: string;
};
