// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import type {
  Conversation,
  ConversationRepositoryRef,
  ConversationSummary,
  DeliveryBrief,
} from "./conversation-store.js";

const escapeHtml = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const styles = `<style>:root{color-scheme:light;--ink:#18212f;--muted:#647084;--line:#dde3ea;--paper:#fff;--wash:#f4f7fa;--brand:#175cd3;--warn:#8a5b00}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}a{color:inherit}header{background:#18212f;color:#fff;padding:2rem max(1.25rem,calc((100% - 900px)/2))}header p{color:#bdc7d5;margin:.35rem 0 0}main{max-width:900px;margin:0 auto;padding:1.5rem 1.25rem 4rem}.card,.message{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:1rem 1.2rem;margin-bottom:1rem}h1{margin:0;font-size:1.8rem}h2{font-size:1.1rem;margin:.2rem 0 .8rem}h3{font-size:1rem;margin:1rem 0 .3rem}.muted,.meta{color:var(--muted)}label{display:block;font-weight:650;margin:.8rem 0 .3rem}textarea,input,select{width:100%;font:inherit;border:1px solid #b8c2cf;border-radius:8px;padding:.65rem;background:white}textarea{min-height:110px}button,.button{display:inline-block;border:0;border-radius:8px;background:#18212f;color:white;padding:.65rem 1rem;font:inherit;font-weight:650;text-decoration:none;cursor:pointer;margin-top:.8rem}button.promote,.button.promote{background:var(--brand)}button[disabled]{opacity:.55;cursor:not-allowed}.message{white-space:pre-wrap}.message.user{margin-left:12%}.message.assistant{margin-right:12%;border-left:4px solid #7589a3}.message .meta{font-size:.78rem;margin-bottom:.45rem;white-space:normal}.conversation{display:flex;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--line);padding:.8rem 0}.conversation:last-child{border:0}.conversation-meta{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;margin-top:.2rem;font-size:.78rem;color:var(--muted)}.status{border-radius:999px;padding:.22rem .55rem;font-weight:700;color:#344054;background:#eef1f5}.status.active{background:#e6f0ff;color:#175cd3}.status.waiting{background:#fff4d6;color:#8a5b00}.status.failed{background:#fee9e7;color:#b42318}.status.succeeded{background:#e8f7ee;color:#087443}.actions{display:flex;gap:.65rem;flex-wrap:wrap}.notice{background:#fff4d6;border:1px solid #f3d27c;border-radius:8px;padding:.8rem;margin-bottom:1rem}.readonly{display:inline-block;border:1px solid #a9b5c4;border-radius:999px;padding:.2rem .55rem;font-size:.78rem;font-weight:650}.brief-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 1rem}.brief-grid .wide{grid-column:1/-1}.waiting{color:var(--warn)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:650px){header{display:block}.message.user,.message.assistant{margin-left:0;margin-right:0}.brief-grid{display:block}}</style>`;

function page(title: string, user: string, body: string, script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)} · Roundhouse</title>${styles}</head><body><header><h1>Roundhouse</h1><p>Signed in as ${escapeHtml(user)} · <a href="/">Runs</a> · <a href="/usage">Model usage</a> · <a href="/auth/sign-out">Sign out</a></p></header><main>${body}</main>${script}</body></html>`;
}

function conversationStatus(conversation: ConversationSummary): {
  readonly label: string;
  readonly tone: "open" | "active" | "waiting" | "succeeded" | "failed";
} {
  switch (conversation.promotionState) {
    case "requested":
      return { label: "Preparing delivery", tone: "active" };
    case "issue_created":
      return { label: "Starting delivery", tone: "active" };
    case "awaiting_intake":
      return { label: "Waiting to start delivery", tone: "waiting" };
    case "accepted":
      return { label: "Delivery started", tone: "succeeded" };
    case "rejected":
      return { label: "Delivery not accepted", tone: "failed" };
    case undefined:
      break;
  }
  switch (conversation.status) {
    case "open":
      return { label: "Open", tone: "open" };
    case "handoff_pending":
      return { label: "Preparing delivery", tone: "active" };
    case "promoted":
      return { label: "Delivery started", tone: "succeeded" };
  }
}

function updatedAgo(updatedAt: number): string {
  const elapsedMinutes = Math.floor(
    Math.max(0, Date.now() - updatedAt) / 60_000,
  );
  if (!elapsedMinutes) return "Updated just now";
  if (elapsedMinutes < 60)
    return `Updated ${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24)
    return `Updated ${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `Updated ${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
}

