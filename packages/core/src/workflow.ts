// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { parseDocument, stringify } from "yaml";
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
    agent:
      task: qualification
      inputs:
        issue: trigger.issue
      result:
        key: qualification
        schema: roundhouse.qualification.v1
      model: { id: openai/gpt-5.6-sol, reasoning: low }
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
    agent:
      task: investigation
      inputs:
        issue: trigger.issue
        qualification: nodes.qualify.qualification
      result:
        key: reproduction
        schema: roundhouse.investigation.v1
      model: { id: openai/gpt-5.6-sol, reasoning: low }
    capabilities:
      [repository.read, context.read, research.public, commands.execute, environment.project, network.project, preview.capture]
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
    agent:
      task: planning
      inputs:
        issue: trigger.issue
        qualification: nodes.qualify.qualification
        reproduction: nodes.investigate.reproduction
      result:
        key: plan
        schema: roundhouse.plan.v1
      model: { id: openai/gpt-5.6-sol, reasoning: low }
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
    agent:
      task: implementation
      inputs:
        issue: trigger.issue
        qualification: nodes.qualify.qualification
        reproduction: nodes.investigate.reproduction
        plan: nodes.plan.plan
        implementation: nodes.implement.implementation
        review: nodes.review.review
        ci: nodes.checks.ci
        visualFeedback: nodes.approval.human
      result:
        key: implementation
        schema: roundhouse.implementation.v1
      model: { id: moonshotai/kimi-k3, reasoning: low }
    capabilities:
      [repository.read, artifact.write, commands.execute, environment.project, network.project, preview.capture]
    outputs: [implementation.screenshots]
    transitions:
      - when:
          all:
            - path: attempt.changed
              equals: false
            - path: attempt.hasScreenshots
              equals: true
            - path: run.hasCandidate
              equals: false
        terminal: succeeded
      - when:
          all:
            - path: attempt.changed
              equals: false
            - path: run.hasCandidate
              equals: true
        to: review
      - when:
          path: attempt.hasScreenshots
          equals: true
        to: approval
      - when:
          exists: attempt.acceptedHead
        to: review
      - terminal: failed

  approval:
    executor: human
    role: approval
    human:
      reason: visual_feedback
      audience: operator
    outputs: [human.status]
    transitions:
      - when:
          path: output.human.status
          equals: answered
        to: implement
      - terminal: failed

  review:
    executor: review
    role: review
    review:
      reviewers:
        - id: review-holistic
          label: Holistic design review
          activation: always
          selects: [review-security, review-data]
          mode: blocking
          blocking_severities: [critical, high, medium]
          model: { id: openai/gpt-5.6-sol, reasoning: low }
        - id: review-security
          label: Security review
          activation: selected
          selected_by: review-holistic
          mode: blocking
          blocking_severities: [critical, high, medium]
          model: { id: openai/gpt-5.6-sol, reasoning: low }
        - id: review-data
          label: Data consistency review
          activation: selected
          selected_by: review-holistic
          mode: blocking
          blocking_severities: [critical, high, medium]
          model: { id: openai/gpt-5.6-sol, reasoning: low }
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
    capabilities: [repository.read, artifact.write, commands.execute]
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
export const workflowAgentTasks = [
  "qualification",
  "investigation",
  "planning",
  "implementation",
] as const;
export const workflowAgentSchemas = [
  "roundhouse.qualification.v1",
  "roundhouse.investigation.v1",
  "roundhouse.plan.v1",
  "roundhouse.implementation.v1",
] as const;
export const workflowReviewModes = ["blocking", "advisory", "shadow"] as const;
export const workflowReviewActivations = ["always", "selected"] as const;

export type WorkflowTriggerKind = (typeof workflowTriggerKinds)[number];
export type WorkflowExecutorKind = (typeof workflowExecutorKinds)[number];
export type WorkflowTerminalStatus = (typeof workflowTerminalStatuses)[number];
export type WorkflowConditionOperator =
  (typeof workflowConditionOperators)[number];
export type WorkflowAgentTask = (typeof workflowAgentTasks)[number];
export type WorkflowAgentSchema = (typeof workflowAgentSchemas)[number];
export type WorkflowReviewMode = (typeof workflowReviewModes)[number];
export type WorkflowReviewActivation =
  (typeof workflowReviewActivations)[number];

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

