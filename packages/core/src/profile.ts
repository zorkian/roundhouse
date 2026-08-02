// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { parseDocument } from "yaml";
import {
  compileWorkflow,
  defaultIssueWorkflowSource,
  type CompiledWorkflow,
  workflowSourcePath,
} from "./workflow.js";
import {
  modelThinkingLevels,
  type ModelThinkingLevel,
} from "./model-catalog.js";

export const profileSourcePath = ".roundhouse/profile.yaml" as const;
export const profileStageNames = [
  "qualification",
  "investigation",
  "planning",
  "implementation",
] as const;
export const profileReviewerNames = ["holistic", "security", "data"] as const;
export const repositoryPermissions = ["admin", "maintain", "write"] as const;
export const mergeModes = ["automatic", "maintainer"] as const;
export const mergeMethods = ["merge", "squash", "rebase"] as const;
export const profileReasoningLevels = modelThinkingLevels;
export const findingSeverities = ["critical", "high", "medium", "low"] as const;

export type ProfileStageName = (typeof profileStageNames)[number];
export type ProfileReviewerName = (typeof profileReviewerNames)[number];
export type RepositoryPermission = (typeof repositoryPermissions)[number];
export type MergeMode = (typeof mergeModes)[number];
export type MergeMethod = (typeof mergeMethods)[number];
export type ProfileReasoningLevel = ModelThinkingLevel;
export type FindingSeverity = (typeof findingSeverities)[number];

export interface ProfileInstruction {
  readonly sourcePath: string;
  readonly content: string;
}

export interface ProfileModel {
  readonly id: string;
  readonly reasoning: ProfileReasoningLevel;
}

export interface ProfileStage {
  readonly model: ProfileModel;
  readonly instructions?: ProfileInstruction;
}

export interface ProfileReviewer extends ProfileStage {
  readonly enabled: boolean;
  readonly selectedBy?: "holistic";
  readonly blockingSeverities: readonly FindingSeverity[];
}

export interface AppliedProfile {
  readonly sourcePath: typeof profileSourcePath;
  readonly sourceCommit: string;
  readonly version: 1 | 2;
  readonly hash: string;
  // Optional only so historical/profile-error snapshots remain readable.
  // Every successfully parsed profile includes a compiled workflow.
  readonly workflow?: CompiledWorkflow;
  // Optional so historical snapshots remain readable. Parsed profiles always
  // include the default when the source predates this setting.
  readonly conversation?: {
    readonly model: ProfileModel;
  };
  readonly paths: {
    readonly allowed: readonly string[];
    readonly protected: readonly string[];
  };
  readonly merge?: {
    readonly mode: MergeMode;
    readonly method: MergeMethod;
  };
  readonly permissions?: {
    readonly operators: {
      readonly repositoryPermissions: readonly RepositoryPermission[];
      readonly users: readonly string[];
      readonly teams: readonly string[];
    };
  };
  readonly instructions?: {
    readonly project?: ProfileInstruction;
  };
  readonly stages?: Readonly<Record<ProfileStageName, ProfileStage>>;
  readonly reviewers?: Readonly<Record<ProfileReviewerName, ProfileReviewer>>;
  readonly validation?: {
    readonly commands: readonly {
      readonly name: string;
      readonly run: readonly string[];
    }[];
  };
  readonly developmentEnvironment?: {
    readonly devcontainer?: string;
  };
}

export type ProfileFileLoader = (path: string) => Promise<string>;

const defaultStageModels: Readonly<Record<ProfileStageName, ProfileModel>> = {
  qualification: {
    id: "openai/gpt-5.6-luna",
    reasoning: "high",
  },
  investigation: {
    id: "openai/gpt-5.6-terra",
    reasoning: "high",
  },
  planning: {
    id: "openai/gpt-5.6-sol",
    reasoning: "max",
  },
  implementation: {
    id: "openai/gpt-5.6-terra",
    reasoning: "max",
  },
};
const defaultReviewerModels: Readonly<
  Record<ProfileReviewerName, ProfileModel>
