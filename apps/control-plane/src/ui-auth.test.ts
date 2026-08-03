// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import type { D1Like } from "./d1-store.js";
import {
  beginGitHubSignIn,
  decryptUiAccessToken,
  encryptUiAccessToken,
  handleGitHubCallback,
  sessionCookieHeader,
  signOut,
  renderNotFoundPage,
  renderSignInPage,
  uiSessionCookie,
  uiSessionLifetimeMs,
  uiStateCookie,
  uiGitHubPost,
  uiGitHubPostForSessionHash,
  uiSessionHash,
  validateUiSession,
} from "./ui-auth.js";

function html(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// Minimal in-memory D1 stub over the auth/session/enrollment tables.
function authDb(options?: {
  enrolled?: readonly string[];
  sessions?: readonly {
    hash: string;
    expiresAt: number;
    createdAt?: number;
    accessToken?: string | null;
    authorizedAt?: number | null;
  }[];
  // Hook invoked after the session SELECT but before the renewal UPDATE
  // commits, to simulate a concurrent write landing in between.
  beforeRenewalCommit?: (hash: string) => void;
  // Hook invoked after the session SELECT observes an expired row but before
  // the conditional cleanup delete commits, to simulate a concurrent
  // renewal landing in between.
  beforeExpiredCleanup?: (hash: string) => void;
}) {
  const states = new Map<string, { expiresAt: number; cookieHash: string }>();
  const sessions = new Map(
    (options?.sessions ?? []).map((session) => [
      session.hash,
      {
        github_user_id: 7,
        github_login: "octocat",
        repository_ids_json: '["1297678423"]',
        expires_at: session.expiresAt,
        created_at: session.createdAt ?? Date.now(),
        github_access_token:
          session.accessToken === undefined
            ? ENCRYPTED_USER_TOKEN
            : session.accessToken,
        authorized_at:
          session.authorizedAt === undefined
            ? (session.createdAt ?? Date.now())
            : session.authorizedAt,
      },
    ]),
  );
  const db: D1Like = {
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind: (...bound: unknown[]) => {
          values = bound;
          return statement;
        },
        first: async () => {
          if (sql.includes("FROM ui_auth_states")) {
            const state = states.get(String(values[0]));
            return state === undefined
              ? null
              : {
                  expires_at: state.expiresAt,
                  state_cookie_hash: state.cookieHash,
                };
          }
          if (sql.includes("UPDATE ui_sessions SET expires_at")) {
            // Mirrors UPDATE ... MAX() ... RETURNING: apply any concurrent
            // write that landed after our SELECT, keep the later deadline,
            // and return the actual persisted expiration.
            const hash = String(values[3]);
            options?.beforeRenewalCommit?.(hash);
            const session = sessions.get(hash);
            if (!session) return null;
            session.expires_at = Math.max(
              session.expires_at,
              Number(values[0]),
            );
            session.repository_ids_json = String(values[1]);
            session.authorized_at = Number(values[2]);
            return { expires_at: session.expires_at };
          }
          if (sql.includes("FROM ui_sessions")) {
            return sessions.get(String(values[0])) ?? null;
          }
          return null;
        },
        all: async () => {
          if (sql.includes("FROM repositories"))
            return {
              meta: {},
              results: (options?.enrolled ?? ["1297678423"]).map((id) => ({
                github_id: id,
              })),
            };
          return { meta: {}, results: [] };
        },
        run: async () => {
          if (sql.includes("INSERT INTO ui_auth_states"))
            states.set(String(values[0]), {
              cookieHash: String(values[1]),
              expiresAt: Number(values[2]),
            });
          if (sql.includes("DELETE FROM ui_auth_states"))
            states.delete(String(values[0]));
          if (sql.includes("INSERT INTO ui_sessions"))
            sessions.set(String(values[0]), {
              github_user_id: Number(values[1]),
              github_login: String(values[2]),
              repository_ids_json: String(values[3]),
              expires_at: Number(values[4]),
              created_at: Number(values[5]),
              github_access_token: String(values[6]),
              authorized_at: Number(values[7]),
            });
          if (sql.includes("DELETE FROM ui_sessions WHERE session_hash")) {
            if (sql.includes("expires_at <= ?2"))
              options?.beforeExpiredCleanup?.(String(values[0]));
            const session = sessions.get(String(values[0]));
            if (
              session &&
              (!sql.includes("expires_at <= ?2") ||
                session.expires_at <= Number(values[1]))
            )
              sessions.delete(String(values[0]));
          }
          return { meta: { changes: 1 } };
        },
      };
      return statement as unknown as ReturnType<D1Like["prepare"]>;
    },
  };
  return { db, states, sessions };
}

