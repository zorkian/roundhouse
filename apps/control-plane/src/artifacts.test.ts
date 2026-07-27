// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { parseProfile } from "@roundhouse/core";
import { describe, expect, it, vi } from "vitest";
import {
  artifactIdentity,
  artifactAdvertisementHasMain,
  artifactAdvertisementMainHead,
  CloudflareArtifactsNamespace,
  validateCheckpointIdentity,
  validateReadOnlyCheckpoint,
} from "./artifacts.js";

describe("trusted checkpoint path validation", () => {
  const checkpoint = (changedPaths: string[]) => ({
    repositoryId: "artifact-repo-id",
    repository: "v2-run-1",
    baseCommit: "a".repeat(40),
    inputHead: "a".repeat(40),
    outputHead: "b".repeat(40),
    ref: "refs/heads/roundhouse/run-1",
    changedPaths,
  });
  const identity = {
    repositoryId: "artifact-repo-id",
    repository: "v2-run-1",
    baseCommit: "a".repeat(40),
    inputHead: "a".repeat(40),
    ref: "refs/heads/roundhouse/run-1",
  };

  it("applies the explicit allowed and protected path policy", async () => {
    const profile = await parseProfile(
      'version: 1\npaths:\n  allowed: ["**"]\n  protected: [".github/workflows/**"]\n',
      "a".repeat(40),
    );
    expect(() =>
      validateCheckpointIdentity(checkpoint(["src/fix.ts"]), {
        ...identity,
        profile,
      }),
    ).not.toThrow();
    expect(() =>
      validateCheckpointIdentity(checkpoint([".github/workflows/ci.yml"]), {
        ...identity,
        profile,
      }),
    ).toThrow("protected_path_changed");
    expect(() =>
      validateCheckpointIdentity(checkpoint([".roundhouse/profile.yaml"]), {
        ...identity,
        profile,
      }),
    ).toThrow("protected_path_changed");
  });

  it("leaves trusted integration path validation to exact Git validation", async () => {
    const profile = await parseProfile(
      'version: 1\npaths:\n  allowed: ["src/**"]\n  protected: [".roundhouse/**"]\n',
      "a".repeat(40),
    );

    expect(() =>
      validateCheckpointIdentity(
        checkpoint([".roundhouse/workflow.yaml", "README.md"]),
        {
          ...identity,
          profile,
          enforcePathPolicy: false,
        },
      ),
    ).not.toThrow();
  });
});

it("accepts only unchanged checkpoints from read-only attempts", () => {
  const checkpoint = {
    repositoryId: "artifact-repo-id",
    repository: "v2-run-1",
    baseCommit: "a".repeat(40),
    inputHead: "b".repeat(40),
    outputHead: "b".repeat(40),
    ref: "refs/heads/roundhouse/run-1",
    changedPaths: [],
  };

  expect(() => validateReadOnlyCheckpoint(checkpoint)).not.toThrow();
  expect(() =>
    validateReadOnlyCheckpoint({
      ...checkpoint,
      outputHead: "c".repeat(40),
    }),
  ).toThrow("read_only_head_changed");
  expect(() =>
    validateReadOnlyCheckpoint({
      ...checkpoint,
      changedPaths: ["README.md"],
    }),
  ).toThrow("read_only_paths_changed");
});

describe("Artifacts workspace contract", () => {
  it("creates an empty workspace and revokes its initial secret", async () => {
    let createInput:
      { name: string; opts?: Parameters<Artifacts["create"]>[1] } | undefined;
    let revoked: string | undefined;
    let created = false;
    const repo = {
      lastPushAt: "2026-07-20T00:00:00Z",
      source: "unexpected-binding-metadata",
      revokeToken: async (token: string) => {
        revoked = token;
        return true;
      },
    } as unknown as ArtifactsRepo;
    const binding = {
      get: async () => {
        if (!created)
          throw Object.assign(new Error("missing"), { code: "NOT_FOUND" });
        return repo;
      },
      create: async (
        name: string,
        opts?: Parameters<Artifacts["create"]>[1],
      ) => {
        createInput = { name, opts };
        created = true;
        return { token: "bootstrap" };
      },
    } as unknown as Artifacts;
    const workspace = await new CloudflareArtifactsNamespace(binding, {
      namespace: "development",
      remoteOrigin: "https://account.artifacts.cloudflare.net",
    }).ensure("run_1");
    expect(createInput).toEqual({
      name: "run_1",
      opts: {
        description: "Roundhouse V2 run workspace",
        setDefaultBranch: "main",
      },
    });
    expect(revoked).toBe("bootstrap");
    expect(workspace.empty).toBe(true);
  });

  it.each([
    [
      `001e# service=git-upload-pack\n0000013d${"0".repeat(40)} capabilities^{}\0agent=gitty/1.0 symref=HEAD:refs/heads/main\n0000`,
      true,
    ],
    [`0044${"a".repeat(40)} refs/heads/main\n0000`, false],
  ])(
    "reads workspace initialization from its advertised refs",
    async (body, empty) => {
      let revoked: string | undefined;
      const repo = {
        createToken: async () => ({ id: "probe", plaintext: "secret" }),
        revokeToken: async (id: string) => {
          revoked = id;
          return true;
        },
      } as unknown as ArtifactsRepo;
      const binding = {
        get: async () => repo,
      } as unknown as Artifacts;
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(body, { status: 200 }));

      const workspace = await new CloudflareArtifactsNamespace(binding, {
        namespace: "development",
        remoteOrigin: "https://account.artifacts.cloudflare.net",
      }).get("run_1");

      expect(workspace?.empty).toBe(empty);
      expect(workspace?.head).toBe(empty ? undefined : "a".repeat(40));
      expect(fetch).toHaveBeenCalledWith(
        "https://account.artifacts.cloudflare.net/git/development/run_1.git/info/refs?service=git-upload-pack",
        { headers: { authorization: "Bearer secret" } },
      );
      expect(revoked).toBe("probe");
      fetch.mockRestore();
    },
  );

  it("requires an object behind the advertised main ref", () => {
    expect(
      artifactAdvertisementHasMain(`${"0".repeat(40)} refs/heads/main\n`),
    ).toBe(false);
    expect(
      artifactAdvertisementHasMain(`${"a".repeat(40)} refs/heads/main\n`),
    ).toBe(true);
    expect(
      artifactAdvertisementMainHead(`${"b".repeat(40)} refs/heads/main\n0000`),
    ).toBe("b".repeat(40));
  });

  it("derives one stable repository identity from its configured namespace", () => {
    expect(
      artifactIdentity("run_1", {
        namespace: "roundhouse-v2-development",
        remoteOrigin: "https://account.artifacts.cloudflare.net",
      }),
    ).toEqual({
      id: "artifacts:roundhouse-v2-development/run_1",
      name: "run_1",
      remote:
        "https://account.artifacts.cloudflare.net/git/roundhouse-v2-development/run_1.git",
      hostname: "account.artifacts.cloudflare.net",
    });
  });
});
