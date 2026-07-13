// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  planningAgentRequestSchema,
  planningAgentResultSchema,
  type PlanningAgentRequest,
  type PlanningAgentResult,
} from "@roundhouse/self-development/cloudflare";

import type { ExecutionContainerNamespacePort } from "./cloudflare-execution.js";

export class CloudflarePlanningBackend {
  constructor(
    private readonly containers: ExecutionContainerNamespacePort,
    private readonly codexAuthJson: string,
  ) {}

  async execute(input: PlanningAgentRequest): Promise<PlanningAgentResult> {
    const request = planningAgentRequestSchema.parse(input);
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
      throw error;
    }
  }
}