export interface WorkflowModel {
  readonly id: string;
  readonly reasoning:
    "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface WorkflowCompetitionCandidate {
  readonly id: string;
  readonly model: WorkflowModel;
}

// A competition replaces a node's single model: each candidate runs the same
// resolved inputs with its own model, then the judge model scores every
// candidate and selects exactly one winner to promote.
export interface WorkflowCompetition {
  readonly candidates: readonly WorkflowCompetitionCandidate[];
  readonly judge: {
    readonly model: WorkflowModel;
  };
}

export interface WorkflowAgent {
  readonly task: WorkflowAgentTask;
  readonly inputs: Readonly<Record<string, string>>;
  readonly result: {
    readonly key: string;
    readonly schema: WorkflowAgentSchema;
  };
  readonly model?: WorkflowModel;
  readonly competition?: WorkflowCompetition;
  readonly prompt?: {
    readonly sourcePath: string;
    readonly content: string;
  };
}

export interface WorkflowReviewer {
  readonly id: string;
  readonly label: string;
  readonly activation: WorkflowReviewActivation;
  readonly selectedBy?: string;
  readonly selects: readonly string[];
  readonly mode: WorkflowReviewMode;
  readonly blockingSeverities: readonly string[];
  readonly model?: WorkflowModel;
  readonly competition?: WorkflowCompetition;
  readonly prompt?: {
    readonly sourcePath: string;
    readonly content: string;
  };
}

export interface WorkflowReview {
  readonly reviewers: readonly WorkflowReviewer[];
}

export interface WorkflowHuman {
  readonly reason: WaitingReason;
  readonly audience: "participant" | "operator";
  readonly prompt?: {
    readonly sourcePath: string;
    readonly content: string;
  };
}

export interface WorkflowExternal {
  readonly adapter: string;
  readonly event: string;
  readonly resultKey: string;
}

export interface WorkflowNode {
  readonly executor: WorkflowExecutorKind;
  readonly role?: string;
  readonly agent?: WorkflowAgent;
  readonly review?: WorkflowReview;
  readonly human?: WorkflowHuman;
  readonly external?: WorkflowExternal;
  readonly capabilities: readonly WorkflowCapability[];
  readonly outputs: readonly string[];
  readonly transitions: readonly WorkflowTransition[];
}

export type WorkflowFileLoader = (path: string) => Promise<string>;

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

export function serializeWorkflow(workflow: CompiledWorkflow): string {
  const nodes = Object.fromEntries(
    Object.entries(workflow.nodes).map(([id, definition]) => [
      id,
      {
        executor: definition.executor,
        ...(definition.role ? { role: definition.role } : {}),
        ...(definition.agent
          ? {
              agent: {
                task: definition.agent.task,
                inputs: definition.agent.inputs,
                result: definition.agent.result,
                ...(definition.agent.model
                  ? { model: definition.agent.model }
                  : {}),
                ...(definition.agent.competition
                  ? { competition: definition.agent.competition }
                  : {}),
                ...(definition.agent.prompt
                  ? {
                      prompt: definition.agent.prompt.sourcePath.replace(
                        /^\.roundhouse\//,
                        "",
                      ),
                    }
                  : {}),
              },
            }
          : {}),
        ...(definition.review
          ? {
              review: {
                reviewers: definition.review.reviewers.map((reviewer) => ({
                  id: reviewer.id,
                  label: reviewer.label,
                  activation: reviewer.activation,
                  ...(reviewer.selectedBy
                    ? { selected_by: reviewer.selectedBy }
                    : {}),
                  ...(reviewer.selects.length
                    ? { selects: reviewer.selects }
                    : {}),
                  mode: reviewer.mode,
                  blocking_severities: reviewer.blockingSeverities,
                  ...(reviewer.model ? { model: reviewer.model } : {}),
                  ...(reviewer.competition
                    ? { competition: reviewer.competition }
                    : {}),
                  ...(reviewer.prompt
                    ? {
                        prompt: reviewer.prompt.sourcePath.replace(
                          /^\.roundhouse\//,
                          "",
                        ),
                      }
                    : {}),
                })),
              },
            }
          : {}),
        ...(definition.human
          ? {
              human: {
                reason: definition.human.reason,
                audience: definition.human.audience,
                ...(definition.human.prompt
                  ? {
                      prompt: definition.human.prompt.sourcePath.replace(
                        /^\.roundhouse\//,
                        "",
                      ),
                    }
                  : {}),
              },
            }
          : {}),
        ...(definition.external
          ? {
              external: {
                adapter: definition.external.adapter,
                event: definition.external.event,
                result: definition.external.resultKey,
              },
            }
          : {}),
        ...(definition.capabilities.length
          ? { capabilities: definition.capabilities }
          : {}),
        ...(definition.outputs.length ? { outputs: definition.outputs } : {}),
        transitions: definition.transitions,
      },
    ]),
  );
  return stringify({
    version: workflow.version,
    triggers: workflow.triggers,
    nodes,
  });
}

