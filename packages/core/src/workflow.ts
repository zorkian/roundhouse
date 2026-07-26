// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { parseDocument } from "yaml";
import type { WaitingReason } from "./run.js";

export const workflowSourcePath = ".roundhouse/workflow.yaml" as const;
export const workflowVersion = 1 as const;
// Profile V1 predates repository workflow files. It is accepted only as a
// source-format compatibility boundary and is normalized into this same graph
// before a run is created; the coordinator never has a second stage router.
export const defaultIssueWorkflowSource = `version: 1

triggers:
  github.issue.started: qualify

nodes:
  qualify:
    executor: agent.read
    role: qualify
    capabilities: [repository.read, context.read, research.public]
    outputs: [qualification.classification]
    transitions:
      - when:
          path: output.qualification.classification
          in: [bug, feature, maintenance]
        to: investigate
      - when:
          path: output.qualification.classification
          equals: unclear
        wait: clarification
      - terminal: succeeded

  investigate:
    executor: agent.read
    role: investigate
    capabilities: [repository.read, context.read, research.public]
    outputs: [reproduction.status]
    transitions:
      - when:
          path: output.reproduction.status
          equals: confirmed
        to: plan
      - when:
          path: output.reproduction.status
          in: [not_reproduced, blocked]
        wait: clarification
      - terminal: failed

  plan:
    executor: agent.read
    role: plan
    capabilities: [repository.read, context.read, research.public]
    outputs: [plan.status]
    transitions:
      - when:
          path: output.plan.status
          equals: ready
        to: implement
      - when:
          path: output.plan.status
          equals: needs_clarification
        wait: clarification
      - terminal: failed

  implement:
    executor: agent.write
    role: implement
    capabilities:
      [repository.read, artifact.write, commands.execute, network.project, preview.capture]
    outputs: [implementation.screenshots]
    transitions:
      - when:
          all:
            - path: attempt.changed
              equals: false
            - path: attempt.hasScreenshots
              equals: true
        terminal: succeeded
      - when:
          exists: attempt.acceptedHead
        to: review
      - terminal: failed

  review:
    executor: review
    role: review
    capabilities: [repository.read, context.read]
    outputs: [review.status]
    transitions:
      - when:
          path: output.review.status
          equals: clean
        to: integrate
      - when:
          path: output.review.status
          equals: changes_requested
        to: implement
      - terminal: failed

  integrate:
    executor: validate
    role: integrate
    capabilities: [repository.read, commands.execute]
    outputs: [integration.status]
    transitions:
      - when:
          path: output.integration.status
          equals: ready
        to: checks
      - when:
          path: output.integration.status
          equals: changes_requested
        to: implement
      - when:
          path: output.integration.status
          equals: needs_resolution
        to: integrate
      - terminal: failed

  checks:
    executor: github.checks
    capabilities: [github.checks.read]
    outputs: [ci.status, ci.reason]
    transitions:
      - when:
          path: output.ci.status
          equals: success
        to: merge
      - when:
          path: output.ci.status
          equals: reintegrate
        to: integrate
      - when:
          path: output.ci.reason
          in: [diagnostics_unavailable, evidence_consumed]
        wait: external_check
      - when:
          path: output.ci.status
          equals: failure
        to: implement
      - wait: external_check

  merge:
    executor: github.merge
    capabilities: [github.merge]
    outputs: [merge.status]
    transitions:
      - when:
          path: output.merge.status
          equals: reintegrate
        to: integrate
      - when:
          path: output.merge.status
          equals: merged
        terminal: succeeded
      - when:
          path: run.mergeMode
          equals: maintainer
        wait: maintainer_merge
      - terminal: failed
`;

export const workflowTriggerKinds = ["github.issue.started"] as const;
export const workflowExecutorKinds = [
  "agent.read",
  "agent.write",
  "review",
  "validate",
  "human",
  "github.publish",
  "github.checks",
  "github.merge",
  "external.wait",
  "external.check",
  "fanout",
  "join",
  "terminal",
] as const;
export const workflowTerminalStatuses = [
  "succeeded",
  "failed",
  "cancelled",
] as const;
export const workflowConditionOperators = [
  "all",
  "any",
  "not",
  "exists",
  "equals",
  "in",
  "less_than",
  "less_than_or_equal",
  "greater_than",
  "greater_than_or_equal",
] as const;

