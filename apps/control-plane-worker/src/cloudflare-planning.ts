// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  planningAgentRequestSchema,
  planningAgentResultSchema,
  type PlanningAgentRequest,
  type PlanningAgentResult,
} from "@roundhouse/self-development/cloudflare";

import type { ExecutionContainerNamespacePort } from "./cloudflare-execution.js";

const retryDelaysMs = [250, 1_000];

export function isRetryablePlanningInterruption(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "overloaded" in error &&
    error.overloaded === true
  )
    return true;
  const reason = (
    error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  ).toLowerCase();
  return [
    "durable object reset because its code was updated",
    "instance disappeared",
    "network connection lost",
    "container is not running",
    "failed to connect to container",
  ].some((fragment) => reason.includes(fragment));
}

export class CloudflarePlanningBackend {
  constructor(
    private readonly containers: ExecutionContainerNamespacePort,
    private readonly codexAuthJson: string,
    private readonly wait: (milliseconds: number) => Promise<void> = (
      milliseconds,
    ) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async execute(input: PlanningAgentRequest): Promise<PlanningAgentResult> {
    const request = planningAgentRequestSchema.parse(input);
    for (let attempt = 0; ; attempt += 1) {
      const container = this.containers.getByName(request.attemptId);
      try {
        if (!container.runPlanningJob)
          throw new Error("Planning Container adapter is unavailable");
        const result = planningAgentResultSchema.parse(
          await container.runPlanningJob(request, this.codexAuthJson),
        );
        if (
          result.attemptId !== request.attemptId ||
          result.baseCommit !== request.baseCommit
        )
          throw new Error("Planning result binding does not match request");
        return result;
      } catch (error) {
        await container.destroy().catch(() => undefined);
        if (
          attempt >= retryDelaysMs.length ||
          !isRetryablePlanningInterruption(error)
        )
          throw error;
        await this.wait(retryDelaysMs[attempt]!);
      }
    }
  }
}