export function renderConversationIndex(
  repositories: readonly ConversationRepositoryRef[],
  conversations: readonly ConversationSummary[],
  user: string,
  error?: string,
  messageId: string = crypto.randomUUID(),
): string {
  const options = repositories
    .map(
      (repository) =>
        `<option value="${escapeHtml(repository.id)}">${escapeHtml(repository.name)}</option>`,
    )
    .join("");
  const recent = conversations.length
    ? conversations
        .map((conversation) => {
          const title = conversation.title?.trim() || "New conversation";
          const status = conversationStatus(conversation);
          const updatedAt = new Date(conversation.updatedAt);
          return `<div class="conversation"><div><a href="/conversations/${encodeURIComponent(conversation.id)}"><strong>${escapeHtml(title)}</strong></a><div class="conversation-meta"><span>${escapeHtml(conversation.repository)}</span><span class="status ${status.tone}">${escapeHtml(status.label)}</span><time datetime="${escapeHtml(updatedAt.toISOString())}">${escapeHtml(updatedAgo(conversation.updatedAt))}</time></div></div>${conversation.issueUrl ? `<a href="${escapeHtml(conversation.issueUrl)}">Issue #${escapeHtml(conversation.issueNumber)}</a>` : ""}</div>`;
        })
        .join("")
    : '<p class="muted">No conversations yet.</p>';
  return page(
    "Conversations",
    user,
    `<h1>Start with a conversation</h1><p class="muted">Ask a question, explore an idea, or clarify a change before deciding whether to build it.</p>${error ? `<div class="notice">${escapeHtml(error)}</div>` : ""}<section class="card"><h2>New conversation</h2>${repositories.length ? `<form method="post" action="/conversations"><input type="hidden" name="message_id" value="${escapeHtml(messageId)}"><label for="repository">Public repository</label><select id="repository" name="repository" required>${options}</select><label for="message">What would you like to discuss?</label><textarea id="message" name="message" maxlength="12000" required></textarea><button type="submit">Start conversation</button></form>` : '<p class="muted">You do not currently have access to an enrolled public repository.</p>'}</section><section class="card"><h2>Recent conversations</h2>${recent}</section>`,
  );
}

function lines(value: readonly string[]): string {
  return value.join("\n");
}

function briefEditor(conversation: Conversation, brief: DeliveryBrief): string {
  return `<section class="card"><h2>Review and edit delivery brief</h2><p class="muted">The exact fields below will be published to a new GitHub issue. Editing them does not invoke the agent.</p><form method="post" action="/conversations/${encodeURIComponent(conversation.id)}/promote"><input type="hidden" name="brief_id" value="${escapeHtml(brief.id)}"><div class="brief-grid"><div class="wide"><label for="title">Issue title</label><input id="title" name="title" maxlength="100" value="${escapeHtml(brief.title)}" required></div><div class="wide"><label for="outcome">Outcome</label><textarea id="outcome" name="outcome" required>${escapeHtml(brief.outcome)}</textarea></div><div><label for="acceptance_criteria">Acceptance criteria, one per line</label><textarea id="acceptance_criteria" name="acceptance_criteria">${escapeHtml(lines(brief.acceptanceCriteria))}</textarea></div><div><label for="constraints">Constraints, one per line</label><textarea id="constraints" name="constraints">${escapeHtml(lines(brief.constraints))}</textarea></div><div><label for="evidence">Evidence and decisions, one per line</label><textarea id="evidence" name="evidence">${escapeHtml(lines(brief.evidence))}</textarea></div><div><label for="uncertainties">Remaining uncertainties, one per line</label><textarea id="uncertainties" name="uncertainties">${escapeHtml(lines(brief.uncertainties))}</textarea></div></div><button class="promote" type="submit">Start delivery</button></form><p class="muted">Roundhouse will create one issue, post the normal start command, and wait for GitHub intake to accept the run before closing this conversation.</p></section>`;
}

