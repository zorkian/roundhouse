// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { AccessJwtAuthorizer } from "./auth.js";
import type { ControlPlaneEnv } from "./environment.js";

const issuer = "https://roundhouse-test.cloudflareaccess.com";
const audience = "roundhouse-test-audience";

async function fixture(): Promise<{
  authorizer: AccessJwtAuthorizer;
  privateKey: CryptoKey;
  env: ControlPlaneEnv;
}> {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(pair.publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: "test-key" }] });
  return {
    authorizer: new AccessJwtAuthorizer(keys),
    privateKey: pair.privateKey,
    env: {
      AUTH_MODE: "access",
      ACCESS_TEAM_DOMAIN: "roundhouse-test",
      ACCESS_POLICY_AUD: audience,
    } as ControlPlaneEnv,
  };
}

async function token(
  privateKey: CryptoKey,
  claims: Record<string, unknown> = {},
): Promise<string> {
  return new SignJWT({
    type: "app",
    email: "operator@example.invalid",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

function request(jwt?: string): Request {
  return new Request("https://roundhouse-dev.rm-rf.rip/v1/runs", {
    headers: jwt ? { "cf-access-jwt-assertion": jwt } : {},
  });
}

describe("AccessJwtAuthorizer", () => {
  it("accepts a signed application token for the exact issuer and audience", async () => {
    const value = await fixture();
    await expect(
      value.authorizer.authorize(
        request(await token(value.privateKey)),
        value.env,
      ),
    ).resolves.toEqual({
      authorized: true,
      actorId: "operator@example.invalid",
    });
  });

  it("accepts a service-token common name as the actor", async () => {
    const value = await fixture();
    await expect(
      value.authorizer.authorize(
        request(
          await token(value.privateKey, {
            email: undefined,
            common_name: "roundhouse-dev-smoke.access",
          }),
        ),
        value.env,
      ),
    ).resolves.toEqual({
      authorized: true,
      actorId: "roundhouse-dev-smoke.access",
    });
  });

  it("rejects missing, wrong-audience, and non-application tokens", async () => {
    const value = await fixture();
    await expect(
      value.authorizer.authorize(request(), value.env),
    ).resolves.toEqual({
      authorized: false,
    });
    const wrongAudienceEnv = {
      ...value.env,
      ACCESS_POLICY_AUD: "different-audience",
    };
    await expect(
      value.authorizer.authorize(
        request(await token(value.privateKey)),
        wrongAudienceEnv,
      ),
    ).resolves.toEqual({ authorized: false });
    await expect(
      value.authorizer.authorize(
        request(await token(value.privateKey, { type: "org" })),
        value.env,
      ),
    ).resolves.toEqual({ authorized: false });
  });
});