export const workflowCapabilities = [
  "repository.read",
  "context.read",
  "research.public",
  "artifact.write",
  "commands.execute",
  "environment.project",
  "network.project",
  "preview.capture",
  "github.publish",
  "github.checks.read",
  "github.merge",
  "external.check",
] as const;

export type WorkflowCapability = (typeof workflowCapabilities)[number];

const executorCapabilities: Readonly<
  Record<WorkflowExecutorKind, readonly WorkflowCapability[]>
> = {
  "agent.read": [
    "repository.read",
    "context.read",
    "research.public",
    "commands.execute",
    "environment.project",
    "network.project",
    "preview.capture",
  ],
  "agent.write": [
    "repository.read",
    "artifact.write",
    "commands.execute",
    "environment.project",
    "network.project",
    "preview.capture",
  ],
  review: ["repository.read", "context.read"],
  validate: ["repository.read", "artifact.write", "commands.execute"],
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
      "visual_feedback",
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

const taskContracts: Readonly<
  Record<
    WorkflowAgentTask,
    {
      readonly executor: "agent.read" | "agent.write";
      readonly requiredInputs: readonly string[];
      readonly resultKey: string;
      readonly schema: WorkflowAgentSchema;
    }
  >
> = {
  qualification: {
    executor: "agent.read",
    requiredInputs: ["issue"],
    resultKey: "qualification",
    schema: "roundhouse.qualification.v1",
  },
  investigation: {
    executor: "agent.read",
    requiredInputs: ["issue", "qualification"],
    resultKey: "reproduction",
    schema: "roundhouse.investigation.v1",
  },
  planning: {
    executor: "agent.read",
    requiredInputs: ["issue", "qualification", "reproduction"],
    resultKey: "plan",
    schema: "roundhouse.plan.v1",
  },
  implementation: {
    executor: "agent.write",
    requiredInputs: ["issue", "qualification", "reproduction", "plan"],
    resultKey: "implementation",
    schema: "roundhouse.implementation.v1",
  },
};

export function requiredWorkflowAgentInputs(
  task: WorkflowAgentTask,
): readonly string[] {
  return taskContracts[task].requiredInputs;
}

function workflowReference(value: unknown, error: string): string {
  if (
    typeof value !== "string" ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  )
    throw new Error(error);
  return `.roundhouse/${value}`;
}

function model(value: unknown, error: string): WorkflowModel {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["id", "reasoning"]) ||
    typeof value.id !== "string" ||
    !/^[a-z0-9._-]+\/[A-Za-z0-9._/-]+$/.test(value.id) ||
    !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
      String(value.reasoning),
    )
  )
    throw new Error(error);
  return {
    id: value.id,
    reasoning: value.reasoning as WorkflowModel["reasoning"],
  };
}

function competition(value: unknown): WorkflowCompetition {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["candidates", "judge"]) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length < 2
  )
    throw new Error("workflow_competition_invalid");
  const candidates = value.candidates.map(
    (candidate): WorkflowCompetitionCandidate => {
      if (
        !isRecord(candidate) ||
        !hasOnlyKeys(candidate, ["id", "model"]) ||
        typeof candidate.id !== "string" ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(candidate.id)
      )
        throw new Error("workflow_competition_invalid");
      return {
        id: candidate.id,
        model: model(candidate.model, "workflow_competition_invalid"),
      };
    },
  );
  if (
    new Set(candidates.map((candidate) => candidate.id)).size !==
    candidates.length
  )
    throw new Error("workflow_competition_duplicate");
  if (!isRecord(value.judge) || !hasOnlyKeys(value.judge, ["model"]))
    throw new Error("workflow_competition_judge_invalid");
  return {
    candidates,
    judge: {
      model: model(value.judge.model, "workflow_competition_judge_invalid"),
    },
  };
}

