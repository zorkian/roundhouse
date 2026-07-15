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

export function isDeterministicPlanningFailure(error: unknown): boolean {
  const reason = (
    error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  ).toLowerCase();
  return [
    "planning_invalid_structured_output",
    "planning result binding does not match request",
    "planning result failed schema validation",
    "planning_credential_leak_detected",
    "planning_modified_checkout",
  ].some((fragment) => reason.includes(fragment));
}

export function planningSchemaDiagnostics(error: unknown): string {
  if (
    typeof error !== "object" ||
    error === null ||
    !("issues" in error) ||
    !Array.isArray(error.issues)
  )
    return "unknown_contract_violation";
  const values = error.issues.slice(0, 8).map((issue) => {
    if (typeof issue !== "object" || issue === null) return "unknown:invalid";
    const path =
      "path" in issue && Array.isArray(issue.path)
        ? issue.path
            .filter(
              (part: unknown): part is string | number =>
                typeof part === "string" || typeof part === "number",
            )
            .join(".")
        : "unknown";
    const code =
      "code" in issue && typeof issue.code === "string"
        ? issue.code
        : "invalid";
    return `${path || "root"}:${code}`;
  });
  return values.join(",").slice(0, 500) || "unknown_contract_violation";
}

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
        const raw = await container.runPlanningJob(request, this.codexAuthJson);
        let result: PlanningAgentResult;
        try {
          result = planningAgentResultSchema.parse(raw);
        } catch (error) {
          throw new Error(
            `Planning result failed schema validation: ${planningSchemaDiagnostics(error)}`,
          );
        }
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