function callbackRequest(url: string, start?: Response): Request {
  const cookie = start?.headers.get("set-cookie")?.split(";")[0] ?? "";
  return new Request(url, cookie ? { headers: { cookie } } : {});
}

// Sessions store the GitHub access token encrypted under the client
// secret, so seeded stub sessions use an encrypted default token.
const ENCRYPTED_USER_TOKEN = await encryptUiAccessToken(
  "user-token",
  "client-secret",
);

const env = (db: D1Like) => ({
  DB: db,
  PUBLIC_ORIGIN: "https://v2.invalid",
  GITHUB_CLIENT_ID: "client-id",
  ROUNDHOUSE_GITHUB_CLIENT_SECRET: "client-secret",
});

describe("trusted UI GitHub mutations", () => {
  it("uses the encrypted session token only for allowlisted issue writes", async () => {
    const token = "session-token";
    const { db } = authDb({
      sessions: [
        {
          hash: await sha256Hex(token),
          expiresAt: Date.now() + 60_000,
        },
      ],
    });
    const send = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer user-token",
        );
        return Response.json({ number: 42 });
      },
    );
    vi.stubGlobal("fetch", send);
    const session = {
      githubUserId: 7,
      githubLogin: "octocat",
      repositoryIds: ["1297678423"],
      expiresAt: Date.now() + 60_000,
      sessionToken: token,
    };
    await expect(
      uiGitHubPost(session, env(db), "/repos/octo/project/issues", {
        title: "Build it",
      }),
    ).resolves.toEqual({ number: 42 });
    await expect(
      uiGitHubPost(session, env(db), "/repos/octo/project/pulls", {}),
    ).rejects.toThrow("ui_github_mutation_not_allowed");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("lets durable promotion use only a one-way session reference for issue writes", async () => {
    const token = "durable-session-token";
    const hash = await sha256Hex(token);
    const { db } = authDb({
      sessions: [{ hash, expiresAt: Date.now() + 60_000 }],
    });
    const send = vi.fn(async () => Response.json({ id: 1 }));
    vi.stubGlobal("fetch", send);
    const session = {
      githubUserId: 7,
      githubLogin: "octocat",
      repositoryIds: ["1297678423"],
      expiresAt: Date.now() + 60_000,
      sessionToken: token,
    };
    await expect(uiSessionHash(session)).resolves.toBe(hash);
    await expect(
      uiGitHubPostForSessionHash(
        hash,
        7,
        env(db),
        "/repos/octo/project/issues/42/comments",
        { body: "/roundhouse-dev start" },
      ),
    ).resolves.toEqual({ id: 1 });
    await expect(
      uiGitHubPostForSessionHash(
        hash,
        7,
        env(db),
        "/repos/octo/project/git/refs",
        {},
      ),
    ).rejects.toThrow("ui_github_mutation_not_allowed");
    expect(send).toHaveBeenCalledTimes(1);
  });
});

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stubGitHubOAuth(
  repositories: readonly { id: number }[],
  publicRepository?: { id: number; private: false },
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("login/oauth/access_token"))
        return Response.json({ access_token: "user-token" });
      if (url.includes("api.github.com/user/repos"))
        return Response.json(repositories);
      if (
        publicRepository &&
        url.includes(`api.github.com/repositories/${publicRepository.id}`)
      )
        return Response.json(publicRepository);
      if (url.includes("api.github.com/repositories/"))
        return new Response("not found", { status: 404 });
      if (url.includes("api.github.com/user"))
        return Response.json({ id: 7, login: "octocat" });
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

