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

export const developmentBadge = '<span class="env-badge">Development</span>';

export const developmentBadgeStyles = `.env-badge{font-size:.72rem;font-weight:650;letter-spacing:.04em;text-transform:uppercase;color:#bdc7d5;border:1px solid rgba(189,199,213,.5);border-radius:999px;padding:.18rem .6rem}`;

export const sharedHeaderStyles = `.site-header{position:relative;background:#18212f;color:#fff;padding:1.25rem max(1.25rem,calc((100% - 1080px)/2))}.site-header-inner{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}.site-brand{font-size:1.5rem;font-weight:700;letter-spacing:-.025em;text-decoration:none}.site-nav,.site-account{display:flex;align-items:center;gap:.85rem;flex-wrap:wrap}.site-nav a,.site-account a{color:#bdc7d5}.site-account{margin-left:auto}.site-avatar{width:2rem;height:2rem;border-radius:50%;background:#bdc7d5}.site-login{font-weight:650}.site-header>.env-badge{position:absolute;top:1.5rem;left:50%;transform:translateX(-50%)}${developmentBadgeStyles}@media(max-width:850px){.site-header{padding-top:3.25rem}.site-header>.env-badge{top:1rem}}@media(max-width:650px){.site-header{padding-right:1.25rem;padding-bottom:1rem;padding-left:1.25rem}.site-account{margin-left:0;width:100%}}`;

export function renderSiteHeader(account?: HeaderAccount): string {
  const avatar = account?.githubUserId
    ? `<img class="site-avatar" src="https://avatars.githubusercontent.com/u/${account.githubUserId}" alt="${escapeHtml(account.githubLogin)}'s GitHub avatar">`
    : "";
  const user = account
    ? `<div class="site-account">${avatar}<span class="site-login">${escapeHtml(account.githubLogin)}</span><a href="/auth/sign-out">Sign out</a></div>`
    : "";
  return `<header class="site-header"><div class="site-header-inner"><a class="site-brand" href="/">Roundhouse</a><nav class="site-nav" aria-label="Primary navigation"><a href="/">Runs</a><a href="/conversations">Conversations</a><a href="/usage">Model usage</a></nav>${user}</div>${developmentBadge}</header>`;
}
