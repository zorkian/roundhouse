// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import type { D1Like } from "./d1-store.js";
import {
  beginGitHubSignIn,
  handleGitHubCallback,
  signOut,
  uiSessionCookie,
  uiStateCookie,
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
  }[];
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
      },
    ]),
  );
  const db: D1Like = {
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
            });
          if (sql.includes("DELETE FROM ui_sessions WHERE session_hash"))
            sessions.delete(String(values[0]));
          if (sql.includes("DELETE FROM ui_sessions WHERE expires_at"))
            for (const [hash, session] of sessions)
              if (session.expires_at <= Number(values[0]))
                sessions.delete(hash);
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

const env = (db: D1Like) => ({
  DB: db,
  PUBLIC_ORIGIN: "https://v2.invalid",
  GITHUB_CLIENT_ID: "client-id",
  ROUNDHOUSE_GITHUB_CLIENT_SECRET: "client-secret",
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub UI sign-in", () => {
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
    const start = await beginGitHubSignIn(env(db));
    const state = new URL(start.headers.get("location")!).searchParams.get(
      "state",
    )!;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("login/oauth/access_token"))
        return Response.json({ access_token: "user-token" });
      if (url.includes("api.github.com/user/repos"))
        return Response.json([
          { id: 1297678423 },
          { id: 42 }, // readable but not enrolled
        ]);
      if (url.includes("api.github.com/user"))
        return Response.json({ id: 7, login: "octocat" });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await handleGitHubCallback(
      new URL(
        `https://v2.invalid/auth/github/callback?code=abc&state=${state}`,
      ),
      callbackRequest("https://v2.invalid/auth/github/callback", start),
      env(db),
      html,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(`${uiSessionCookie}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    // State is one-time: consumed by the callback.
    expect(states.size).toBe(0);
    // Only the enrolled repository ID was stored; GitHub tokens were not.
    const session = [...sessions.values()][0]!;
    expect(session.github_login).toBe("octocat");
    expect(JSON.parse(session.repository_ids_json)).toEqual(["1297678423"]);
    expect(session.expires_at).toBeGreaterThan(Date.now());
    expect(JSON.stringify([...sessions.values()])).not.toContain("user-token");
    // The access token never appears in the redirect target.
    expect(response.headers.get("location")).not.toContain("token");
  });

  it("includes enrolled public repositories not listed for the user", async () => {
    const { db, states, sessions } = authDb({
      enrolled: ["1297678423", "555"],
    });
    const start = await beginGitHubSignIn(env(db));
    const state = new URL(start.headers.get("location")!).searchParams.get(
      "state",
    )!;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("login/oauth/access_token"))
        return Response.json({ access_token: "user-token" });
      if (url.includes("api.github.com/user/repos"))
        return Response.json([{ id: 1297678423 }]);
      if (url.includes("api.github.com/repositories/555"))
        return Response.json({ id: 555, private: false });
      if (url.includes("api.github.com/user"))
        return Response.json({ id: 7, login: "octocat" });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await handleGitHubCallback(
      new URL(
        `https://v2.invalid/auth/github/callback?code=abc&state=${state}`,
      ),
      callbackRequest("https://v2.invalid/auth/github/callback", start),
      env(db),
      html,
    );
    expect(response.status).toBe(302);
    const session = [...sessions.values()][0]!;
    expect(JSON.parse(session.repository_ids_json).sort()).toEqual([
      "1297678423",
      "555",
    ]);
    void states;
  });

  it("excludes enrolled private repositories the user cannot read", async () => {
    const { db, sessions } = authDb({ enrolled: ["1297678423", "555"] });
    const start = await beginGitHubSignIn(env(db));
    const state = new URL(start.headers.get("location")!).searchParams.get(
      "state",
    )!;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("login/oauth/access_token"))
          return Response.json({ access_token: "user-token" });
        if (url.includes("api.github.com/user/repos"))
          return Response.json([{ id: 1297678423 }]);
        if (url.includes("api.github.com/repositories/555"))
          return new Response("not found", { status: 404 });
        if (url.includes("api.github.com/user"))
          return Response.json({ id: 7, login: "octocat" });
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const response = await handleGitHubCallback(
      new URL(
        `https://v2.invalid/auth/github/callback?code=abc&state=${state}`,
      ),
      callbackRequest("https://v2.invalid/auth/github/callback", start),
      env(db),
      html,
    );
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
    // Expired sessions are removed on validation.
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
});

describe("repository-authorized queries", () => {
  it("applies repository authorization in SQL before the recency limit", async () => {
    const { D1RunRepository } = await import("./d1-store.js");
    const calls: { sql: string; values: unknown[] }[] = [];
    const db: D1Like = {
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
