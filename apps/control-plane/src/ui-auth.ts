// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { observeResponse } from "@roundhouse/response-observer";
import type { D1Like } from "./d1-store.js";

export interface UiAuthEnv {
  readonly DB: D1Like;
  readonly PUBLIC_ORIGIN: string;
  readonly GITHUB_CLIENT_ID: string;
  readonly ROUNDHOUSE_GITHUB_CLIENT_SECRET: string;
}

export interface UiSession {
  readonly githubUserId: number;
  readonly githubLogin: string;
  readonly repositoryIds: readonly string[];
  readonly expiresAt: number;
}

export interface ValidatedUiSession extends UiSession {
  readonly sessionToken: string;
}

export const uiSessionCookie = "roundhouse_ui_session";
export const uiStateCookie = "roundhouse_ui_state";
export const uiSessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const uiStateLifetimeMs = 10 * 60 * 1000;

const escapeHtml = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function page(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Roundhouse</title><style>
:root{color-scheme:light;--ink:#18212f;--muted:#647084;--line:#dde3ea;--paper:#fff;--wash:#f4f7fa}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}main{max-width:480px;margin:12vh auto;padding:0 1.25rem}.card{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:2rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .5rem}p{color:var(--muted)}.button{display:inline-block;margin-top:1rem;background:#18212f;color:#fff;border-radius:8px;padding:.7rem 1.4rem;text-decoration:none;font-weight:650}</style></head><body><main><div class="card">${body}</div></main></body></html>`;
}

export function renderSignInPage(notice?: string): string {
  return page(
    `<h1>Roundhouse</h1><p>Sign in with GitHub to see the repositories you can access.</p>${notice ? `<p>${escapeHtml(notice)}</p>` : ""}<a class="button" href="/auth/github">Sign in with GitHub</a>`,
  );
}

export function renderNotFoundPage(): string {
  return page(`<h1>Not found</h1><p>This page does not exist.</p>`);
}

function log(event: string, detail: Readonly<Record<string, unknown>>): void {
  console.log(JSON.stringify({ message: event, ...detail }));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function redirect(location: string, headers?: HeadersInit): Response {
  return new Response(null, {
    status: 302,
    headers: { location, "cache-control": "no-store", ...headers },
  });
}

function readCookie(request: Request, name: string): string | undefined {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function stateCookieHeader(token: string, maxAgeSeconds: number): string {
  return `${uiStateCookie}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/auth/github/callback; Max-Age=${maxAgeSeconds}`;
}

// The cookie carries the same absolute deadline as the stored session: an
// Expires attribute derived from expiresAtMs plus the Max-Age remaining at
// the moment the header is built. Building the header when the response is
// decorated keeps both sides aligned even on slow requests.
export function sessionCookieHeader(
  token: string,
  expiresAtMs: number,
  nowMs = Date.now(),
): string {
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000));
  return `${uiSessionCookie}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}; Expires=${new Date(expiresAtMs).toUTCString()}`;
}

// The state cookie binds the OAuth state to the browser that began sign-in,
// so a callback URL captured by a third party cannot install a session in
// another browser. Cleared after every completed callback attempt.
function clearStateCookie(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", stateCookieHeader("", 0));
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

export async function beginGitHubSignIn(env: UiAuthEnv): Promise<Response> {
  const startedAt = Date.now();
  const state = randomToken();
  const stateCookieToken = randomToken();
  await env.DB.prepare(
    "INSERT INTO ui_auth_states (state_hash, state_cookie_hash, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)",
  )
    .bind(
      await sha256Hex(state),
      await sha256Hex(stateCookieToken),
      startedAt + uiStateLifetimeMs,
      startedAt,
    )
    .run();
  const target = new URL("https://github.com/login/oauth/authorize");
  target.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  target.searchParams.set(
    "redirect_uri",
    new URL("/auth/github/callback", env.PUBLIC_ORIGIN).toString(),
  );
  target.searchParams.set("state", state);
  log("ui_auth_started", {
    outcome: "redirect",
    durationMs: Date.now() - startedAt,
  });
  return redirect(target.toString(), {
    "set-cookie": stateCookieHeader(
      stateCookieToken,
      Math.floor(uiStateLifetimeMs / 1000),
    ),
  });
}

async function githubUserRepositories(
  accessToken: string,
): Promise<readonly string[]> {
  const ids: string[] = [];
  for (let page = 1; ; page += 1) {
    const response = await observeResponse(
      await fetch(
        `https://api.github.com/user/repos?per_page=100&page=${page}`,
        {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${accessToken}`,
            "user-agent": "roundhouse-control-plane",
          },
        },
      ),
      { api: "github", operation: "ui_auth_list_user_repositories" },
    );
    if (!response.ok)
      throw new Error(`github_repositories_http_${response.status}`);
    const repositories = (await response.json()) as { id: number }[];
    for (const repository of repositories) ids.push(String(repository.id));
    if (repositories.length < 100) return ids;
  }
}

async function githubRepositoryReadable(
  accessToken: string,
  githubId: string,
): Promise<boolean> {
  const response = await observeResponse(
    await fetch(`https://api.github.com/repositories/${githubId}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "user-agent": "roundhouse-control-plane",
      },
    }),
    { api: "github", operation: "ui_auth_check_repository" },
  );
  if (response.status === 404 || response.status === 403) return false;
  if (!response.ok)
    throw new Error(`github_repository_http_${response.status}`);
  return true;
}

async function enrolledRepositoryIds(db: D1Like): Promise<ReadonlySet<string>> {
  const result = await db
    .prepare("SELECT github_id FROM repositories")
    .all<{ github_id: string }>();
  return new Set((result.results ?? []).map((row) => String(row.github_id)));
}

export async function handleGitHubCallback(
  url: URL,
  request: Request,
  env: UiAuthEnv,
  html: (body: string) => Response,
): Promise<Response> {
  const startedAt = Date.now();
  const denied = url.searchParams.get("error");
  if (denied) {
    log("ui_auth_callback", {
      outcome: "denied",
      durationMs: Date.now() - startedAt,
    });
    return clearStateCookie(
      html(
        renderSignInPage("GitHub sign-in was not completed. Please try again."),
      ),
    );
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    log("ui_auth_callback", {
      outcome: "invalid_callback",
      durationMs: Date.now() - startedAt,
    });
    return clearStateCookie(
      html(
        renderSignInPage("Sign-in could not be completed. Please try again."),
      ),
    );
  }
  const stateHash = await sha256Hex(state);
  const stateRow = await env.DB.prepare(
    "SELECT state_cookie_hash, expires_at FROM ui_auth_states WHERE state_hash = ?1",
  )
    .bind(stateHash)
    .first<{ state_cookie_hash: string; expires_at: number }>();
  await env.DB.prepare("DELETE FROM ui_auth_states WHERE state_hash = ?1")
    .bind(stateHash)
    .run();
  const stateCookieToken = readCookie(request, uiStateCookie);
  if (
    !stateRow ||
    stateRow.expires_at <= Date.now() ||
    !stateCookieToken ||
    stateRow.state_cookie_hash !== (await sha256Hex(stateCookieToken))
  ) {
    log("ui_auth_callback", {
      outcome: "state_invalid",
      durationMs: Date.now() - startedAt,
    });
    return clearStateCookie(
      html(renderSignInPage("Sign-in expired. Please try again.")),
    );
  }
  const tokenResponse = await observeResponse(
    await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.ROUNDHOUSE_GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: new URL(
          "/auth/github/callback",
          env.PUBLIC_ORIGIN,
        ).toString(),
      }),
    }),
    { api: "github", operation: "ui_auth_exchange_code" },
  );
  const tokenBody = (await tokenResponse.json()) as {
    access_token?: string;
  };
  if (!tokenResponse.ok || !tokenBody.access_token) {
    log("ui_auth_callback", {
      outcome: "exchange_failed",
      status: tokenResponse.status,
      durationMs: Date.now() - startedAt,
    });
    return clearStateCookie(
      html(
        renderSignInPage("Sign-in could not be completed. Please try again."),
      ),
    );
  }
  const accessToken = tokenBody.access_token;
  try {
    const userResponse = await observeResponse(
      await fetch("https://api.github.com/user", {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${accessToken}`,
          "user-agent": "roundhouse-control-plane",
        },
      }),
      { api: "github", operation: "ui_auth_fetch_user" },
    );
    if (!userResponse.ok)
      throw new Error(`github_user_http_${userResponse.status}`);
    const user = (await userResponse.json()) as { id: number; login: string };
    const readable = await githubUserRepositories(accessToken);
    const enrolled = await enrolledRepositoryIds(env.DB);
    const readableSet = new Set(readable);
    const repositoryIds = readable.filter((id) => enrolled.has(id));
    // /user/repos only lists repositories affiliated with the user; enrolled
    // public repositories must be visible to any signed-in GitHub user, so
    // check the remaining enrolled repositories directly.
    for (const id of enrolled) {
      if (readableSet.has(id)) continue;
      if (await githubRepositoryReadable(accessToken, id))
        repositoryIds.push(id);
    }
    const sessionToken = randomToken();
    await env.DB.prepare(
      "INSERT INTO ui_sessions (session_hash, github_user_id, github_login, repository_ids_json, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
      .bind(
        await sha256Hex(sessionToken),
        user.id,
        user.login,
        JSON.stringify(repositoryIds),
        Date.now() + uiSessionLifetimeMs,
        Date.now(),
      )
      .run();
    // The GitHub access and refresh tokens are discarded here; only the
    // resolved identity and authorized repository IDs persist.
    log("ui_auth_callback", {
      outcome: "signed_in",
      githubUserId: user.id,
      authorizedRepositories: repositoryIds.length,
      durationMs: Date.now() - startedAt,
    });
    const success = redirect("/", {
      "set-cookie": sessionCookieHeader(
        sessionToken,
        Date.now() + uiSessionLifetimeMs,
      ),
    });
    return clearStateCookie(success);
  } catch (error) {
    log("ui_auth_callback", {
      outcome: "github_resolution_failed",
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    });
    return clearStateCookie(
      html(
        renderSignInPage("Sign-in could not be completed. Please try again."),
      ),
    );
  }
}

export async function validateUiSession(
  request: Request,
  env: UiAuthEnv,
): Promise<ValidatedUiSession | undefined> {
  const startedAt = Date.now();
  const cookie = request.headers.get("cookie") ?? "";
  const token = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${uiSessionCookie}=`))
    ?.slice(uiSessionCookie.length + 1);
  if (!token) {
    log("ui_session_validated", {
      outcome: "absent",
      durationMs: Date.now() - startedAt,
    });
    return undefined;
  }
  const row = await env.DB.prepare(
    "SELECT github_user_id, github_login, repository_ids_json, expires_at, created_at FROM ui_sessions WHERE session_hash = ?1",
  )
    .bind(await sha256Hex(token))
    .first<{
      github_user_id: number;
      github_login: string;
      repository_ids_json: string;
      expires_at: number;
      created_at: number;
    }>();
  if (!row) {
    log("ui_session_validated", {
      outcome: "unknown",
      durationMs: Date.now() - startedAt,
    });
    return undefined;
  }
  // The session caches the repository access resolved at GitHub sign-in, so
  // its total age is bounded: renewal never extends a session beyond one
  // lifetime from sign-in. After that the user signs in again and repository
  // access is re-resolved against GitHub.
  const authorizationEndsAt = row.created_at + uiSessionLifetimeMs;
  if (row.expires_at <= startedAt || authorizationEndsAt <= startedAt) {
    await env.DB.prepare("DELETE FROM ui_sessions WHERE expires_at <= ?1")
      .bind(startedAt)
      .run();
    await env.DB.prepare("DELETE FROM ui_sessions WHERE session_hash = ?1")
      .bind(await sha256Hex(token))
      .run();
    log("ui_session_validated", {
      outcome: "expired",
      githubUserId: row.github_user_id,
      durationMs: Date.now() - startedAt,
    });
    return undefined;
  }
  log("ui_session_validated", {
    outcome: "valid",
    githubUserId: row.github_user_id,
    durationMs: Date.now() - startedAt,
  });
  // Sliding expiration: every validated visit extends the server-side session
  // and returns a matching renewed browser cookie, so active users stay
  // signed in. The session token itself is unchanged.
  const renewalStartedAt = Date.now();
  const previousExpiresAt = row.expires_at;
  const renewedExpiresAt = Math.min(
    startedAt + uiSessionLifetimeMs,
    authorizationEndsAt,
  );
  await env.DB.prepare(
    "UPDATE ui_sessions SET expires_at = ?1 WHERE session_hash = ?2",
  )
    .bind(renewedExpiresAt, await sha256Hex(token))
    .run();
  log("ui_session_renewed", {
    outcome: "renewed",
    githubUserId: row.github_user_id,
    previousExpiresAt,
    expiresAt: renewedExpiresAt,
    authorizationEndsAt,
    durationMs: Date.now() - renewalStartedAt,
  });
  return {
    githubUserId: row.github_user_id,
    githubLogin: row.github_login,
    repositoryIds: JSON.parse(row.repository_ids_json) as string[],
    expiresAt: renewedExpiresAt,
    sessionToken: token,
  };
}

export async function signOut(
  request: Request,
  env: UiAuthEnv,
): Promise<Response> {
  const startedAt = Date.now();
  const cookie = request.headers.get("cookie") ?? "";
  const token = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${uiSessionCookie}=`))
    ?.slice(uiSessionCookie.length + 1);
  if (token)
    await env.DB.prepare("DELETE FROM ui_sessions WHERE session_hash = ?1")
      .bind(await sha256Hex(token))
      .run();
  log("ui_sign_out", {
    outcome: "signed_out",
    durationMs: Date.now() - startedAt,
  });
  return redirect("/", {
    "set-cookie": sessionCookieHeader("", Date.now()),
  });
}