function modelOrCompetition(
  value: Record<string, unknown>,
  error: string,
): Pick<WorkflowAgent, "model" | "competition"> {
  const hasModel = value.model !== undefined;
  const hasCompetition = value.competition !== undefined;
  if (hasModel === hasCompetition) throw new Error(error);
  if (hasModel) return { model: model(value.model, error) };
  return { competition: competition(value.competition) };
}

// Candidate and judge attempts persist roles derived from the node's base
// role, and the runtime attempt ID helper rejects roles longer than 64
// characters. Compilation must reject definitions whose derived candidate or
// judge role could never dispatch.
const attemptRolePattern = /^[a-z][a-z0-9-]{0,63}$/;

function validateCompetitionRoles(
  baseRole: string,
  competition: WorkflowCompetition,
): void {
  if (
    !attemptRolePattern.test(`${baseRole}-judge`) ||
    competition.candidates.some(
      (candidate) =>
        !attemptRolePattern.test(`${baseRole}-candidate-${candidate.id}`),
    )
  )
    throw new Error("workflow_competition_role_invalid");
}

async function agent(
  value: unknown,
  executor: WorkflowExecutorKind,
  loadFile?: WorkflowFileLoader,
): Promise<WorkflowAgent> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      ["task", "inputs", "result"],
      ["model", "competition", "prompt"],
    ) ||
    !workflowAgentTasks.includes(value.task as WorkflowAgentTask) ||
    !isRecord(value.inputs) ||
    Object.keys(value.inputs).length === 0 ||
    Object.values(value.inputs).some(
      (selector) =>
        typeof selector !== "string" ||
        !/^(?:trigger\.issue|nodes\.[a-z][a-z0-9-]{0,63}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)$/.test(
          selector,
        ),
    ) ||
    !isRecord(value.result) ||
    !hasOnlyKeys(value.result, ["key", "schema"]) ||
    typeof value.result.key !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value.result.key) ||
    !workflowAgentSchemas.includes(value.result.schema as WorkflowAgentSchema)
  )
    throw new Error("workflow_agent_invalid");
  const task = value.task as WorkflowAgentTask;
  const inputs = value.inputs as Record<string, string>;
  const contract = taskContracts[task];
  if (
    executor !== contract.executor ||
    value.result.key !== contract.resultKey ||
    value.result.schema !== contract.schema ||
    contract.requiredInputs.some((input) => typeof inputs[input] !== "string")
  )
    throw new Error("workflow_agent_contract_invalid");
  const sourcePath =
    value.prompt === undefined
      ? undefined
      : workflowReference(value.prompt, "workflow_agent_prompt_invalid");
  if (sourcePath && !sourcePath.startsWith(".roundhouse/prompts/"))
    throw new Error("workflow_agent_prompt_invalid");
  if (sourcePath && !loadFile) throw new Error("workflow_file_loader_missing");
  const content = sourcePath ? await loadFile!(sourcePath) : undefined;
  if (content !== undefined && !content.trim())
    throw new Error("workflow_agent_prompt_empty");
  return {
    task,
    inputs: Object.fromEntries(
      Object.entries(inputs).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ) as Record<string, string>,
    result: {
      key: value.result.key,
      schema: value.result.schema as WorkflowAgentSchema,
    },
    ...modelOrCompetition(value, "workflow_agent_invalid"),
    ...(sourcePath && content !== undefined
      ? { prompt: { sourcePath, content } }
      : {}),
  };
}

