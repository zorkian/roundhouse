// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type {
  Conversation,
  ConversationRepositoryRef,
  ConversationSummary,
} from "./conversation-store.js";

const escapeHtml = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function page(title: string, user: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)} · Roundhouse</title><style>
:root{color-scheme:light;--ink:#18212f;--muted:#647084;--line:#dde3ea;--paper:#fff;--wash:#f4f7fa;--brand:#c9472f}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}a{color:inherit}header{background:#18212f;color:#fff;padding:1.3rem max(1.25rem,calc((100% - 820px)/2));display:flex;justify-content:space-between;gap:1rem}header a{text-decoration:none;font-weight:700}header span{color:#bdc7d5}main{max-width:820px;margin:0 auto;padding:1.5rem 1.25rem 4rem}.card,.message{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:1.15rem;margin-bottom:1rem}h1{font-size:1.6rem;margin:.1rem 0 .35rem}h2{font-size:1.05rem;margin:0 0 .75rem}.muted,.meta{color:var(--muted)}label{display:block;font-weight:700;margin:.8rem 0 .35rem}select,textarea{width:100%;font:inherit;border:1px solid #b9c3cf;border-radius:8px;padding:.7rem;background:#fff}textarea{min-height:115px;resize:vertical}.button,button{display:inline-block;border:0;border-radius:8px;padding:.7rem 1rem;background:#18212f;color:#fff;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;margin-top:.8rem}.button.secondary{background:#e9edf2;color:#18212f}.button.promote{background:var(--brand)}.message{white-space:pre-wrap}.message.user{margin-left:12%}.message.assistant{margin-right:12%;border-left:4px solid #7589a3}.message .meta{font-size:.78rem;margin-bottom:.45rem;white-space:normal}.conversation{display:flex;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--line);padding:.8rem 0}.conversation:last-child{border:0}.status{font-size:.78rem;text-transform:capitalize;color:var(--muted)}.actions{display:flex;gap:.65rem;flex-wrap:wrap}.notice{background:#fff4d6;border:1px solid #f3d27c;border-radius:8px;padding:.8rem;margin-bottom:1rem}@media(max-width:600px){header{display:block}.message.user,.message.assistant{margin-left:0;margin-right:0}}
</style></head><body><header><a href="/">Roundhouse</a><span>${escapeHtml(user)} · <a href="/auth/sign-out">Sign out</a></span></header><main>${body}</main></body></html>`;
}

export function renderConversationIndex(
  repositories: readonly ConversationRepositoryRef[],
  conversations: readonly ConversationSummary[],
  user: string,
  error?: string,
): string {
  const options = repositories
    .map(
      (repository) =>
        `<option value="${escapeHtml(repository.id)}">${escapeHtml(repository.name)}</option>`,
    )
    .join("");
  const recent = conversations.length
    ? conversations
        .map(
          (conversation) =>
            `<div class="conversation"><div><a href="/conversations/${encodeURIComponent(conversation.id)}"><strong>${escapeHtml(conversation.repository)}</strong></a><div class="status">${escapeHtml(conversation.status)} · ${escapeHtml(new Date(conversation.updatedAt).toLocaleString("en-US", { timeZone: "UTC" }))} UTC</div></div>${conversation.promotedIssueUrl ? `<a href="${escapeHtml(conversation.promotedIssueUrl)}">Issue #${conversation.promotedIssueNumber}</a>` : ""}</div>`,
        )
        .join("")
    : '<p class="muted">No conversations yet.</p>';
  return page(
    "Conversations",
    user,
    `<h1>Start with a conversation</h1><p class="muted">Ask a question, explore an idea, or clarify a change before deciding whether to build it.</p>${error ? `<div class="notice">${escapeHtml(error)}</div>` : ""}<section class="card"><h2>New conversation</h2>${repositories.length ? `<form method="post" action="/conversations"><label for="repository">Repository</label><select id="repository" name="repository" required>${options}</select><label for="message">What would you like to discuss?</label><textarea id="message" name="message" maxlength="12000" required></textarea><button type="submit">Start conversation</button></form>` : '<p class="muted">You do not currently have access to an enrolled repository.</p>'}</section><section class="card"><h2>Recent conversations</h2>${recent}</section>`,
  );
}

export function renderConversation(
  conversation: Conversation,
  user: string,
  notice?: string,
): string {
  const messages = conversation.messages
    .map(
      (message) =>
        `<article class="message ${message.role}"><div class="meta">${message.role === "user" ? escapeHtml(conversation.creatorGithubLogin) : "Roundhouse"}</div>${escapeHtml(message.body)}</article>`,
    )
    .join("");
  const openControls =
    conversation.status === "open"
      ? `<section class="card"><form method="post" action="/conversations/${encodeURIComponent(conversation.id)}/messages"><label for="message">Continue the conversation</label><textarea id="message" name="message" maxlength="12000" required></textarea><button type="submit"${conversation.activeTurnId ? " disabled" : ""}>Send</button></form><form method="post" action="/conversations/${encodeURIComponent(conversation.id)}/promote"><button class="promote" type="submit"${conversation.activeTurnId ? " disabled" : ""}>Prepare delivery brief</button></form><p class="muted">You will review the exact issue brief before delivery starts.</p></section>`
      : conversation.status === "ready" && conversation.deliveryBrief
        ? `<section class="card"><h2>Review delivery brief</h2><h3>${escapeHtml(conversation.deliveryBrief.title)}</h3><p>${escapeHtml(conversation.deliveryBrief.outcome)}</p>${briefList("Acceptance criteria", conversation.deliveryBrief.acceptanceCriteria)}${briefList("Constraints", conversation.deliveryBrief.constraints)}${briefList("Context", conversation.deliveryBrief.context)}<form method="post" action="/conversations/${encodeURIComponent(conversation.id)}/promote"><button class="promote" type="submit">Start delivery</button></form><p class="muted">This creates a new GitHub issue and closes the conversation.</p></section>`
        : `<section class="card"><h2>${conversation.status === "promoted" ? "Delivery started" : "Starting delivery"}</h2>${conversation.promotedIssueUrl ? `<p><a class="button promote" href="${escapeHtml(conversation.promotedIssueUrl)}">Open GitHub issue #${conversation.promotedIssueNumber}</a></p>` : '<p class="muted">The delivery request is being created.</p>'}${conversation.status === "promoting" ? `<form method="post" action="/conversations/${encodeURIComponent(conversation.id)}/promote"><button class="promote" type="submit">Retry start</button></form><p class="muted">A retry reuses an issue that was already created.</p>` : ""}</section>`;
  return page(
    conversation.repository.name,
    user,
    `<div class="meta"><a href="/conversations">Conversations</a> · ${escapeHtml(conversation.repository.name)} · ${escapeHtml(conversation.context.model.id)} / ${escapeHtml(conversation.context.model.reasoning)}</div><h1>Conversation</h1><p class="muted">Repository context is pinned to <code>${escapeHtml(conversation.sourceCommit.slice(0, 12))}</code>. The assistant can read this snapshot and research the public web, but cannot modify anything.</p>${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ""}${messages}${openControls}`,
  );
}

function briefList(heading: string, items: readonly string[]): string {
  return items.length
    ? `<h3>${escapeHtml(heading)}</h3><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "";
}