export type WorkflowTriggerKind = (typeof workflowTriggerKinds)[number];
export type WorkflowExecutorKind = (typeof workflowExecutorKinds)[number];
export type WorkflowTerminalStatus = (typeof workflowTerminalStatuses)[number];
export type WorkflowConditionOperator =
  (typeof workflowConditionOperators)[number];

export type WorkflowScalar = string | number | boolean | null;

export type WorkflowCondition =
  | { readonly all: readonly WorkflowCondition[] }
  | { readonly any: readonly WorkflowCondition[] }
  | { readonly not: WorkflowCondition }
  | { readonly exists: string }
  | {
      readonly path: string;
      readonly equals: WorkflowScalar;
    }
  | {
      readonly path: string;
      readonly in: readonly WorkflowScalar[];
    }
  | {
      readonly path: string;
      readonly less_than: number;
    }
  | {
      readonly path: string;
      readonly less_than_or_equal: number;
    }
  | {
      readonly path: string;
      readonly greater_than: number;
    }
  | {
      readonly path: string;
      readonly greater_than_or_equal: number;
    };

export interface WorkflowTransition {
  readonly when?: WorkflowCondition;
  readonly to?: string;
  readonly wait?: WaitingReason;
  readonly terminal?: WorkflowTerminalStatus;
}

export interface WorkflowNode {
  readonly executor: WorkflowExecutorKind;
  readonly role?: string;
  readonly capabilities: readonly string[];
  readonly outputs: readonly string[];
  readonly transitions: readonly WorkflowTransition[];
}

export interface CompiledWorkflow {
  readonly sourcePath: typeof workflowSourcePath;
  readonly sourceCommit: string;
  readonly version: typeof workflowVersion;
  readonly hash: string;
  readonly triggers: Readonly<Record<WorkflowTriggerKind, string>>;
  readonly nodes: Readonly<Record<string, WorkflowNode>>;
}

export interface WorkflowAdvance {
  readonly status: "active" | "waiting" | WorkflowTerminalStatus;
  readonly currentNodeId: string;
  readonly waitingReason?: WaitingReason;
  readonly selected: WorkflowTransition;
}

const executorCapabilities: Readonly<
  Record<WorkflowExecutorKind, readonly string[]>
> = {
  "agent.read": ["repository.read", "context.read", "research.public"],
  "agent.write": [
    "repository.read",
    "artifact.write",
    "commands.execute",
    "network.project",
    "preview.capture",
  ],
  review: ["repository.read", "context.read"],
  validate: ["repository.read", "commands.execute"],
  human: [],
  "github.publish": ["github.publish"],
  "github.checks": ["github.checks.read"],
  "github.merge": ["github.merge"],
  "external.wait": [],
  "external.check": ["external.check"],
  fanout: [],
  join: [],
  terminal: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function scalar(value: unknown): value is WorkflowScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function path(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(output|attempt|run|trigger)(?:\.[A-Za-z0-9_-]+)+$/.test(value)
  )
    throw new Error("workflow_condition_path_invalid");
  return value;
}

function condition(value: unknown): WorkflowCondition {
  if (!isRecord(value)) throw new Error("workflow_condition_invalid");
  const keys = Object.keys(value);
  if (keys.length !== 1 && !(keys.length === 2 && keys.includes("path")))
    throw new Error("workflow_condition_invalid");
  if (keys.length === 1 && "all" in value) {
    if (!Array.isArray(value.all) || value.all.length === 0)
      throw new Error("workflow_condition_invalid");
    return { all: value.all.map(condition) };
  }
  if (keys.length === 1 && "any" in value) {
    if (!Array.isArray(value.any) || value.any.length === 0)
      throw new Error("workflow_condition_invalid");
    return { any: value.any.map(condition) };
  }
  if (keys.length === 1 && "not" in value) return { not: condition(value.not) };
  if (keys.length === 1 && "exists" in value)
    return { exists: path(value.exists) };
  if (!("path" in value)) throw new Error("workflow_condition_invalid");
  const conditionPath = path(value.path);
  if ("equals" in value && scalar(value.equals))
    return { path: conditionPath, equals: value.equals };
  if (
    "in" in value &&
    Array.isArray(value.in) &&
    value.in.length > 0 &&
    value.in.every(scalar)
  )
    return { path: conditionPath, in: value.in };
  for (const operator of [
    "less_than",
    "less_than_or_equal",
    "greater_than",
    "greater_than_or_equal",
  ] as const) {
    if (operator in value && typeof value[operator] === "number")
      return { path: conditionPath, [operator]: value[operator] } as
        | { path: string; less_than: number }
        | { path: string; less_than_or_equal: number }
        | { path: string; greater_than: number }
        | { path: string; greater_than_or_equal: number };
  }
  throw new Error("workflow_condition_invalid");
}

