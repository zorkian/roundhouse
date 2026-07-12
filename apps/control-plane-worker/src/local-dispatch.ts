// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type {
  ExecutionDispatcher,
  ExecutionDispatchRequest,
  StageResult,
} from "@roundhouse/self-development/cloudflare";
import { StageFailure } from "@roundhouse/self-development/cloudflare";

const nextState: Record<
  ExecutionDispatchRequest["stage"],
  StageResult["state"]
> = {
  prepare: "workspace_ready",
  implement: "validating",
  validate: "awaiting_approval",
  commit: "committed",
  push: "pushed",
  complete: "completed",
};

export class DeterministicLocalDispatcher implements ExecutionDispatcher {
  constructor(private readonly mode: string) {}

  async dispatch(request: ExecutionDispatchRequest): Promise<StageResult> {
    if (this.mode === "retryable-local")
      throw new StageFailure(
        "Local execution dispatcher is temporarily unavailable",
        "dispatch_unavailable",
        true,
      );
    if (this.mode !== "deterministic-local")
      throw new Error("No authorized execution dispatcher is configured");
    return {
      state: nextState[request.stage],
      detail: {
        dispatcher: "deterministic-local",
        attemptNumber: request.attemptNumber,
      },
    };
  }
}
