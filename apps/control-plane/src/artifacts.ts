// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { assertPathAllowed, type AppliedProfile } from "@roundhouse/core";
import { observeResponse } from "@roundhouse/response-observer";

export type ArtifactAccess = "read" | "write";

export interface ArtifactToken {
  readonly id: string;
  readonly plaintext: string;
  readonly access: ArtifactAccess;
  readonly expiresAt: number;
}

export interface ArtifactRepository {
  readonly id: string;
  readonly name: string;
  readonly remote: string;
  readonly hostname: string;
  readonly empty: boolean;
  createToken(
    access: ArtifactAccess,
    ttlSeconds: number,
  ): Promise<ArtifactToken>;
  revokeToken(id: string): Promise<void>;
  revokeActiveTokens(): Promise<void>;
}

export interface ArtifactsNamespace {
  ensure(name: string): Promise<ArtifactRepository>;
  get(name: string): Promise<ArtifactRepository | undefined>;
  delete(name: string): Promise<void>;
}

function isArtifactsError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function artifactsErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") return { error: String(error) };
  const value = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    numericCode?: unknown;
  };
  return {
    errorName: String(value.name ?? "Error"),
    error: String(value.message ?? error),
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(typeof value.numericCode === "number"
      ? { numericCode: value.numericCode }
      : {}),
  };
}

export interface ArtifactLocation {
  readonly namespace: string;
  readonly remoteOrigin: string;
}

export function artifactIdentity(name: string, location: ArtifactLocation) {
  const path = `/git/${encodeURIComponent(location.namespace)}/${encodeURIComponent(name)}.git`;
  const remote = new URL(path, location.remoteOrigin).toString();
  return {
    id: `artifacts:${location.namespace}/${name}`,
    name,
    remote,
    hostname: new URL(remote).hostname,
  };
}

class CloudflareArtifactRepository implements ArtifactRepository {
  readonly id: string;
  readonly name: string;
  readonly remote: string;
  readonly hostname: string;
  readonly empty: boolean;

  constructor(
    private readonly repository: ArtifactsRepo,
    name: string,
    location: ArtifactLocation,
    empty: boolean,
  ) {
    const identity = artifactIdentity(name, location);
    this.id = identity.id;
    this.name = identity.name;
    this.remote = identity.remote;
    this.hostname = identity.hostname;
    this.empty = empty;
    console.log(
      JSON.stringify({
        message: "artifact_repository_state",
        repository: name,
        empty: this.empty,
      }),
    );
  }

  async createToken(access: ArtifactAccess, ttlSeconds: number) {
    const token = await this.repository.createToken(access, ttlSeconds);
    return {
      id: token.id,
      plaintext: token.plaintext,
      access: token.scope,
      expiresAt: Date.parse(token.expiresAt),
    };
  }

  async revokeToken(id: string): Promise<void> {
    await this.repository.revokeToken(id);
  }

  async revokeActiveTokens(): Promise<void> {
    const { tokens } = await this.repository.listTokens();
    await Promise.all(
      tokens
        .filter((token) => token.state === "active")
        .map((token) => this.repository.revokeToken(token.id)),
    );
  }
}

export class CloudflareArtifactsNamespace implements ArtifactsNamespace {
  constructor(
    private readonly artifacts: Artifacts,
    private readonly location: ArtifactLocation,
  ) {}

  private async ready(name: string): Promise<ArtifactsRepo> {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        return await this.artifacts.get(name);
      } catch (error) {
        if (!isArtifactsError(error, "IMPORT_IN_PROGRESS")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    throw new Error("artifact_repository_not_ready");
  }

  private async empty(repository: ArtifactsRepo, name: string) {
    const token = await repository.createToken("read", 60);
    const identity = artifactIdentity(name, this.location);
    try {
      const response = await observeResponse(
        await fetch(`${identity.remote}/info/refs?service=git-upload-pack`, {
          headers: { authorization: `Bearer ${token.plaintext}` },
        }),
        { api: "artifacts", operation: "advertise_refs" },
      );
      if (!response.ok)
        throw new Error(`artifact_advertise_refs_http_${response.status}`);
      return !(await response.text()).includes("refs/heads/main");
    } finally {
      await repository.revokeToken(token.id);
    }
  }

  private async wrap(repository: ArtifactsRepo, name: string) {
    return new CloudflareArtifactRepository(
      repository,
      name,
      this.location,
      await this.empty(repository, name),
    );
  }

  async ensure(name: string) {
    const existing = await this.get(name);
    if (existing) return existing;
    try {
      const created = await this.artifacts.create(name, {
        description: "Roundhouse V2 run workspace",
        setDefaultBranch: "main",
      });
      // Creation returns an initial secret. It is never handed to a runner;
      // dispatch issues its own short-lived, purpose-specific token instead.
      const repository = await this.ready(name);
      await repository.revokeToken(created.token);
      return new CloudflareArtifactRepository(
        repository,
        name,
        this.location,
        true,
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "artifact_repository_create_failed",
          repository: name,
          ...artifactsErrorDetails(error),
        }),
      );
      if (!isArtifactsError(error, "ALREADY_EXISTS")) {
        const reconciled = await this.get(name);
        if (reconciled) return reconciled;
        throw error;
      }
      return await this.wrap(await this.ready(name), name);
    }
  }

  async get(name: string): Promise<ArtifactRepository | undefined> {
    try {
      return await this.wrap(await this.ready(name), name);
    } catch (error) {
      if (isArtifactsError(error, "NOT_FOUND")) return undefined;
      throw error;
    }
  }

  async delete(name: string): Promise<void> {
    await this.artifacts.delete(name);
  }
}

export interface Checkpoint {
  readonly repositoryId: string;
  readonly repository: string;
  readonly baseCommit: string;
  readonly inputHead: string;
  readonly outputHead: string;
  readonly ref: string;
  readonly changedPaths: readonly string[];
}

export function validateCheckpointIdentity(
  checkpoint: Checkpoint,
  expected: {
    repositoryId: string;
    repository: string;
    baseCommit: string;
    inputHead: string;
    ref: string;
    profile?: AppliedProfile;
    protectedPaths?: readonly string[];
  },
): void {
  if (
    checkpoint.repositoryId !== expected.repositoryId ||
    checkpoint.repository !== expected.repository
  )
    throw new Error("unexpected_repository");
  if (checkpoint.baseCommit !== expected.baseCommit)
    throw new Error("unexpected_base");
  if (checkpoint.inputHead !== expected.inputHead)
    throw new Error("unexpected_input_head");
  if (checkpoint.ref !== expected.ref) throw new Error("unexpected_ref");
  if (!/^[a-f0-9]{40}$/.test(checkpoint.outputHead))
    throw new Error("invalid_output_head");
  if (expected.profile) {
    for (const path of checkpoint.changedPaths)
      assertPathAllowed(expected.profile, path);
  } else if (
    checkpoint.changedPaths.some((path) =>
      (expected.protectedPaths ?? []).some(
        (protectedPath) =>
          path === protectedPath || path.startsWith(`${protectedPath}/`),
      ),
    )
  ) {
    throw new Error("protected_path_changed");
  }
}

export function validateReadOnlyCheckpoint(checkpoint: Checkpoint): void {
  if (checkpoint.outputHead !== checkpoint.inputHead)
    throw new Error("read_only_head_changed");
  if (checkpoint.changedPaths.length !== 0)
    throw new Error("read_only_paths_changed");
}