function transition(value: unknown): WorkflowTransition {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [], ["when", "to", "wait", "terminal"])
  )
    throw new Error("workflow_transition_invalid");
  const destinations = ["to", "wait", "terminal"].filter(
    (key) => value[key] !== undefined,
  );
  if (destinations.length !== 1) throw new Error("workflow_transition_invalid");
  if (value.to !== undefined && typeof value.to !== "string")
    throw new Error("workflow_transition_invalid");
  if (
    value.wait !== undefined &&
    ![
      "clarification",
      "plan_approval",
      "final_approval",
      "maintainer_judgment",
      "budget",
      "external_check",
      "maintainer_merge",
      "retry_exhausted",
      "profile_error",
    ].includes(String(value.wait))
  )
    throw new Error("workflow_transition_invalid");
  if (
    value.terminal !== undefined &&
    !workflowTerminalStatuses.includes(value.terminal as WorkflowTerminalStatus)
  )
    throw new Error("workflow_transition_invalid");
  return {
    ...(value.when === undefined ? {} : { when: condition(value.when) }),
    ...(value.to === undefined ? {} : { to: value.to }),
    ...(value.wait === undefined ? {} : { wait: value.wait as WaitingReason }),
    ...(value.terminal === undefined
      ? {}
      : { terminal: value.terminal as WorkflowTerminalStatus }),
  };
}

function stringList(value: unknown, error: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(error);
  return [...new Set(value)];
}

function node(value: unknown): WorkflowNode {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      ["executor", "transitions"],
      ["role", "capabilities", "outputs"],
    ) ||
    !workflowExecutorKinds.includes(value.executor as WorkflowExecutorKind) ||
    (value.role !== undefined &&
      (typeof value.role !== "string" ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(value.role))) ||
    !Array.isArray(value.transitions) ||
    value.transitions.length === 0
  )
    throw new Error("workflow_node_invalid");
  const executor = value.executor as WorkflowExecutorKind;
  const capabilities =
    value.capabilities === undefined
      ? []
      : stringList(value.capabilities, "workflow_capabilities_invalid");
  if (
    capabilities.some(
      (capability) => !executorCapabilities[executor].includes(capability),
    )
  )
    throw new Error("workflow_capability_escalation");
  const outputs =
    value.outputs === undefined
      ? []
      : stringList(value.outputs, "workflow_outputs_invalid");
  if (
    outputs.some(
      (output) => !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(output),
    )
  )
    throw new Error("workflow_outputs_invalid");
  return {
    executor,
    ...(value.role === undefined ? {} : { role: value.role }),
    capabilities,
    outputs,
    transitions: value.transitions.map(transition),
  };
}

function outputPaths(conditionValue: WorkflowCondition): readonly string[] {
  if ("all" in conditionValue) return conditionValue.all.flatMap(outputPaths);
  if ("any" in conditionValue) return conditionValue.any.flatMap(outputPaths);
  if ("not" in conditionValue) return outputPaths(conditionValue.not);
  const conditionPath =
    "exists" in conditionValue ? conditionValue.exists : conditionValue.path;
  return conditionPath.startsWith("output.")
    ? [conditionPath.slice("output.".length)]
    : [];
}

function validateGraph(
  triggers: Readonly<Record<WorkflowTriggerKind, string>>,
  nodes: Readonly<Record<string, WorkflowNode>>,
): void {
  const nodeIds = new Set(Object.keys(nodes));
  for (const start of Object.values(triggers))
    if (!nodeIds.has(start)) throw new Error("workflow_start_node_missing");
  for (const [nodeId, definition] of Object.entries(nodes)) {
    const fallbackIndexes = definition.transitions.flatMap((item, index) =>
      item.when ? [] : [index],
    );
    if (
      fallbackIndexes.length !== 1 ||
      fallbackIndexes[0] !== definition.transitions.length - 1
    )
      throw new Error("workflow_transition_fallback_invalid");
    for (const item of definition.transitions) {
      if (item.to && !nodeIds.has(item.to))
        throw new Error("workflow_transition_target_missing");
      for (const output of item.when ? outputPaths(item.when) : [])
        if (!definition.outputs.includes(output))
          throw new Error("workflow_condition_output_undeclared");
    }
    if (
      definition.executor === "terminal" &&
      definition.transitions.some((item) => item.to || item.wait)
    )
      throw new Error("workflow_terminal_node_invalid");
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(nodeId))
      throw new Error("workflow_node_id_invalid");
  }

  const reachable = new Set<string>();
  const pending = [...Object.values(triggers)];
  while (pending.length) {
    const current = pending.pop()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const item of nodes[current]!.transitions)
      if (item.to) pending.push(item.to);
  }
  if ([...nodeIds].some((nodeId) => !reachable.has(nodeId)))
    throw new Error("workflow_node_unreachable");
}