> = {
  holistic: {
    id: "anthropic/claude-opus-5",
    reasoning: "max",
  },
  security: {
    id: "moonshotai/kimi-k3",
    reasoning: "max",
  },
  data: {
    id: "openai/gpt-5.6-sol",
    reasoning: "max",
  },
};
const defaultConversationModel: ProfileModel = {
  id: "openai/gpt-5.6-sol",
  reasoning: "high",
};
const defaultBlockingSeverities: readonly FindingSeverity[] = [
  "critical",
  "high",
  "medium",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const actual = Object.keys(value);
  return (
    required.every((key) => actual.includes(key)) &&
    actual.every((key) => required.includes(key) || optional.includes(key))
  );
}

function stringList(value: unknown, error: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(error);
  return [...new Set(value)].sort();
}

function enumList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  error: string,
): T[] {
  const items = stringList(value, error);
  if (items.some((item) => !allowed.includes(item as T)))
    throw new Error(error);
  return items as T[];
}

function validateRepositoryPath(path: string, error: string): string {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  )
    throw new Error(error);
  return path;
}

function validatePattern(pattern: string): void {
  validateRepositoryPath(pattern, "profile_path_pattern_invalid");
}

function model(value: unknown, error: string): ProfileModel {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["id", "reasoning"]) ||
    typeof value.id !== "string" ||
    !/^[a-z0-9._-]+\/[A-Za-z0-9._/-]+$/.test(value.id) ||
    !profileReasoningLevels.includes(value.reasoning as ProfileReasoningLevel)
  )
    throw new Error(error);
  return {
    id: value.id,
    reasoning: value.reasoning as ProfileReasoningLevel,
  };
}

function parseConversationModel(value: unknown): ProfileModel {
  const configured = model(value, "profile_conversation_invalid");
  if (!configured.id.startsWith("openai/"))
    throw new Error("profile_conversation_invalid");
  return configured;
}

function instructionSource(value: unknown, error: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(error);
  const relative = validateRepositoryPath(value, error);
  if (!relative.startsWith("prompts/")) throw new Error(error);
  return `.roundhouse/${relative}`;
}

async function instruction(
  sourcePath: string | undefined,
  loadFile: ProfileFileLoader | undefined,
): Promise<ProfileInstruction | undefined> {
  if (!sourcePath) return undefined;
  if (!loadFile) throw new Error("profile_instruction_loader_missing");
  const content = await loadFile(sourcePath);
  if (!content.trim()) throw new Error("profile_instruction_empty");
  return { sourcePath, content };
}

function reviewerConfig(
  value: unknown,
  name: ProfileReviewerName,
): {
  enabled: boolean;
  selectedBy?: "holistic";
  model: ProfileModel;
  instructions?: string;
  blockingSeverities: FindingSeverity[];
} {
  const required =
    name === "holistic"
      ? ["enabled", "model", "blocking_severities"]
      : ["enabled", "selected_by", "model", "blocking_severities"];
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, required, ["instructions"]) ||
    typeof value.enabled !== "boolean" ||
    (name === "holistic"
      ? value.enabled !== true
      : value.selected_by !== "holistic")
  )
    throw new Error(`profile_reviewer_${name}_invalid`);
  const source = instructionSource(
    value.instructions,
    `profile_reviewer_${name}_invalid`,
  );
  return {
    enabled: value.enabled,
    ...(name === "holistic" ? {} : { selectedBy: "holistic" as const }),
    model: model(value.model, `profile_reviewer_${name}_invalid`),
    ...(source ? { instructions: source } : {}),
    blockingSeverities: enumList(
      value.blocking_severities,
      findingSeverities,
      `profile_reviewer_${name}_invalid`,
    ),
  };
}

