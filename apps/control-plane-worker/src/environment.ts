// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

export type ControlPlaneEnv = {
  DB: D1Database;
  RUN_QUEUE: Queue<unknown>;
  LOCAL_API_TOKEN: string;
  EXECUTION_MODE: string;
  ALLOWED_REPOSITORY_PATH: string;
  ALLOWED_REMOTE_URL: string;
};