function openControls(conversation: Conversation, messageId: string): string {
  if (conversation.activeTurn)
    return '<section class="card"><h2 class="waiting">Roundhouse is working…</h2><p class="muted">This turn is durable. You can leave this page and return later.</p></section>';
  const reply = `<section class="card"><form method="post" action="/conversations/${encodeURIComponent(conversation.id)}/messages"><input type="hidden" name="message_id" value="${escapeHtml(messageId)}"><label for="message">Continue the conversation</label><textarea id="message" name="message" maxlength="12000" required></textarea><button type="submit">Send</button></form></section>`;
  return conversation.currentBrief?.state === "draft"
    ? `${briefEditor(conversation, conversation.currentBrief)}${reply}`
    : `${reply}<section class="card"><form method="post" action="/conversations/${encodeURIComponent(conversation.id)}/brief"><button class="promote" type="submit">Prepare delivery brief</button></form><p class="muted">You will be able to edit the exact issue brief or continue the conversation before starting delivery.</p></section>`;
}

function promotionControls(conversation: Conversation): string {
  const promotion = conversation.promotion;
  if (!promotion) return "";
  const issue = promotion.issueUrl
    ? `<p><a class="button promote" href="${escapeHtml(promotion.issueUrl)}">Open GitHub issue #${promotion.issueNumber}</a></p>`
    : "";
  const run = conversation.links.find((link) => link.kind === "roundhouse.run");
  if (promotion.state === "accepted" || conversation.status === "promoted")
    return `<section class="card"><h2>Delivery started</h2>${issue}${run ? `<p><a class="button" href="${escapeHtml(run.url)}">Open Roundhouse run</a></p>` : ""}</section>`;
  if (promotion.state === "rejected")
    return `<section class="card"><h2>Delivery was not accepted</h2>${issue}<p class="notice">${escapeHtml(promotion.errorCode ?? "GitHub intake rejected this promotion")}. This conversation has not been marked delivered.</p></section>`;
  if (promotion.state === "awaiting_intake")
    return `<section class="card"><h2 class="waiting">Waiting for Roundhouse intake</h2>${issue}<p class="muted">The issue and start comment exist. This conversation will close only after the normal GitHub webhook authorizes the actor and records the run.</p></section>`;
  return `<section class="card"><h2 class="waiting">Creating the delivery request…</h2>${issue}<p class="muted">This operation is durable and reconciles existing GitHub writes before retrying.</p></section>`;
}

function messageHtml(message: Conversation["messages"][number]): string {
  return `<article class="message ${message.role}" data-message-id="${escapeHtml(message.id)}"><div class="meta">${message.role === "user" ? escapeHtml(message.actorLogin) : "Roundhouse"}</div>${escapeHtml(message.body)}</article>`;
}

function statusKey(conversation: Conversation): string {
  if (conversation.activeTurn) return `turn:${conversation.activeTurn.state}`;
  if (conversation.promotion)
    return `promotion:${conversation.promotion.state}`;
  if (conversation.latestTurn) return `turn:${conversation.latestTurn.state}`;
  return `conversation:${conversation.status}`;
}