async function completeGitHubSignIn(db: D1Like): Promise<Response> {
  const start = await beginGitHubSignIn(env(db));
  const state = new URL(start.headers.get("location")!).searchParams.get(
    "state",
  )!;
  return handleGitHubCallback(
    new URL(`https://v2.invalid/auth/github/callback?code=abc&state=${state}`),
    callbackRequest("https://v2.invalid/auth/github/callback", start),
    env(db),
    html,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub UI sign-in", () => {
  it("shows the Development badge on sign-in pages but not on the not-found page", () => {
    for (const page of [renderSignInPage(), renderSignInPage("Try again.")])
      expect(page.match(/class="env-badge"/g)).toHaveLength(1);
    expect(renderNotFoundPage()).not.toContain('class="env-badge"');
  });

  it("redirects to GitHub with a one-time state and no secrets in the URL", async () => {
    const { db, states } = authDb();
    const response = await beginGitHubSignIn(env(db));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://github.com");
    expect(location.pathname).toBe("/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://v2.invalid/auth/github/callback",
    );
    const state = location.searchParams.get("state")!;
    expect(state.length).toBeGreaterThan(20);
    expect(location.searchParams.get("client_secret")).toBeNull();
    expect(states.has(await sha256Hex(state))).toBe(true);
  });

  it("completes the callback, filters enrolled repositories, and issues a session cookie", async () => {
    const { db, states, sessions } = authDb();
    stubGitHubOAuth([{ id: 1297678423 }, { id: 42 }]);
    const response = await completeGitHubSignIn(db);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(`${uiSessionCookie}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    // State is one-time: consumed by the callback.
    expect(states.size).toBe(0);
    // Only the enrolled repository ID was stored, alongside the GitHub
    // access token used to re-resolve authorization when it goes stale.
    const session = [...sessions.values()][0]!;
    expect(session.github_login).toBe("octocat");
    expect(JSON.parse(session.repository_ids_json)).toEqual(["1297678423"]);
    // The bearer token is encrypted at rest; the database never holds the
    // reusable plaintext credential.
    expect(session.github_access_token).not.toContain("user-token");
    expect(
      await decryptUiAccessToken(session.github_access_token!, "client-secret"),
    ).toBe("user-token");
    expect(session.authorized_at).toBeGreaterThan(0);
    // The session and its cookie share a lifetime of at least 30 days.
    expect(session.expires_at - Date.now()).toBeGreaterThanOrEqual(
      30 * 24 * 60 * 60 * 1000 - 60_000,
    );
    const maxAge = Number(cookie.match(/Max-Age=(\d+)/)![1]);
    // Max-Age is rounded up, so the browser lifetime is at least the full
    // 30-day session lifetime regardless of when the header was built
    // relative to the persisted expiration.
    expect(maxAge).toBeGreaterThanOrEqual(uiSessionLifetimeMs / 1000);
    expect(maxAge).toBeGreaterThanOrEqual(30 * 24 * 60 * 60);
    // Rounding up adds less than a second beyond the stored deadline.
    expect(maxAge).toBeLessThanOrEqual(uiSessionLifetimeMs / 1000 + 1);
    // The cookie's absolute Expires deadline matches the stored expiration.
    expect(cookie).toContain(
      `Expires=${new Date(session.expires_at).toUTCString()}`,
    );
    // The access token never appears in the redirect target or the cookie.
    expect(response.headers.get("location")).not.toContain("token");
    expect(cookie).not.toContain("user-token");
  });

  it("includes enrolled public repositories not listed for the user", async () => {
    const { db, sessions } = authDb({
      enrolled: ["1297678423", "555"],
    });
    stubGitHubOAuth([{ id: 1297678423 }], { id: 555, private: false });
    const response = await completeGitHubSignIn(db);
    expect(response.status).toBe(302);
    const session = [...sessions.values()][0]!;
    expect(JSON.parse(session.repository_ids_json).sort()).toEqual([
      "1297678423",
      "555",
    ]);
  });

  it("excludes enrolled private repositories the user cannot read", async () => {
    const { db, sessions } = authDb({ enrolled: ["1297678423", "555"] });
    stubGitHubOAuth([{ id: 1297678423 }]);
    const response = await completeGitHubSignIn(db);
    expect(response.status).toBe(302);
    const session = [...sessions.values()][0]!;
    expect(JSON.parse(session.repository_ids_json)).toEqual(["1297678423"]);
  });

  it("rejects denied, missing, mismatched, and expired callbacks safely", async () => {
    const { db } = authDb();
    const denied = await handleGitHubCallback(
      new URL("https://v2.invalid/auth/github/callback?error=access_denied"),
      callbackRequest("https://v2.invalid/auth/github/callback"),
      env(db),
      html,
    );
    await expect(denied.text()).resolves.toContain("Sign in with GitHub");

    const missing = await handleGitHubCallback(
      new URL("https://v2.invalid/auth/github/callback"),
      callbackRequest("https://v2.invalid/auth/github/callback"),
      env(db),
      html,
    );
    await expect(missing.text()).resolves.toContain("Sign in with GitHub");

    const mismatched = await handleGitHubCallback(
      new URL("https://v2.invalid/auth/github/callback?code=abc&state=nope"),
      callbackRequest("https://v2.invalid/auth/github/callback"),
      env(db),
      html,
    );
    await expect(mismatched.text()).resolves.toContain("expired");
  });

  it("rejects a callback replayed in a browser without the state cookie", async () => {
    const { db, sessions } = authDb();
    const start = await beginGitHubSignIn(env(db));
    const state = new URL(start.headers.get("location")!).searchParams.get(
      "state",
    )!;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ access_token: "user-token" })),
    );
    const callbackUrl = new URL(
      `https://v2.invalid/auth/github/callback?code=abc&state=${state}`,
    );
    // No state cookie at all: a captured callback URL must not create a session.
    const withoutCookie = await handleGitHubCallback(
      callbackUrl,
      callbackRequest("https://v2.invalid/auth/github/callback"),
      env(db),
      html,
    );
    await expect(withoutCookie.text()).resolves.toContain("expired");
    expect(sessions.size).toBe(0);

    // A foreign state cookie must not satisfy a different state record.
    const startAgain = await beginGitHubSignIn(env(db));
    const stateAgain = new URL(
      startAgain.headers.get("location")!,
    ).searchParams.get("state")!;
    const wrongCookie = await handleGitHubCallback(
      new URL(
        `https://v2.invalid/auth/github/callback?code=abc&state=${stateAgain}`,
      ),
      new Request("https://v2.invalid/auth/github/callback", {
        headers: { cookie: `${uiStateCookie}=forged` },
      }),
      env(db),
      html,
    );
    await expect(wrongCookie.text()).resolves.toContain("expired");
    expect(sessions.size).toBe(0);
  });

  it("validates, expires, and signs out sessions", async () => {
    const validToken = "valid-session";
    const expiredToken = "expired-session";
    const { db, sessions } = authDb({
      sessions: [
        { hash: await sha256Hex(validToken), expiresAt: Date.now() + 60_000 },
        { hash: await sha256Hex(expiredToken), expiresAt: Date.now() - 1 },
      ],
    });
    const session = await validateUiSession(
      new Request("https://v2.invalid/", {
        headers: { cookie: `${uiSessionCookie}=${validToken}` },
      }),
      env(db),
    );
    expect(session?.githubLogin).toBe("octocat");
    expect(session?.repositoryIds).toEqual(["1297678423"]);

    await expect(
      validateUiSession(new Request("https://v2.invalid/"), env(db)),
    ).resolves.toBeUndefined();
    await expect(
      validateUiSession(
        new Request("https://v2.invalid/", {
          headers: { cookie: `${uiSessionCookie}=forged` },
        }),
        env(db),
      ),
    ).resolves.toBeUndefined();
    await expect(
      validateUiSession(
        new Request("https://v2.invalid/", {
          headers: { cookie: `${uiSessionCookie}=${expiredToken}` },
        }),
        env(db),
      ),
    ).resolves.toBeUndefined();
    // Expired sessions are removed on validation without renewal.
    expect(sessions.has(await sha256Hex(expiredToken))).toBe(false);

    const out = await signOut(
      new Request("https://v2.invalid/auth/sign-out", {
        headers: { cookie: `${uiSessionCookie}=${validToken}` },
      }),
      env(db),
    );
    expect(out.status).toBe(302);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(sessions.has(await sha256Hex(validToken))).toBe(false);
    await expect(
      validateUiSession(
        new Request("https://v2.invalid/", {
          headers: { cookie: `${uiSessionCookie}=${validToken}` },
        }),
        env(db),
      ),
    ).resolves.toBeUndefined();
  });

  it("renews a valid session's stored and cookie expiration on validation", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const token = "renewable-session";
      const hash = await sha256Hex(token);
      const initialExpiresAt = Date.now() + 60_000;
      const { db, sessions } = authDb({
        sessions: [{ hash, expiresAt: initialExpiresAt }],
      });
      const logs: Record<string, unknown>[] = [];
      const logSpy = vi
        .spyOn(console, "log")
        .mockImplementation((line: unknown) => {
          logs.push(JSON.parse(String(line)) as Record<string, unknown>);
        });
      const session = await validateUiSession(
        new Request("https://v2.invalid/", {
          headers: { cookie: `${uiSessionCookie}=${token}` },
        }),
        env(db),
      );
      expect(session).toBeDefined();
      const expectedExpiresAt = Date.now() + uiSessionLifetimeMs;
      expect(session?.expiresAt).toBe(expectedExpiresAt);
      expect(sessions.get(hash)?.expires_at).toBe(expectedExpiresAt);
      expect(session?.sessionToken).toBe(token);
      // The renewed cookie shares the persisted absolute expiration.
      const renewedCookie = sessionCookieHeader(token, session!.expiresAt);
      expect(renewedCookie).toContain(`${uiSessionCookie}=${token}`);
      expect(renewedCookie).toContain("HttpOnly");
      expect(renewedCookie).toContain("Secure");
      expect(renewedCookie).toContain(
        `Max-Age=${Math.floor(uiSessionLifetimeMs / 1000)}`,
      );
      expect(renewedCookie).toContain(
        `Expires=${new Date(expectedExpiresAt).toUTCString()}`,
      );
      const renewed = logs.find(
        (entry) => entry.message === "ui_session_renewed",
      );
      expect(renewed).toMatchObject({
        outcome: "renewed",
        githubUserId: 7,
        previousExpiresAt: initialExpiresAt,
        expiresAt: expectedExpiresAt,
      });
      expect(typeof renewed?.durationMs).toBe("number");
      logSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renews sessions regardless of age so active users stay signed in", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
      const token = "active-session";
      const hash = await sha256Hex(token);
      // Signed in 31 days ago but still within its sliding expiration: each
      // valid visit renews for a full lifetime from that activity.
      const createdAt = Date.now() - 31 * 24 * 60 * 60 * 1000;
      const { db, sessions } = authDb({
        sessions: [
          {
            hash,
            expiresAt: Date.now() + 60_000,
            createdAt,
            // Repository authorization was re-resolved recently, so no
            // GitHub recheck is needed for this renewal.
            authorizedAt: Date.now() - 60_000,
          },
        ],
      });
      const session = await validateUiSession(
        new Request("https://v2.invalid/", {
          headers: { cookie: `${uiSessionCookie}=${token}` },
        }),
        env(db),
      );
      const expectedExpiresAt = Date.now() + uiSessionLifetimeMs;
      expect(session?.expiresAt).toBe(expectedExpiresAt);
      expect(sessions.get(hash)?.expires_at).toBe(expectedExpiresAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-resolves repository authorization against GitHub once the snapshot is stale", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const token = "stale-authorization-session";
      const hash = await sha256Hex(token);
      const authorizedAt = Date.now() - 9 * 60 * 60 * 1000;
      const { db, sessions } = authDb({
        sessions: [{ hash, expiresAt: Date.now() + 60_000, authorizedAt }],
      });
      stubGitHubOAuth([{ id: 1297678423 }, { id: 42 }]);
      const logs: Record<string, unknown>[] = [];
      const logSpy = vi
        .spyOn(console, "log")
        .mockImplementation((line: unknown) => {
          logs.push(JSON.parse(String(line)) as Record<string, unknown>);
        });
      const session = await validateUiSession(
        new Request("https://v2.invalid/", {
          headers: { cookie: `${uiSessionCookie}=${token}` },
        }),
        env(db),
      );
      expect(session).toBeDefined();
      expect(session?.repositoryIds).toEqual(["1297678423"]);
      const stored = sessions.get(hash)!;
      expect(JSON.parse(stored.repository_ids_json)).toEqual(["1297678423"]);
      expect(stored.authorized_at).toBe(Date.now());
      expect(stored.expires_at).toBe(Date.now() + uiSessionLifetimeMs);
      const reauthorized = logs.find(
        (entry) => entry.message === "ui_session_reauthorized",
      );
      expect(reauthorized).toMatchObject({
        outcome: "refreshed",
        githubUserId: 7,
        previousAuthorizedAt: authorizedAt,
        authorizedAt: Date.now(),
        authorizedRepositories: 1,
      });
      expect(typeof reauthorized?.durationMs).toBe("number");
      logSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops revoked access when reauthorization re-resolves permissions", async () => {
    const token = "revoked-repository-session";
    const hash = await sha256Hex(token);
    const { db, sessions } = authDb({
      sessions: [
        {
          hash,
          expiresAt: Date.now() + 60_000,
          authorizedAt: Date.now() - 9 * 60 * 60 * 1000,
        },
      ],
    });
    // The user can no longer read the enrolled repository.
    stubGitHubOAuth([{ id: 42 }]);
    const session = await validateUiSession(
      new Request("https://v2.invalid/", {
        headers: { cookie: `${uiSessionCookie}=${token}` },
      }),
      env(db),
    );
    expect(session?.repositoryIds).toEqual([]);
    expect(JSON.parse(sessions.get(hash)!.repository_ids_json)).toEqual([]);
    expect(sessions.get(hash)!.expires_at).toBeGreaterThan(Date.now());
  });

  it("ends the session when reauthorization fails against GitHub", async () => {
    const token = "revoked-token-session";
    const hash = await sha256Hex(token);
    const { db, sessions } = authDb({
      sessions: [
        {
          hash,
          expiresAt: Date.now() + 60_000,
          authorizedAt: Date.now() - 9 * 60 * 60 * 1000,
        },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad credentials", { status: 401 })),
    );
    const logs: Record<string, unknown>[] = [];
    const logSpy = vi
      .spyOn(console, "log")
      .mockImplementation((line: unknown) => {
        logs.push(JSON.parse(String(line)) as Record<string, unknown>);
      });
    const session = await validateUiSession(
      new Request("https://v2.invalid/", {
        headers: { cookie: `${uiSessionCookie}=${token}` },
      }),
      env(db),
    );
    // The session is rejected and deleted rather than renewed on stale,
    // unverifiable authorization.
    expect(session).toBeUndefined();
    expect(sessions.has(hash)).toBe(false);
    expect(
      logs.find((entry) => entry.message === "ui_session_reauthorized"),
    ).toMatchObject({ outcome: "failed", githubUserId: 7 });
    logSpy.mockRestore();
  });

  it("requires reauthentication when a stale session has no stored GitHub token", async () => {
    const token = "legacy-session";
    const hash = await sha256Hex(token);
    const { db, sessions } = authDb({
      sessions: [
        {
          hash,
          expiresAt: Date.now() + 60_000,
          accessToken: null,
          authorizedAt: Date.now() - 9 * 60 * 60 * 1000,
        },
      ],
    });
    const session = await validateUiSession(
      new Request("https://v2.invalid/", {
        headers: { cookie: `${uiSessionCookie}=${token}` },
      }),
      env(db),
    );
    expect(session).toBeUndefined();
    expect(sessions.has(hash)).toBe(false);
  });

  it("requires reauthentication when a stale session holds an undecryptable token", async () => {
    const token = "plaintext-token-session";
    const hash = await sha256Hex(token);
    const { db, sessions } = authDb({
      sessions: [
        {
          hash,
          expiresAt: Date.now() + 60_000,
          // A legacy or tampered row whose stored token is not a ciphertext
          // produced by this deployment cannot be used for reauthorization.
          accessToken: "user-token",
          authorizedAt: Date.now() - 9 * 60 * 60 * 1000,
        },
      ],
    });
    const logs: Record<string, unknown>[] = [];
    const logSpy = vi
      .spyOn(console, "log")
      .mockImplementation((line: unknown) => {
        logs.push(JSON.parse(String(line)) as Record<string, unknown>);
      });
    const session = await validateUiSession(
      new Request("https://v2.invalid/", {
        headers: { cookie: `${uiSessionCookie}=${token}` },
      }),
      env(db),
    );
    expect(session).toBeUndefined();
    expect(sessions.has(hash)).toBe(false);
    expect(
      logs.find((entry) => entry.message === "ui_session_reauthorized"),
    ).toMatchObject({ outcome: "reauthentication_required", githubUserId: 7 });
    logSpy.mockRestore();
  });

  it("keeps the later expiration when renewals overlap", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const token = "concurrent-session";
      const hash = await sha256Hex(token);
      const { db, sessions } = authDb({
        sessions: [{ hash, expiresAt: Date.now() + 60_000 }],
      });
      const newer = await validateUiSession(
        new Request("https://v2.invalid/", {
          headers: { cookie: `${uiSessionCookie}=${token}` },
        }),
        env(db),
      );
      expect(newer?.expiresAt).toBe(Date.now() + uiSessionLifetimeMs);
      // A second request starting later must not shorten the deadline, and
      // an already-persisted later expiration is preserved and returned.
      sessions.get(hash)!.expires_at = Date.now() + 90 * 24 * 60 * 60 * 1000;
      const request = new Request("https://v2.invalid/", {
        headers: { cookie: `${uiSessionCookie}=${token}` },
      });
      const session = await validateUiSession(request, env(db));
      const preserved = Date.now() + 90 * 24 * 60 * 60 * 1000;
      expect(session?.expiresAt).toBe(preserved);
      expect(sessions.get(hash)?.expires_at).toBe(preserved);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the expiration from the atomic update when a concurrent write lands after the SELECT", async () => {
    const token = "valid-token";
    const hash = await sha256Hex(token);
    vi.useFakeTimers();
    try {
      const { db, sessions } = authDb({
        sessions: [{ hash, expiresAt: Date.now() + 60_000 }],
        // Simulate a concurrent request extending the same session after
        // this request's SELECT but before its UPDATE commits.
        beforeRenewalCommit: (updatedHash) => {
          sessions.get(updatedHash)!.expires_at =
            Date.now() + 60 * 24 * 60 * 60 * 1000;
        },
      });
      const session = await validateUiSession(
        new Request("https://v2.invalid/", {
          headers: { cookie: `${uiSessionCookie}=${token}` },
        }),
        env(db),
      );
      // The cookie expiration must match the actual persisted deadline
      // (the concurrent writer's later value), not the stale local one.
      const persisted = Date.now() + 60 * 24 * 60 * 60 * 1000;
      expect(session?.expiresAt).toBe(persisted);
      expect(sessions.get(hash)?.expires_at).toBe(persisted);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects validation when the session is deleted between SELECT and UPDATE", async () => {
    const token = "deleted-token";
    const hash = await sha256Hex(token);
    const { db, sessions } = authDb({
      sessions: [{ hash, expiresAt: Date.now() + 60_000 }],
      // Simulate a concurrent sign-out deleting the row after this
      // request's SELECT but before its renewal UPDATE commits.
      beforeRenewalCommit: (updatedHash) => {
        sessions.delete(updatedHash);
      },
    });
    const session = await validateUiSession(
      new Request("https://v2.invalid/", {
        headers: { cookie: `${uiSessionCookie}=${token}` },
      }),
      env(db),
    );
    // No server-side session remains, so validation must fail rather than
    // fabricating an expiration and issuing a fresh 30-day cookie.
    expect(session).toBeUndefined();
  });

  it("does not delete a session renewed concurrently with expired cleanup", async () => {
    const token = "raced-expired-token";
    const hash = await sha256Hex(token);
    const renewed = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const { db, sessions } = authDb({
      sessions: [{ hash, expiresAt: Date.now() - 1 }],
      // Simulate a concurrent valid request renewing the row after this
      // request's SELECT saw it expired but before its cleanup delete
      // commits.
      beforeExpiredCleanup: (deletedHash) => {
        sessions.get(deletedHash)!.expires_at = renewed;
      },
    });
    const session = await validateUiSession(
      new Request("https://v2.invalid/", {
        headers: { cookie: `${uiSessionCookie}=${token}` },
      }),
      env(db),
    );
    // This request still sees an expired session and is rejected, but the
    // cleanup must not delete the concurrently renewed row.
    expect(session).toBeUndefined();
    expect(sessions.get(hash)?.expires_at).toBe(renewed);
  });
});

describe("repository-authorized queries", () => {
  it("applies repository authorization in SQL before the recency limit", async () => {
    const { D1RunRepository } = await import("./d1-store.js");
    const calls: { sql: string; values: unknown[] }[] = [];
    const db: D1Like = {
      async batch(statements) {
        return Promise.all(statements.map((statement) => statement.run()));
      },
      prepare(sql: string) {
        const call = { sql, values: [] as unknown[] };
        calls.push(call);
        const statement = {
          bind: (...values: unknown[]) => {
            call.values = values;
            return statement;
          },
          first: async () => null,
          run: async () => ({ meta: {} }),
          all: async () => ({ meta: {}, results: [] }),
        };
        return statement as unknown as ReturnType<D1Like["prepare"]>;
      },
    };
    const repository = new D1RunRepository(db);

    // No authorized repositories: no query at all.
    await expect(repository.listRunsForRepositories([])).resolves.toEqual([]);
    expect(calls).toHaveLength(0);

    await repository.listRunsForRepositories(["1", "2"], 50);
    const list = calls.at(-1)!;
    expect(list.sql).toContain("github_id IN (?1,?2)");
    expect(list.sql.indexOf("github_id IN")).toBeLessThan(
      list.sql.indexOf("ORDER BY"),
    );
    expect(list.sql.indexOf("ORDER BY")).toBeLessThan(
      list.sql.indexOf("LIMIT"),
    );
    expect(list.values).toEqual(["1", "2", 50]);

    await repository.detailsByIssue("zorkian/roundhouse", 281, ["1"]);
    const details = calls.at(-1)!;
    expect(details.sql).toContain("github_id IN (?3)");
    expect(details.values).toEqual(["zorkian/roundhouse", 281, "1"]);

    await repository.latestWorkflowRunForRepository("zorkian/roundhouse", [
      "1",
    ]);
    const workflow = calls.at(-1)!;
    expect(workflow.sql).toContain("ORDER BY r.updated_at DESC LIMIT 1");
    expect(workflow.values).toEqual(["zorkian/roundhouse", "1"]);
  });
});
