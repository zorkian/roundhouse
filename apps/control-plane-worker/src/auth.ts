// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import type { ControlPlaneEnv } from "./environment.js";

export type AuthorizationDecision =
  { authorized: true; actorId: string } | { authorized: false };

export interface RequestAuthorizer {
  authorize(
    request: Request,
    env: ControlPlaneEnv,
  ): Promise<AuthorizationDecision>;
}

export class LocalBearerAuthorizer implements RequestAuthorizer {
  async authorize(
    request: Request,
    env: ControlPlaneEnv,
  ): Promise<AuthorizationDecision> {
    const expected = env.LOCAL_API_TOKEN;
    const actual = request.headers.get("authorization");
    if (!expected || actual !== `Bearer ${expected}`)
      return { authorized: false };
    return { authorized: true, actorId: "local-control-plane-operator" };
  }
}

export class AccessJwtAuthorizer implements RequestAuthorizer {
  private remoteKeys?: JWTVerifyGetKey;

  constructor(private readonly keys?: JWTVerifyGetKey) {}

  async authorize(
    request: Request,
    env: ControlPlaneEnv,
  ): Promise<AuthorizationDecision> {
    const team = env.ACCESS_TEAM_DOMAIN;
    const audience = env.ACCESS_POLICY_AUD;
    if (!team || !/^[a-zA-Z0-9-]+$/.test(team) || !audience)
      return { authorized: false };
    const token = request.headers.get("cf-access-jwt-assertion");
    if (!token) return { authorized: false };
    const issuer = `https://${team}.cloudflareaccess.com`;
    try {
      this.remoteKeys ??= createRemoteJWKSet(
        new URL(`${issuer}/cdn-cgi/access/certs`),
      );
      const verified = await jwtVerify(token, this.keys ?? this.remoteKeys, {
        issuer,
        audience,
      });
      if (verified.payload.type !== "app") return { authorized: false };
      const actor =
        typeof verified.payload.email === "string"
          ? verified.payload.email
          : typeof verified.payload.common_name === "string"
            ? verified.payload.common_name
            : undefined;
      return actor
        ? { authorized: true, actorId: actor }
        : { authorized: false };
    } catch {
      return { authorized: false };
    }
  }
}

export class ConfiguredAuthorizer implements RequestAuthorizer {
  constructor(
    private readonly local = new LocalBearerAuthorizer(),
    private readonly access = new AccessJwtAuthorizer(),
  ) {}

  authorize(
    request: Request,
    env: ControlPlaneEnv,
  ): Promise<AuthorizationDecision> {
    return env.AUTH_MODE === "access"
      ? this.access.authorize(request, env)
      : this.local.authorize(request, env);
  }
}