async function v1Profile(
  value: Record<string, unknown>,
  sourceCommit: string,
): Promise<Omit<AppliedProfile, "sourcePath" | "sourceCommit" | "hash">> {
  if (
    !hasOnlyKeys(value, ["paths", "version"]) ||
    !isRecord(value.paths) ||
    !hasOnlyKeys(value.paths, ["allowed", "protected"])
  )
    throw new Error("profile_schema_invalid");
  const allowed = stringList(
    value.paths.allowed,
    "profile_paths_allowed_invalid",
  );
  const protectedPaths = stringList(
    value.paths.protected,
    "profile_paths_protected_invalid",
  );
  [...allowed, ...protectedPaths].forEach(validatePattern);
  const stages = Object.fromEntries(
    profileStageNames.map((name) => [
      name,
      {
        model: defaultStageModels[name],
      },
    ]),
  ) as unknown as Record<ProfileStageName, ProfileStage>;
  return {
    version: 1,
    workflow: await compileWorkflow(defaultIssueWorkflowSource, sourceCommit),
    conversation: { model: defaultConversationModel },
    paths: { allowed, protected: protectedPaths },
    merge: { mode: "automatic", method: "merge" },
    permissions: {
      operators: {
        repositoryPermissions: [...repositoryPermissions],
        users: [],
        teams: [],
      },
    },
    instructions: {},
    stages,
    reviewers: {
      holistic: {
        enabled: true,
        model: defaultReviewerModels.holistic,
        blockingSeverities: defaultBlockingSeverities,
      },
      security: {
        enabled: true,
        selectedBy: "holistic",
        model: defaultReviewerModels.security,
        blockingSeverities: defaultBlockingSeverities,
      },
      data: {
        enabled: true,
        selectedBy: "holistic",
        model: defaultReviewerModels.data,
        blockingSeverities: defaultBlockingSeverities,
      },
    },
    validation: { commands: [] },
    developmentEnvironment: {},
  };
}

async function v2Profile(
  value: Record<string, unknown>,
  sourceCommit: string,
  loadFile?: ProfileFileLoader,
): Promise<Omit<AppliedProfile, "sourcePath" | "sourceCommit" | "hash">> {
  const topLevel = [
    "development_environment",
    "instructions",
    "merge",
    "paths",
    "permissions",
    "validation",
    "version",
    "workflow",
  ];
  if (!hasOnlyKeys(value, topLevel, ["conversation"]))
    throw new Error("profile_schema_invalid");
  let conversationModel = defaultConversationModel;
  if (value.conversation !== undefined) {
    if (
      !isRecord(value.conversation) ||
      !hasOnlyKeys(value.conversation, ["model"])
    )
      throw new Error("profile_conversation_invalid");
    conversationModel = parseConversationModel(value.conversation.model);
  }
  if (
    !isRecord(value.paths) ||
    !hasOnlyKeys(value.paths, ["allowed", "protected"])
  )
    throw new Error("profile_paths_invalid");
  const allowed = stringList(
    value.paths.allowed,
    "profile_paths_allowed_invalid",
  );
  const protectedPaths = stringList(
    value.paths.protected,
    "profile_paths_protected_invalid",
  );
  [...allowed, ...protectedPaths].forEach(validatePattern);

  if (
    !isRecord(value.merge) ||
    !hasOnlyKeys(value.merge, ["mode", "method"]) ||
    !mergeModes.includes(value.merge.mode as MergeMode) ||
    !mergeMethods.includes(value.merge.method as MergeMethod)
  )
    throw new Error("profile_merge_invalid");

  if (
    !isRecord(value.permissions) ||
    !hasOnlyKeys(value.permissions, ["operators"]) ||
    !isRecord(value.permissions.operators) ||
    !hasOnlyKeys(value.permissions.operators, [
      "repository_permissions",
      "users",
      "teams",
    ])
  )
    throw new Error("profile_permissions_invalid");
  const operatorPermissions = enumList(
    value.permissions.operators.repository_permissions,
    repositoryPermissions,
    "profile_operator_permissions_invalid",
  );
  const users = stringList(
    value.permissions.operators.users,
    "profile_operator_users_invalid",
  );
  const teams = stringList(
    value.permissions.operators.teams,
    "profile_operator_teams_invalid",
  );
  if (users.some((user) => !/^[A-Za-z0-9-]{1,39}$/.test(user)))
    throw new Error("profile_operator_users_invalid");
  if (
    teams.some(
      (team) =>
        !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9_-]+$/.test(
          team,
        ),
    )
  )
    throw new Error("profile_operator_teams_invalid");

  if (
    !isRecord(value.instructions) ||
    !hasOnlyKeys(value.instructions, [], ["project"])
  )
    throw new Error("profile_instructions_invalid");
  const projectSource = instructionSource(
    value.instructions.project,
    "profile_project_instructions_invalid",
  );
  if (value.workflow !== "workflow.yaml")
    throw new Error("profile_workflow_invalid");
  if (!loadFile) throw new Error("profile_workflow_loader_missing");
  const workflow = await compileWorkflow(
    await loadFile(workflowSourcePath),
    sourceCommit,
    loadFile,
  );

  if (
    !isRecord(value.validation) ||
    !hasOnlyKeys(value.validation, ["commands"]) ||
    !Array.isArray(value.validation.commands)
  )
    throw new Error("profile_validation_invalid");
  const commands = value.validation.commands.map((command) => {
    if (
      !isRecord(command) ||
      !hasOnlyKeys(command, ["name", "run"]) ||
      typeof command.name !== "string" ||
      !command.name.trim() ||
      !Array.isArray(command.run) ||
      !command.run.length ||
      command.run.some((argument) => typeof argument !== "string" || !argument)
    )
      throw new Error("profile_validation_command_invalid");
    return { name: command.name, run: command.run as string[] };
  });

  if (
    !isRecord(value.development_environment) ||
    !hasOnlyKeys(value.development_environment, [], ["devcontainer"])
  )
    throw new Error("profile_development_environment_invalid");
  const devcontainer =
    value.development_environment.devcontainer === undefined
      ? undefined
      : typeof value.development_environment.devcontainer === "string"
        ? validateRepositoryPath(
            value.development_environment.devcontainer,
            "profile_devcontainer_invalid",
          )
        : (() => {
            throw new Error("profile_devcontainer_invalid");
          })();

  return {
    version: 2,
    workflow,
    conversation: { model: conversationModel },
    paths: { allowed, protected: protectedPaths },
    merge: {
      mode: value.merge.mode as MergeMode,
      method: value.merge.method as MergeMethod,
    },
    permissions: {
      operators: {
        repositoryPermissions: operatorPermissions,
        users,
        teams,
      },
    },
    instructions: {
      ...(projectSource
        ? { project: await instruction(projectSource, loadFile) }
        : {}),
    },
    validation: { commands },
    developmentEnvironment: {
      ...(devcontainer ? { devcontainer } : {}),
    },
  };
}