async function review(
  value: unknown,
  loadFile?: WorkflowFileLoader,
): Promise<WorkflowReview> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["reviewers"]) ||
    !Array.isArray(value.reviewers) ||
    value.reviewers.length === 0
  )
    throw new Error("workflow_review_invalid");
  const reviewers = await Promise.all(
    value.reviewers.map(async (candidate): Promise<WorkflowReviewer> => {
      if (
        !isRecord(candidate) ||
        !hasOnlyKeys(
          candidate,
          ["id", "label", "activation", "mode", "blocking_severities"],
          ["model", "competition", "selected_by", "selects", "prompt"],
        ) ||
        typeof candidate.id !== "string" ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(candidate.id) ||
        typeof candidate.label !== "string" ||
        !candidate.label.trim() ||
        !workflowReviewActivations.includes(
          candidate.activation as WorkflowReviewActivation,
        ) ||
        !workflowReviewModes.includes(candidate.mode as WorkflowReviewMode)
      )
        throw new Error("workflow_reviewer_invalid");
      const blockingSeverities = stringList(
        candidate.blocking_severities,
        "workflow_reviewer_severities_invalid",
      );
      if (
        blockingSeverities.some(
          (severity) =>
            !["critical", "high", "medium", "low"].includes(severity),
        )
      )
        throw new Error("workflow_reviewer_severities_invalid");
      const selects =
        candidate.selects === undefined
          ? []
          : stringList(candidate.selects, "workflow_reviewer_selects_invalid");
      const sourcePath =
        candidate.prompt === undefined
          ? undefined
          : workflowReference(
              candidate.prompt,
              "workflow_reviewer_prompt_invalid",
            );
      if (sourcePath && !sourcePath.startsWith(".roundhouse/prompts/"))
        throw new Error("workflow_reviewer_prompt_invalid");
      if (sourcePath && !loadFile)
        throw new Error("workflow_file_loader_missing");
      const content = sourcePath ? await loadFile!(sourcePath) : undefined;
      if (content !== undefined && !content.trim())
        throw new Error("workflow_reviewer_prompt_empty");
      return {
        id: candidate.id,
        label: candidate.label,
        activation: candidate.activation as WorkflowReviewActivation,
        ...(candidate.selected_by === undefined
          ? {}
          : typeof candidate.selected_by === "string"
            ? { selectedBy: candidate.selected_by }
            : (() => {
                throw new Error("workflow_reviewer_selected_by_invalid");
              })()),
        selects,
        mode: candidate.mode as WorkflowReviewMode,
        blockingSeverities,
        ...modelOrCompetition(candidate, "workflow_reviewer_invalid"),
        ...(sourcePath && content !== undefined
          ? { prompt: { sourcePath, content } }
          : {}),
      };
    }),
  );
  const byId = new Map(reviewers.map((reviewer) => [reviewer.id, reviewer]));
  if (byId.size !== reviewers.length)
    throw new Error("workflow_reviewer_duplicate");
  for (const reviewer of reviewers)
    if (reviewer.competition)
      validateCompetitionRoles(reviewer.id, reviewer.competition);
  for (const reviewer of reviewers) {
    if (
      (reviewer.activation === "selected") !== Boolean(reviewer.selectedBy) ||
      reviewer.selects.some(
        (selected) =>
          !byId.has(selected) ||
          selected === reviewer.id ||
          byId.get(selected)?.selectedBy !== reviewer.id,
      ) ||
      (reviewer.selectedBy !== undefined &&
        (!byId.has(reviewer.selectedBy) ||
          !byId.get(reviewer.selectedBy)?.selects.includes(reviewer.id)))
    )
      throw new Error("workflow_reviewer_selection_invalid");
  }
  return { reviewers };
}

async function human(
  value: unknown,
  loadFile?: WorkflowFileLoader,
): Promise<WorkflowHuman> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["reason", "audience"], ["prompt"]) ||
    ![
      "clarification",
      "visual_feedback",
      "plan_approval",
      "final_approval",
      "maintainer_judgment",
    ].includes(String(value.reason)) ||
    !["participant", "operator"].includes(String(value.audience))
  )
    throw new Error("workflow_human_invalid");
  const sourcePath =
    value.prompt === undefined
      ? undefined
      : workflowReference(value.prompt, "workflow_human_prompt_invalid");
  if (sourcePath && !sourcePath.startsWith(".roundhouse/prompts/"))
    throw new Error("workflow_human_prompt_invalid");
  if (sourcePath && !loadFile) throw new Error("workflow_file_loader_missing");
  const content = sourcePath ? await loadFile!(sourcePath) : undefined;
  if (content !== undefined && !content.trim())
    throw new Error("workflow_human_prompt_empty");
  return {
    reason: value.reason as WorkflowHuman["reason"],
    audience: value.audience as WorkflowHuman["audience"],
    ...(sourcePath && content !== undefined
      ? { prompt: { sourcePath, content } }
      : {}),
  };
}

