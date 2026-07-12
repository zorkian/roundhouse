// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

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