export async function parseProfile(
  yaml: string,
  sourceCommit: string,
  loadFile?: ProfileFileLoader,
): Promise<AppliedProfile> {
  const document = parseDocument(yaml, { uniqueKeys: true });
  if (document.errors.length) throw new Error("profile_yaml_invalid");
  const value: unknown = document.toJS();
  if (!isRecord(value) || ![1, 2].includes(value.version as number))
    throw new Error("profile_schema_invalid");
  const normalized =
    value.version === 1
      ? await v1Profile(value, sourceCommit)
      : await v2Profile(value, sourceCommit, loadFile);
  const canonical = JSON.stringify(normalized);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return {
    sourcePath: profileSourcePath,
    sourceCommit,
    hash,
    ...normalized,
  };
}

export function normalizeRepositoryPath(path: string): string {
  return validateRepositoryPath(path, "invalid_repository_path");
}

function matches(pattern: string, path: string): boolean {
  let expression = "";
  for (let i = 0; i < pattern.length; i++) {
    const character = pattern[i]!;
    if (character === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        expression += "(?:[^/]+/)*";
        i += 2;
      } else {
        expression += ".*";
        i++;
      }
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${expression}$`).test(path);
}

export function assertPathAllowed(
  profile: AppliedProfile,
  candidate: string,
): void {
  const path = normalizeRepositoryPath(candidate);
  if (
    path === ".roundhouse" ||
    path.startsWith(".roundhouse/") ||
    path === profile.developmentEnvironment?.devcontainer ||
    profile.paths.protected.some((pattern) => matches(pattern, path))
  )
    throw new Error("protected_path_changed");
  if (!profile.paths.allowed.some((pattern) => matches(pattern, path)))
    throw new Error("path_outside_allowlist");
}

export function profileModelForAttempt(
  profile: AppliedProfile,
  stage: string,
  role: string,
): ProfileModel | undefined {
  if (role === "review-holistic" || role === "review-integration")
    return profile.reviewers?.holistic.model;
  if (role === "review-security") return profile.reviewers?.security.model;
  if (role === "review-data") return profile.reviewers?.data.model;
  if (role === "conflict-resolution")
    return profile.stages?.implementation.model;
  if (stage === "qualify") return profile.stages?.qualification.model;
  if (stage === "reproduce") return profile.stages?.investigation.model;
  if (stage === "plan") return profile.stages?.planning.model;
  if (stage === "implement") return profile.stages?.implementation.model;
  return undefined;
}
