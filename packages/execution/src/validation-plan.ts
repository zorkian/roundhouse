// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { matchesGlob } from "node:path";

import type {
  ProfileCommand,
  RepositoryProfile,
} from "@roundhouse/repository-profile";

import type { ChangedFile } from "./changed-files.js";
import type { ValidationLevel, ValidationRequest } from "./types.js";

export type ValidationCommandName =
  "license" | "format" | "compile" | "targeted";

export type PlannedValidationCommand = {
  name: ValidationCommandName;
  command: ProfileCommand;
};

export type ValidationPlan = {
  requestedLevel: ValidationLevel;
  effectiveLevel: ValidationLevel;
  changedFiles: ChangedFile[];
  commands: PlannedValidationCommand[];
  reasons: string[];
};

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(path, pattern));
}

function fullCommands(profile: RepositoryProfile): PlannedValidationCommand[] {
  const names = ["format", "compile", "targeted"] as const;
  const commands: PlannedValidationCommand[] = names.map((name) => ({
    name,
    command: {
      command: profile.validation[name].command,
      args: profile.validation[name].args,
    },
  }));
  if (profile.validation.license)
    commands.unshift({ name: "license", command: profile.validation.license });
  return commands;
}

export function planValidation(
  profile: RepositoryProfile,
  request: ValidationRequest,
): ValidationPlan {
  if (request.level !== "quick") {
    return {
      requestedLevel: request.level,
      effectiveLevel: request.level,
      changedFiles: request.changedFiles,
      commands: fullCommands(profile),
      reasons: [],
    };
  }

  const quick = profile.validation.quick;
  if (!quick) {
    return {
      requestedLevel: "quick",
      effectiveLevel: "full",
      changedFiles: request.changedFiles,
      commands: fullCommands(profile),
      reasons: ["The repository profile does not define quick validation"],
    };
  }

  const escalation = request.changedFiles.find((change) =>
    [change.path, change.previousPath]
      .filter((path): path is string => path !== undefined)
      .some((path) => matchesAny(path, quick.fullWhenChanged)),
  );
  if (escalation) {
    return {
      requestedLevel: "quick",
      effectiveLevel: "full",
      changedFiles: request.changedFiles,
      commands: fullCommands(profile),
      reasons: [`${escalation.path} requires full validation`],
    };
  }

  const formatPaths = request.changedFiles
    .filter((change) => change.status !== "deleted")
    .map((change) => change.path)
    .filter((path) => matchesAny(path, quick.format.include));
  const commands: PlannedValidationCommand[] = [];
  if (profile.validation.license)
    commands.push({ name: "license", command: profile.validation.license });
  if (formatPaths.length > 0) {
    commands.push({
      name: "format",
      command: {
        command: quick.format.command,
        args: [...quick.format.args, ...formatPaths],
      },
    });
  }
  commands.push(
    {
      name: "compile",
      command: profile.validation.compile,
    },
    {
      name: "targeted",
      command: profile.validation.targeted,
    },
  );

  return {
    requestedLevel: "quick",
    effectiveLevel: "quick",
    changedFiles: request.changedFiles,
    commands,
    reasons: [],
  };
}