export function evaluateWorkflowCondition(
  value: WorkflowCondition,
  context: Readonly<Record<string, unknown>>,
): boolean {
  if ("all" in value)
    return value.all.every((item) => evaluateWorkflowCondition(item, context));
  if ("any" in value)
    return value.any.some((item) => evaluateWorkflowCondition(item, context));
  if ("not" in value) return !evaluateWorkflowCondition(value.not, context);
  const conditionPath = "exists" in value ? value.exists : value.path;
  const resolved = conditionPath
    .split(".")
    .reduce<unknown>(
      (current, segment) => (isRecord(current) ? current[segment] : undefined),
      context,
    );
  if ("exists" in value) return resolved !== undefined && resolved !== null;
  if ("equals" in value) return resolved === value.equals;
  if ("in" in value) return value.in.includes(resolved as WorkflowScalar);
  if (typeof resolved !== "number") return false;
  if ("less_than" in value) return resolved < value.less_than;
  if ("less_than_or_equal" in value)
    return resolved <= value.less_than_or_equal;
  if ("greater_than" in value) return resolved > value.greater_than;
  return resolved >= value.greater_than_or_equal;
}

export function selectWorkflowTransition(
  nodeDefinition: WorkflowNode,
  context: Readonly<Record<string, unknown>>,
): WorkflowTransition {
  const selected = nodeDefinition.transitions.find(
    (item) => !item.when || evaluateWorkflowCondition(item.when, context),
  );
  if (!selected) throw new Error("workflow_transition_not_selected");
  return selected;
}

export function advanceWorkflow(
  workflow: CompiledWorkflow,
  currentNodeId: string,
  context: Readonly<Record<string, unknown>>,
): WorkflowAdvance {
  const current = workflow.nodes[currentNodeId];
  if (!current) throw new Error("workflow_current_node_missing");
  const selected = selectWorkflowTransition(current, context);
  if (selected.to)
    return {
      status: "active",
      currentNodeId: selected.to,
      selected,
    };
  if (selected.wait)
    return {
      status: "waiting",
      currentNodeId,
      waitingReason: selected.wait,
      selected,
    };
  if (selected.terminal)
    return {
      status: selected.terminal,
      currentNodeId,
      selected,
    };
  throw new Error("workflow_transition_destination_missing");
}

export async function compileWorkflow(
  yaml: string,
  sourceCommit: string,
): Promise<CompiledWorkflow> {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit))
    throw new Error("workflow_source_commit_invalid");
  const document = parseDocument(yaml, { uniqueKeys: true });
  if (document.errors.length) throw new Error("workflow_yaml_invalid");
  const value: unknown = document.toJS();
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["version", "triggers", "nodes"]) ||
    value.version !== workflowVersion ||
    !isRecord(value.triggers) ||
    !isRecord(value.nodes) ||
    Object.keys(value.triggers).length === 0 ||
    Object.keys(value.nodes).length === 0
  )
    throw new Error("workflow_schema_invalid");
  if (
    Object.keys(value.triggers).some(
      (trigger) =>
        !workflowTriggerKinds.includes(trigger as WorkflowTriggerKind),
    ) ||
    Object.values(value.triggers).some((start) => typeof start !== "string")
  )
    throw new Error("workflow_trigger_invalid");
  const triggers = value.triggers as Record<WorkflowTriggerKind, string>;
  const nodes = Object.fromEntries(
    Object.entries(value.nodes).map(([nodeId, definition]) => [
      nodeId,
      node(definition),
    ]),
  );
  validateGraph(triggers, nodes);
  const normalized = {
    version: workflowVersion,
    triggers,
    nodes,
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(normalized)),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return {
    sourcePath: workflowSourcePath,
    sourceCommit,
    hash,
    ...normalized,
  };
}
