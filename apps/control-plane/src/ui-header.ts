// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

export interface HeaderAccount {
  readonly githubUserId?: number;
  readonly githubLogin: string;
}

const escapeHtml = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const sharedHeaderStyles = `.site-header{background:#18212f;color:#fff;padding:1.25rem max(1.25rem,calc((100% - 1080px)/2))}.site-header-inner{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}.site-brand{font-size:1.5rem;font-weight:700;letter-spacing:-.025em;text-decoration:none}.site-nav,.site-account{display:flex;align-items:center;gap:.85rem;flex-wrap:wrap}.site-nav a,.site-account a{color:#bdc7d5}.site-account{margin-left:auto}.site-avatar{width:2rem;height:2rem;border-radius:50%;background:#bdc7d5}.site-login{font-weight:650}@media(max-width:650px){.site-header{padding:1rem 1.25rem}.site-account{margin-left:0;width:100%}}`;

export function renderSiteHeader(
  account?: HeaderAccount,
  brandSupplement = "",
): string {
  const avatar = account?.githubUserId
    ? `<img class="site-avatar" src="https://avatars.githubusercontent.com/u/${account.githubUserId}" alt="${escapeHtml(account.githubLogin)}'s GitHub avatar">`
    : "";
  const user = account
    ? `<div class="site-account">${avatar}<span class="site-login">${escapeHtml(account.githubLogin)}</span><a href="/auth/sign-out">Sign out</a></div>`
    : "";
  return `<header class="site-header"><div class="site-header-inner"><a class="site-brand" href="/">Roundhouse</a>${brandSupplement}<nav class="site-nav" aria-label="Primary navigation"><a href="/">Runs</a><a href="/conversations">Conversations</a><a href="/usage">Model usage</a></nav>${user}</div></header>`;
}
