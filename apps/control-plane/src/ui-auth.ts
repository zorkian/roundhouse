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
// The browser session slides for 30 days, but the repository authorization
// snapshot resolved at sign-in does not: once it is this old, the next
// validated visit re-resolves repository access against GitHub before the
// session is renewed, so revoked access cannot be extended indefinitely.
export const uiAuthorizationLifetimeMs = 8 * 60 * 60 * 1000;
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

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// The stored GitHub access token is a reusable bearer credential, so it is
// never written to the database in plaintext. It is encrypted with AES-GCM
// under a key derived from the OAuth client secret — key material held by
// the Worker, outside the database — and decrypted only in memory for the
// bounded authorization refresh. Format: v1.<iv>.<ciphertext>, base64url.
async function uiTokenEncryptionKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`roundhouse-ui-session-token:${secret}`),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptUiAccessToken(
  token: string,
  secret: string,
): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await uiTokenEncryptionKey(secret),
      new TextEncoder().encode(token),
    ),
  );
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(ciphertext)}`;
}

export async function decryptUiAccessToken(
  stored: string,
  secret: string,
): Promise<string | undefined> {
  const [version, iv, ciphertext] = stored.split(".");
  if (version !== "v1" || iv === undefined || ciphertext === undefined)
    return undefined;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlDecode(iv) as BufferSource },
      await uiTokenEncryptionKey(secret),
      base64UrlDecode(ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return undefined;
  }
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
// the moment the header is built. Max-Age is rounded up so the emitted
// browser lifetime is never shorter than the full session lifetime
// (browsers give Max-Age precedence over Expires). Building the header when
// the response is decorated keeps both sides aligned even on slow requests.
export function sessionCookieHeader(
  token: string,
  expiresAtMs: number,
  nowMs = Date.now(),
): string {
  const maxAgeSeconds = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
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

// Resolves the enrolled repositories the GitHub user behind `accessToken`
// can currently read. Used at sign-in and again when a sliding session's
// cached authorization snapshot reaches its bound.
async function authorizedRepositoryIds(
  accessToken: string,
  db: D1Like,
): Promise<string[]> {
  const readable = await githubUserRepositories(accessToken);
  const enrolled = await enrolledRepositoryIds(db);
  const readableSet = new Set(readable);
  const repositoryIds = readable.filter((id) => enrolled.has(id));
  // /user/repos only lists repositories affiliated with the user; enrolled
  // public repositories must be visible to any signed-in GitHub user, so
  // check the remaining enrolled repositories directly.
  for (const id of enrolled) {
    if (readableSet.has(id)) continue;
    if (await githubRepositoryReadable(accessToken, id)) repositoryIds.push(id);
  }
  return repositoryIds;
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
    const repositoryIds = await authorizedRepositoryIds(accessToken, env.DB);
    const sessionToken = randomToken();
    // One expiration timestamp feeds both the persisted session and the
    // cookie so the browser and server deadlines stay aligned.
    const expiresAt = Date.now() + uiSessionLifetimeMs;
    await env.DB.prepare(
      "INSERT INTO ui_sessions (session_hash, github_user_id, github_login, repository_ids_json, expires_at, created_at, github_access_token, authorized_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
      .bind(
        await sha256Hex(sessionToken),
        user.id,
        user.login,
        JSON.stringify(repositoryIds),
        expiresAt,
        Date.now(),
        await encryptUiAccessToken(
          accessToken,
          env.ROUNDHOUSE_GITHUB_CLIENT_SECRET,
        ),
        Date.now(),
      )
      .run();
    // The GitHub access token persists with the session — encrypted with
    // key material outside the database — so a stale authorization
    // snapshot can be re-resolved against GitHub during sliding renewal;
    // it is never exposed to the browser and never stored in plaintext.
    log("ui_auth_callback", {
      outcome: "signed_in",
      githubUserId: user.id,
      authorizedRepositories: repositoryIds.length,
      durationMs: Date.now() - startedAt,
    });
    const success = redirect("/", {
      "set-cookie": sessionCookieHeader(sessionToken, expiresAt),
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
    "SELECT github_user_id, github_login, repository_ids_json, expires_at, created_at, github_access_token, authorized_at FROM ui_sessions WHERE session_hash = ?1",
  )
    .bind(await sha256Hex(token))
    .first<{
      github_user_id: number;
      github_login: string;
      repository_ids_json: string;
      expires_at: number;
      created_at: number;
      github_access_token: string | null;
      authorized_at: number | null;
    }>();
  if (!row) {
    log("ui_session_validated", {
      outcome: "unknown",
      durationMs: Date.now() - startedAt,
    });
    return undefined;
  }
  if (row.expires_at <= startedAt) {
    await env.DB.prepare(
      "DELETE FROM ui_sessions WHERE session_hash = ?1 AND expires_at <= ?2",
    )
      .bind(await sha256Hex(token), startedAt)
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
  // Bound the cached repository authorization: once the snapshot resolved
  // at sign-in is old enough, re-resolve repository access against GitHub
  // before renewing. Sliding renewal must not extend revoked privileges
  // indefinitely; failure to reauthorize ends the session instead.
  let repositoryIds = JSON.parse(row.repository_ids_json) as string[];
  let authorizedAt = row.authorized_at ?? row.created_at;
  if (startedAt - authorizedAt >= uiAuthorizationLifetimeMs) {
    const reauthorizationStartedAt = Date.now();
    // Decrypt the stored bearer token only in memory, for this refresh.
    // Sessions predating token encryption hold plaintext here; they cannot
    // be decrypted safely and must reauthenticate.
    const accessToken = row.github_access_token
      ? await decryptUiAccessToken(
          row.github_access_token,
          env.ROUNDHOUSE_GITHUB_CLIENT_SECRET,
        )
      : undefined;
    if (!accessToken) {
      await env.DB.prepare("DELETE FROM ui_sessions WHERE session_hash = ?1")
        .bind(await sha256Hex(token))
        .run();
      log("ui_session_reauthorized", {
        outcome: "reauthentication_required",
        githubUserId: row.github_user_id,
        previousAuthorizedAt: authorizedAt,
        durationMs: Date.now() - reauthorizationStartedAt,
      });
      return undefined;
    }
    try {
      repositoryIds = await authorizedRepositoryIds(accessToken, env.DB);
      authorizedAt = Date.now();
      log("ui_session_reauthorized", {
        outcome: "refreshed",
        githubUserId: row.github_user_id,
        previousAuthorizedAt: row.authorized_at ?? row.created_at,
        authorizedAt,
        authorizedRepositories: repositoryIds.length,
        durationMs: Date.now() - reauthorizationStartedAt,
      });
    } catch (error) {
      await env.DB.prepare("DELETE FROM ui_sessions WHERE session_hash = ?1")
        .bind(await sha256Hex(token))
        .run();
      log("ui_session_reauthorized", {
        outcome: "failed",
        githubUserId: row.github_user_id,
        previousAuthorizedAt: row.authorized_at ?? row.created_at,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - reauthorizationStartedAt,
      });
      return undefined;
    }
  }
  const renewalStartedAt = Date.now();
  const previousExpiresAt = row.expires_at;
  // Renewal is monotonic and atomic: MAX() keeps any newer expiration a
  // concurrent request may have written, and RETURNING yields the actual
  // persisted deadline so the issued cookie can never be out of sync with
  // the database, even if a write lands between our SELECT and UPDATE.
  const updated = await env.DB.prepare(
    "UPDATE ui_sessions SET expires_at = MAX(expires_at, ?1), repository_ids_json = ?2, authorized_at = ?3 WHERE session_hash = ?4 RETURNING expires_at",
  )
    .bind(
      startedAt + uiSessionLifetimeMs,
      JSON.stringify(repositoryIds),
      authorizedAt,
      await sha256Hex(token),
    )
    .first<{ expires_at: number }>();
  if (!updated) {
    // The row vanished between the SELECT and the UPDATE — typically a
    // concurrent sign-out deleted it. Treat this as failed validation so we
    // do not issue a fresh cookie for a session that no longer exists.
    log("ui_session_renewed", {
      outcome: "missing",
      githubUserId: row.github_user_id,
      previousExpiresAt,
      durationMs: Date.now() - renewalStartedAt,
    });
    return undefined;
  }
  const renewedExpiresAt = updated.expires_at;
  log("ui_session_renewed", {
    outcome: "renewed",
    githubUserId: row.github_user_id,
    previousExpiresAt,
    expiresAt: renewedExpiresAt,
    durationMs: Date.now() - renewalStartedAt,
  });
  return {
    githubUserId: row.github_user_id,
    githubLogin: row.github_login,
    repositoryIds,
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