function statusAnnouncement(key: string): string {
  switch (key) {
    case "turn:pending":
    case "turn:running":
      return "Roundhouse is working.";
    case "turn:succeeded":
      return "Roundhouse finished this turn.";
    case "turn:failed":
      return "Roundhouse could not complete this turn.";
    case "promotion:requested":
    case "promotion:issue_created":
      return "Roundhouse is preparing delivery.";
    case "promotion:awaiting_intake":
      return "Waiting for Roundhouse intake.";
    case "promotion:accepted":
      return "Delivery started.";
    case "promotion:rejected":
      return "Delivery was not accepted.";
    default:
      return "Conversation status updated.";
  }
}

export function conversationPollingActive(conversation: Conversation): boolean {
  return Boolean(
    conversation.activeTurn ||
    (conversation.promotion &&
      ["requested", "issue_created", "awaiting_intake"].includes(
        conversation.promotion.state,
      )),
  );
}

function statusHtml(conversation: Conversation): string {
  return conversation.latestTurn?.state === "failed"
    ? `<div class="notice">Roundhouse could not complete the last ${conversation.latestTurn.kind === "brief" ? "delivery brief" : "reply"}. You can try again or continue the conversation.</div>`
    : "";
}

function controlsHtml(conversation: Conversation, messageId: string): string {
  return conversation.promotion
    ? promotionControls(conversation)
    : conversation.status === "open"
      ? openControls(conversation, messageId)
      : promotionControls(conversation);
}

function version(value: unknown): string {
  return encodeURIComponent(JSON.stringify(value));
}

export interface ConversationPollState {
  readonly messages: readonly { readonly id: string; readonly html: string }[];
  readonly status: {
    readonly version: string;
    readonly html: string;
    readonly key: string;
    readonly announcement: string;
  };
  readonly controls: { readonly version: string; readonly html: string };
  readonly polling: boolean;
}

export function renderConversationPollState(
  conversation: Conversation,
  messageId: string = crypto.randomUUID(),
): ConversationPollState {
  const key = statusKey(conversation);
  return {
    messages: conversation.messages.map((message) => ({
      id: message.id,
      html: messageHtml(message),
    })),
    status: {
      version: version([key, conversation.latestTurn?.updatedAt]),
      html: statusHtml(conversation),
      key,
      announcement: statusAnnouncement(key),
    },
    controls: {
      version: version([
        conversation.status,
        conversation.activeTurn?.id,
        conversation.activeTurn?.state,
        conversation.activeTurn?.updatedAt,
        conversation.currentBrief?.id,
        conversation.currentBrief?.revision,
        conversation.promotion?.id,
        conversation.promotion?.state,
        conversation.promotion?.updatedAt,
        conversation.links,
      ]),
      html: controlsHtml(conversation, messageId),
    },
    polling: conversationPollingActive(conversation),
  };
}

export function renderConversation(
  conversation: Conversation,
  user: string,
  notice?: string,
  messageId: string = crypto.randomUUID(),
): string {
  const state = renderConversationPollState(conversation, messageId);
  const script = state.polling
    ? `<script defer src="/assets/conversation-poll.js" data-state-url="/conversations/${encodeURIComponent(conversation.id)}/state"></script>`
    : "";
  return page(
    "Conversation",
    user,
    `<div class="meta"><a href="/conversations">Conversations</a> · ${escapeHtml(conversation.repository.name)} · ${escapeHtml(conversation.context.model.id)} / ${escapeHtml(conversation.context.model.reasoning)}</div><h1>Conversation</h1><p class="muted"><span class="readonly">Read only</span> Repository context is pinned to <code>${escapeHtml(conversation.sourceCommit.slice(0, 12))}</code>. The assistant can read this public snapshot and research the public web, but cannot modify anything.</p>${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ""}<div id="conversation-status" data-version="${escapeHtml(state.status.version)}" data-status-key="${escapeHtml(state.status.key)}">${state.status.html}</div><section id="conversation-messages">${state.messages.map((message) => message.html).join("")}</section><section id="conversation-controls" data-version="${escapeHtml(state.controls.version)}">${state.controls.html}</section><div id="conversation-live-status" class="sr-only" role="status" aria-live="polite"></div>`,
    script,
  );
}
