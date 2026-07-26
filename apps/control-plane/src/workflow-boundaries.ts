// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type { RunRepository, RunResumeSignal, Wakeup } from "@roundhouse/core";

export interface WorkflowContextRequest {
  readonly key: string;
  readonly provider: string;
  readonly query: string;
}

export interface WorkflowContextProvider {
  readonly id: string;
  resolve(
    query: string,
    boundary: {
      readonly runId: string;
      readonly workflowHash: string;
      readonly nodeId: string;
      readonly boundHead: string;
    },
  ): Promise<{
    readonly value: unknown;
    readonly source: string;
    readonly version: string;
  }>;
}

export async function resolveWorkflowContexts(
  requests: readonly WorkflowContextRequest[],
  providers: ReadonlyMap<string, WorkflowContextProvider>,
  boundary: {
    readonly runId: string;
    readonly workflowHash: string;
    readonly nodeId: string;
    readonly boundHead: string;
  },
): Promise<{
  readonly values: Readonly<Record<string, unknown>>;
  readonly audit: readonly Readonly<Record<string, unknown>>[];
}> {
  const values: Record<string, unknown> = {};
  const audit: Readonly<Record<string, unknown>>[] = [];
  for (const request of requests) {
    const provider = providers.get(request.provider);
    if (!provider) throw new Error(`workflow_context_provider_missing`);
    const resolved = await provider.resolve(request.query, boundary);
    values[request.key] = resolved.value;
    audit.push({
      auditVersion: 1,
      kind: "context.resolved",
      ...boundary,
      provider: provider.id,
      query: request.query,
      source: resolved.source,
      version: resolved.version,
    });
  }
  return { values, audit };
}

export async function resumeExternalWorkflowEvent(
  repository: RunRepository,
  enqueue: (wakeup: Wakeup) => Promise<void>,
  input: {
    readonly runId: string;
    readonly expectedRevision: number;
    readonly adapter: string;
    readonly event: string;
    readonly actor: string;
    readonly payload: Readonly<Record<string, unknown>>;
  },
): Promise<"resumed" | "ignored"> {
  const run = await repository.get(input.runId);
  if (
    !run ||
    run.revision !== input.expectedRevision ||
    run.status !== "waiting" ||
    run.waitingReason !== "external_check" ||
    !run.currentNodeId ||
    !run.profile?.workflow
  )
    return "ignored";
  const node = run.profile.workflow.nodes[run.currentNodeId];
  if (
    !node?.external ||
    node.external.adapter !== input.adapter ||
    node.external.event !== input.event
  )
    return "ignored";
  const signal: RunResumeSignal = {
    kind: "external",
    adapter: input.adapter,
    event: input.event,
    actor: input.actor,
    payload: input.payload,
  };
  const resumed = await repository.resume(
    run.id,
    run.revision,
    run.issue ?? {
      title: `Issue #${run.issueNumber}`,
      body: "",
      url: "",
      actor: input.actor,
    },
    undefined,
    undefined,
    signal,
  );
  if (!resumed) return "ignored";
  await enqueue({ runId: resumed.id, expectedRevision: resumed.revision });
  return "resumed";
}
