// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

export type ControlPlaneEnv = {
  DB: D1Database;
  RUN_QUEUE: Queue<unknown>;
  EXECUTION_CONTAINERS?: DurableObjectNamespace;
  EXECUTION_EVIDENCE?: R2Bucket;
  AUTH_MODE?: "local" | "access";
  LOCAL_API_TOKEN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_POLICY_AUD?: string;
  EXECUTION_MODE: string;
  EXECUTION_SCENARIO?: "success" | "nonzero" | "timeout" | "interrupt-once";
  ALLOWED_REPOSITORY_PATH: string;
  ALLOWED_REMOTE_URL: string;
};