function external(value: unknown): WorkflowExternal {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["adapter", "event", "result"]) ||
    typeof value.adapter !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value.adapter) ||
    typeof value.event !== "string" ||
    !/^[a-z][a-z0-9._-]{0,127}$/.test(value.event) ||
    typeof value.result !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value.result)
  )
    throw new Error("workflow_external_invalid");
  return {
    adapter: value.adapter,
    event: value.event,
    resultKey: value.result,
  };
}

async function node(
  value: unknown,
  loadFile?: WorkflowFileLoader,
): Promise<WorkflowNode> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      ["executor", "transitions"],
      [
        "role",
        "agent",
        "review",
        "human",
        "external",
        "capabilities",
        "outputs",
      ],
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
  if (
    ["agent.read", "agent.write"].includes(executor) !==
    (value.agent !== undefined)
  )
    throw new Error("workflow_agent_required");
  if ((executor === "review") !== (value.review !== undefined))
    throw new Error("workflow_review_required");
  if ((executor === "human") !== (value.human !== undefined))
    throw new Error("workflow_human_required");
  if (
    ["external.wait", "external.check"].includes(executor) !==
    (value.external !== undefined)
  )
    throw new Error("workflow_external_required");
  const capabilities =
    value.capabilities === undefined
      ? []
      : stringList(value.capabilities, "workflow_capabilities_invalid");
  if (
    capabilities.some(
      (capability) =>
        !(executorCapabilities[executor] as readonly string[]).includes(
          capability,
        ),
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
    ...(value.agent === undefined
      ? {}
      : { agent: await agent(value.agent, executor, loadFile) }),
    ...(value.review === undefined
      ? {}
      : { review: await review(value.review, loadFile) }),
    ...(value.human === undefined
      ? {}
      : { human: await human(value.human, loadFile) }),
    ...(value.external === undefined
      ? {}
      : { external: external(value.external) }),
    capabilities: capabilities as WorkflowCapability[],
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
    if (definition.agent) {
      if (
        !definition.outputs.some(
          (output) =>
            output === definition.agent!.result.key ||
            output.startsWith(`${definition.agent!.result.key}.`),
        )
      )
        throw new Error("workflow_agent_output_undeclared");
      for (const selector of Object.values(definition.agent.inputs)) {
        if (selector === "trigger.issue") continue;
        const match = /^nodes\.([a-z][a-z0-9-]{0,63})\.(.+)$/.exec(selector);
        const source = match ? nodes[match[1]!] : undefined;
        if (
          !match ||
          !source ||
          !source.outputs.some(
            (output) =>
              output === match[2] ||
              output.startsWith(`${match[2]}.`) ||
              match[2]!.startsWith(`${output}.`),
          )
        )
          throw new Error("workflow_agent_input_reference_invalid");
      }
    }
    if (
      definition.human &&
      !definition.outputs.some(
        (output) => output === "human" || output.startsWith("human."),
      )
    )
      throw new Error("workflow_human_output_undeclared");
    if (
      definition.external &&
      !definition.outputs.some(
        (output) =>
          output === definition.external!.resultKey ||
          output.startsWith(`${definition.external!.resultKey}.`),
      )
    )
      throw new Error("workflow_external_output_undeclared");
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
  loadFile?: WorkflowFileLoader,
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
  const nodes: Record<string, WorkflowNode> = Object.fromEntries(
    await Promise.all(
      Object.entries(value.nodes).map(async ([nodeId, definition]) => [
        nodeId,
        await node(definition, loadFile),
      ]),
    ),
  );
  validateGraph(triggers, nodes);
  for (const [nodeId, definition] of Object.entries(nodes))
    if (definition.agent?.competition)
      validateCompetitionRoles(
        definition.role ?? nodeId,
        definition.agent.competition,
      );
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
