// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activityRequest,
  agentRuntime,
  completionRequest,
  checkpointWorkspace,
  implementationPrompt,
  implementationSchema,
  investigationPrompt,
  planningPrompt,
  planSchema,
  piModelConfiguration,
  prepareWorkspace,
  reviewSchema,
  reproductionSchema,
  requestClassification,
  repositoryChangedPaths,
  runnerIdentity,
  runnerResponse,
  validateCheckpoint,
  validModelRoute,
} from "./runner.mjs";

const testRoot = resolve(process.cwd(), ".runner-test-workspaces");
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(testRoot, { recursive: true, force: true });
});

describe("V2 agent runner", () => {
  it("uses the Container rather than an unavailable nested sandbox", () => {
    expect(agentRuntime).toBe("pi");
  });

  it("configures Pi for the persisted native route without exposing a provider key", () => {
    const configuration = piModelConfiguration(
      {
        id: "attempt_1",
        routing: {
          provider: "moonshotai",
          model: "moonshotai/kimi-k3",
          protocol: "openai-completions",
          thinkingLevel: "low",
          rule: "review-security-v1",
        },
      },
      "attempt-capability",
    );
    expect(configuration.providers.moonshotai).toMatchObject({
      baseUrl: "http://model.roundhouse.internal/v1",
      api: "openai-completions",
      apiKey: "roundhouse-internal",
      authHeader: false,
      headers: {
        "x-roundhouse-attempt-id": "attempt_1",
        "x-roundhouse-attempt-capability": "attempt-capability",
      },
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      },
      models: [{ id: "moonshotai/kimi-k3", reasoning: true }],
    });
  });

  it("uses the base path expected by each native provider SDK", () => {
    const configurationFor = (protocol) =>
      piModelConfiguration(
        {
          id: "attempt_1",
          routing: {
            provider: "provider",
            model: "provider/model",
            protocol,
            thinkingLevel: "low",
            rule: "test-v1",
          },
        },
        "attempt-capability",
      ).providers.provider.baseUrl;

    expect(configurationFor("openai-responses")).toBe(
      "http://model.roundhouse.internal/v1",
    );
    expect(configurationFor("openai-completions")).toBe(
      "http://model.roundhouse.internal/v1",
    );
    expect(configurationFor("anthropic-messages")).toBe(
      "http://model.roundhouse.internal",
    );
    expect(configurationFor("google-generative-ai")).toBe(
      "http://model.roundhouse.internal/v1beta",
    );

    const anthropic = piModelConfiguration(
      {
        id: "attempt_1",
        routing: {
          provider: "anthropic",
          model: "anthropic/claude-fable-5",
          protocol: "anthropic-messages",
          thinkingLevel: "low",
          rule: "review-holistic-v1",
        },
      },
      "attempt-capability",
    );
    expect(anthropic.providers.anthropic.compat).toEqual({
      forceAdaptiveThinking: true,
    });
  });

  it("rejects missing and empty native routes before configuring Pi", () => {
    expect(validModelRoute(undefined)).toBe(false);
    expect(
      validModelRoute({
        provider: "",
        model: "openai/gpt-5.6-sol",
        protocol: "openai-responses",
        thinkingLevel: "low",
        rule: "implementation-default-v1",
      }),
    ).toBe(false);
    expect(() => piModelConfiguration({}, "capability")).toThrow(
      "invalid_model_route",
    );
  });

  it("requires structured reproduction evidence without arbitrary caps", () => {
    expect(reproductionSchema.properties.status.enum).toEqual([
      "confirmed",
      "not_reproduced",
      "blocked",
    ]);
    expect(reproductionSchema.required).toEqual(
      expect.arrayContaining([
        "commands",
        "expectedBehavior",
        "observedBehavior",
        "relevantFiles",
        "uncertainties",
        "sources",
      ]),
    );
    expect(reproductionSchema.properties.commands.items).toMatchObject({
      additionalProperties: false,
      required: ["command", "exitCode", "output"],
    });
    expect(reproductionSchema.properties.commands).not.toHaveProperty(
      "maxItems",
    );
    expect(
      reproductionSchema.properties.commands.items.properties.output,
    ).not.toHaveProperty("maxLength");
    expect(reproductionSchema.properties.summary).not.toHaveProperty(
      "maxLength",
    );
  });

  it("supports a ready plan or focused prose questions without caps", () => {
    expect(planSchema.properties.status.enum).toEqual([
      "ready",
      "needs_clarification",
    ]);
    expect(planSchema.required).toEqual(
      expect.arrayContaining([
        "acceptanceCriteria",
        "proposedChange",
        "validation",
        "questions",
        "sources",
      ]),
    );
    expect(planSchema.properties.questions).not.toHaveProperty("maxItems");
  });

  it("keeps implementation evidence separate from the pull request text", () => {
    expect(implementationSchema.required).toEqual([
      "summary",
      "pullRequestTitle",
      "pullRequestBody",
      "validation",
    ]);
    expect(implementationSchema.properties.validation).not.toHaveProperty(
      "maxItems",
    );
    expect(
      implementationSchema.properties.validation.items.properties.output,
    ).not.toHaveProperty("maxLength");
  });

  it("lets implementation install declared dependencies for validation", () => {
    const prompt = implementationPrompt({
      issue: { title: "Format the change", body: "", url: "" },
      context: {
        ci: {
          status: "failure",
          checks: [{ name: "Check", conclusion: "failure" }],
        },
      },
    });
    expect(prompt).toContain("install repository-declared dependencies");
    expect(prompt).toContain('"conclusion":"failure"');
  });

  it("investigates each request type and allows declared dependency installation", () => {
    const feature = investigationPrompt({
      issue: { title: "Add a dashboard filter", body: "", url: "" },
      context: { qualification: { classification: "feature" } },
    });
    expect(feature).toContain(
      "Investigate the current behavior for this feature request",
    );
    expect(feature).not.toContain("Attempt to reproduce");
    expect(feature).toContain("install repository-declared dependencies");
    expect(feature).toContain("declared package manager and lockfile");
    expect(feature).toContain("desired outcome, current behavior");
    expect(feature).not.toContain("expected behavior, observed behavior");

    const maintenance = investigationPrompt({
      context: { qualification: { classification: "maintenance" } },
    });
    expect(maintenance).toContain(
      "Investigate the current behavior for this maintenance request",
    );
    expect(maintenance).not.toContain("Attempt to reproduce");

    const bug = investigationPrompt({
      context: { qualification: { classification: "bug" } },
    });
    expect(bug).toContain("Attempt to reproduce this bug report");
    expect(bug).toContain("configured package registry");

    expect(
      requestClassification({
        context: { qualification: { classification: "feature" } },
      }),
    ).toBe("feature");
  });

  it("treats delegated public research as an answer instead of repeating it", () => {
    const prompt = planningPrompt({
      issue: {
        title: "Choose supported model identifiers",
        body: "Use supported model identifiers in the configuration.",
        url: "https://github.com/zorkian/roundhouse/issues/308",
        clarifications: [
          {
            actor: "maintainer",
            body: "Please look them up in Cloudflare's model catalog and choose the simplest reasonable option.",
          },
        ],
      },
      context: {
        qualification: { classification: "feature" },
        reproduction: { status: "confirmed" },
      },
    });
    expect(prompt).toContain("hosted web search");
    expect(prompt).toContain("look them up in Cloudflare's model catalog");
    expect(prompt).toContain(
      "research instruction, not as an unanswered question",
    );
    expect(prompt).toContain("Do not repeat a question");
    expect(prompt).toContain("official or primary sources");
  });

  it("returns concrete review findings without arbitrary caps", () => {
    expect(reviewSchema.properties.status.enum).toEqual([
      "clean",
      "changes_requested",
    ]);
    expect(reviewSchema.required).toEqual(["status", "summary", "findings"]);
    expect(reviewSchema.properties.findings).not.toHaveProperty("maxItems");
    expect(reviewSchema.properties.findings.items).toMatchObject({
      additionalProperties: false,
      required: ["title", "details", "file", "severity"],
    });
  });

  it("reports only its versioned runner identity", () => {
    expect(runnerResponse("GET", "/health")).toEqual({
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ ...runnerIdentity, ok: true }),
    });
  });

  it("rejects undeclared routes and mutating health requests", () => {
    expect(runnerResponse("POST", "/health")).toMatchObject({
      status: 405,
      headers: { allow: "GET" },
    });
    expect(runnerResponse("GET", "/v1/execute")).toMatchObject({
      status: 404,
      body: JSON.stringify({ error: "not_found" }),
    });
  });

  it("accepts an immutable assignment promptly and deduplicates replay", () => {
    const assignment = {
      id: "attempt_1",
      runId: "run_1",
      runRevision: 1,
      deadlineAt: Date.now() + 60_000,
      baseCommit: "a".repeat(40),
      expectedHead: "a".repeat(40),
      routing: {
        provider: "openai",
        model: "openai/gpt-5.6-sol",
        protocol: "openai-responses",
        thinkingLevel: "low",
        rule: "implementation-default-v1",
      },
      artifact: {
        repositoryId: "repo-id",
        repository: "v2-run-1",
        remote: "https://artifacts.invalid/v2-run-1",
        tokenId: "token-id",
        token: "secret-token",
        access: "write",
        ref: "refs/heads/roundhouse/run_1",
      },
    };
    expect(runnerResponse("POST", "/assign", assignment)).toMatchObject({
      status: 202,
      body: JSON.stringify({
        accepted: true,
        attemptId: "attempt_1",
        duplicate: false,
      }),
    });
    expect(runnerResponse("POST", "/assign", assignment)).toMatchObject({
      status: 202,
      body: JSON.stringify({
        accepted: true,
        attemptId: "attempt_1",
        duplicate: true,
      }),
    });
  });

  it("builds an attempt-bound asynchronous completion callback", async () => {
    const assignment = {
      id: "attempt_callback",
      runId: "run_1",
      runRevision: 3,
      deadlineAt: Date.now() + 60_000,
      baseCommit: "a".repeat(40),
      expectedHead: "a".repeat(40),
      artifact: { tokenId: "token-id", access: "write" },
    };
    const checkpoint = {
      repositoryId: "repo-id",
      repository: "v2-run-1",
      baseCommit: assignment.baseCommit,
      inputHead: assignment.expectedHead,
      outputHead: "b".repeat(40),
      ref: "refs/heads/roundhouse/run_1",
      changedPaths: ["src/fix.ts"],
    };
    const request = completionRequest(
      assignment,
      checkpoint,
      "https://v2.invalid/attempts/callback",
      "attempt-secret",
    );
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/attempts/callback");
    await expect(request.json()).resolves.toMatchObject({
      attemptId: assignment.id,
      expectedRevision: 3,
      checkpoint,
      artifactTokenId: "token-id",
      result: { checkpoint: checkpoint.outputHead },
      signature: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("reports activity and can complete after the inactivity lease expires", async () => {
    const assignment = {
      id: "attempt_slow",
      runId: "run_1",
      runRevision: 3,
      deadlineAt: Date.now() - 1,
      baseCommit: "a".repeat(40),
      expectedHead: "a".repeat(40),
      artifact: { tokenId: "token-id", access: "write" },
    };
    const activity = activityRequest(
      assignment,
      "https://v2.invalid/attempts/callback",
      "attempt-secret",
      {
        phase: "command_output",
        operation: "pi agent",
        durationMs: 30_000,
        stdoutBytes: 128,
        stderrBytes: 0,
      },
    );
    expect(new URL(activity.url).pathname).toBe("/attempts/activity");
    expect(activity.headers.get("x-roundhouse-attempt-id")).toBe(assignment.id);
    expect(activity.headers.get("x-roundhouse-attempt-capability")).toBe(
      "attempt-secret",
    );
    await expect(activity.json()).resolves.toEqual({
      phase: "command_output",
      operation: "pi agent",
      durationMs: 30_000,
      stdoutBytes: 128,
      stderrBytes: 0,
    });

    const completion = completionRequest(
      assignment,
      {
        repositoryId: "repo-id",
        repository: "v2-run-1",
        baseCommit: assignment.baseCommit,
        inputHead: assignment.expectedHead,
        outputHead: "b".repeat(40),
        ref: "refs/heads/roundhouse/run_1",
        changedPaths: ["src/fix.ts"],
      },
      "https://v2.invalid/attempts/callback",
      "attempt-secret",
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    expect(completion.signal.aborted).toBe(false);
  });

  it("checkpoints the implementation and promotes it from a clean clone", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.ROUNDHOUSE_WORKSPACE_ROOT = resolve(testRoot, "runner");
    const source = resolve(testRoot, "fake-github"),
      remote = resolve(testRoot, "artifact.git"),
      githubRemote = resolve(testRoot, "github.git");
    await mkdir(source, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: source });
    await writeFile(resolve(source, "README.md"), "fake GitHub baseline\n");
    execFileSync("git", ["add", "README.md"], { cwd: source });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@invalid",
        "commit",
        "-m",
        "baseline",
      ],
      {
        cwd: source,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
          GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
        },
      },
    );
    const baseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: source,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["clone", "--bare", source, remote]);
    execFileSync("git", ["clone", "--bare", source, githubRemote]);
    const assignment = {
      id: "run_git_rev_1",
      runId: "run_git",
      runRevision: 1,
      issueNumber: 42,
      deadlineAt: Date.now() + 60_000,
      baseCommit,
      expectedHead: baseCommit,
      protectedPaths: [".github/workflows"],
      artifact: {
        repositoryId: "artifact-repo-id",
        repository: "v2-run-git",
        remote,
        tokenId: "write-token-id",
        token: "ephemeral-write-token",
        access: "write",
        ref: "refs/heads/roundhouse/run_git",
      },
    };
    const firstDirectory = await prepareWorkspace(assignment);
    await writeFile(
      resolve(firstDirectory, "README.md"),
      "fake GitHub baseline\nimplemented change\n",
    );
    const checkpointProgress = [];
    const first = await checkpointWorkspace(
      assignment,
      firstDirectory,
      async (progress) => checkpointProgress.push(progress),
    );
    const replacementDirectory = await prepareWorkspace(assignment);
    await writeFile(
      resolve(replacementDirectory, "README.md"),
      "fake GitHub baseline\nimplemented change\n",
    );
    const replacement = await checkpointWorkspace(
      assignment,
      replacementDirectory,
    );
    expect(replacement).toEqual(first);
    expect(first.inputHead).toBe(baseCommit);
    expect(first.outputHead).toMatch(/^[a-f0-9]{40}$/);
    expect(first.changedPaths).toEqual(["README.md"]);
    expect(checkpointProgress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "command_started",
          operation: "git add",
        }),
        expect.objectContaining({
          phase: "command_completed",
          operation: "git push",
          exitCode: 0,
        }),
      ]),
    );
    const entries = log.mock.calls.map(([entry]) => JSON.parse(entry));
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "runner_command_started",
          operation: "git clone",
        }),
        expect.objectContaining({
          message: "runner_command_completed",
          operation: "git push",
          exitCode: 0,
        }),
      ]),
    );
    expect(JSON.stringify(entries)).not.toContain("ephemeral-write-token");
    const unchangedDirectory = await prepareWorkspace(assignment);
    await expect(
      checkpointWorkspace(assignment, unchangedDirectory),
    ).resolves.toEqual({
      repositoryId: assignment.artifact.repositoryId,
      repository: assignment.artifact.repository,
      baseCommit: assignment.baseCommit,
      inputHead: assignment.expectedHead,
      outputHead: assignment.expectedHead,
      ref: assignment.artifact.ref,
      changedPaths: [],
    });
    const validationAssignment = {
      ...assignment,
      checkpoint: first,
      artifact: { ...assignment.artifact, access: "read" },
      publish: {
        remote: githubRemote,
        hostname: "github.invalid",
        token: "github-installation-token",
        ref: "refs/heads/roundhouse/issue-42",
      },
    };
    await expect(
      validateCheckpoint({
        ...validationAssignment,
        id: "run_git_rev_1_missing_profile_validation",
      }),
    ).rejects.toThrow("invalid_profile_snapshot");
    await expect(
      validateCheckpoint({
        ...validationAssignment,
        id: "run_git_rev_1_literal_validation",
        profile: {
          paths: { allowed: ["**"], protected: ["README.md"] },
        },
      }),
    ).rejects.toThrow("protected_path_changed");
    await expect(
      validateCheckpoint({
        ...validationAssignment,
        id: "run_git_rev_1_validation",
        profile: {
          paths: {
            allowed: ["**"],
            protected: [".github/workflows/**"],
          },
        },
      }),
    ).resolves.toBeUndefined();
    expect(
      execFileSync(
        "git",
        ["--git-dir", githubRemote, "rev-parse", "roundhouse/issue-42"],
        { encoding: "utf8" },
      ).trim(),
    ).toBe(first.outputHead);
  });

  it("derives literal changed paths without Git quoting", async () => {
    const source = resolve(testRoot, "quoted-paths");
    await mkdir(resolve(source, ".github", "workflows"), { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: source });
    await writeFile(resolve(source, "README.md"), "base\n");
    execFileSync("git", ["add", "README.md"], { cwd: source });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@invalid",
        "commit",
        "-m",
        "base",
      ],
      { cwd: source },
    );
    const base = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: source,
      encoding: "utf8",
    }).trim();
    await writeFile(resolve(source, ".github", "workflows", "é.yml"), "x\n");
    execFileSync("git", ["add", "--all"], { cwd: source });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@invalid",
        "commit",
        "-m",
        "unicode path",
      ],
      { cwd: source },
    );
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: source,
      encoding: "utf8",
    }).trim();

    await expect(repositoryChangedPaths(source, base, head)).resolves.toEqual([
      ".github/workflows/é.yml",
    ]);
  });

  it("prepares a conflicted base update for the implementation agent", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.ROUNDHOUSE_WORKSPACE_ROOT = resolve(testRoot, "runner");
    const source = resolve(testRoot, "source");
    const artifact = resolve(testRoot, "artifact.git");
    await mkdir(source, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: source });
    await writeFile(
      resolve(source, "route.ts"),
      "export const route = 'base';\n",
    );
    execFileSync("git", ["add", "route.ts"], { cwd: source });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@invalid",
        "commit",
        "-m",
        "base",
      ],
      { cwd: source },
    );
    const baseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: source,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["clone", "--bare", source, artifact]);

    await writeFile(
      resolve(source, "route.ts"),
      "export const route = 'main';\n",
    );
    execFileSync("git", ["add", "route.ts"], { cwd: source });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@invalid",
        "commit",
        "-m",
        "main change",
      ],
      { cwd: source },
    );
    const mainHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: source,
      encoding: "utf8",
    }).trim();

    execFileSync("git", ["checkout", "--detach", baseCommit], { cwd: source });
    await writeFile(
      resolve(source, "route.ts"),
      "export const route = 'feature';\n",
    );
    execFileSync("git", ["add", "route.ts"], { cwd: source });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@invalid",
        "commit",
        "-m",
        "feature change",
      ],
      { cwd: source },
    );
    const featureHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: source,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["push", artifact, `HEAD:refs/heads/feature`], {
      cwd: source,
    });

    const assignment = {
      id: "run_conflict_rev_1",
      runId: "run_conflict",
      runRevision: 1,
      issueNumber: 42,
      deadlineAt: Date.now() + 60_000,
      baseCommit,
      expectedHead: featureHead,
      context: { ci: { status: "failure", reason: "base_conflict" } },
      upstream: { remote: source, hostname: "github.test", branch: "main" },
      artifact: {
        repositoryId: "artifact-repo-id",
        repository: "v2-run-conflict",
        remote: artifact,
        tokenId: "write-token-id",
        token: "ephemeral-write-token",
        access: "write",
        ref: "refs/heads/feature",
      },
    };
    const directory = await prepareWorkspace(assignment);
    expect(
      execFileSync("git", ["diff", "--name-only", "--diff-filter=U"], {
        cwd: directory,
        encoding: "utf8",
      }).trim(),
    ).toBe("route.ts");
    await writeFile(
      resolve(directory, "route.ts"),
      "export const route = 'main-and-feature';\n",
    );
    const checkpoint = await checkpointWorkspace(assignment, directory);
    const parents = execFileSync(
      "git",
      ["show", "--format=%P", "--no-patch", checkpoint.outputHead],
      { cwd: directory, encoding: "utf8" },
    )
      .trim()
      .split(" ");
    expect(parents).toEqual([featureHead, mainHead]);
  });
});
