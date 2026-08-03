// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import {
  renderSiteHeader,
  sharedHeaderStyles,
  type HeaderAccount,
} from "./ui-header.js";
import { statusPillStyles, type StatusTone } from "./status-ui.js";
import type {
  Conversation,
  ConversationRepositoryRef,
  ConversationSummary,
  DeliveryBrief,
} from "./conversation-store.js";
import { renderSafeMarkdown } from "./safe-markdown.js";

const escapeHtml = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const styles = `<style>${sharedHeaderStyles}:root{color-scheme:light;--ink:#18212f;--muted:#647084;--line:#dde3ea;--paper:#fff;--wash:#f4f7fa;--brand:#175cd3;--warn:#8a5b00}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}a{color:inherit}main{max-width:900px;margin:0 auto;padding:1.5rem 1.25rem 4rem}.card,.message{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:1rem 1.2rem;margin-bottom:1rem}h1{margin:0;font-size:1.8rem}h2{font-size:1.1rem;margin:.2rem 0 .8rem}h3{font-size:1rem;margin:1rem 0 .3rem}.muted,.meta{color:var(--muted)}label{display:block;font-weight:650;margin:.8rem 0 .3rem}textarea,input,select{width:100%;font:inherit;border:1px solid #b8c2cf;border-radius:8px;padding:.65rem;background:white}textarea{min-height:110px}button,.button{display:inline-block;border:0;border-radius:8px;background:#18212f;color:white;padding:.65rem 1rem;font:inherit;font-weight:650;text-decoration:none;cursor:pointer;margin-top:.8rem}button.promote,.button.promote{background:var(--brand)}button[disabled]{opacity:.55;cursor:not-allowed}.message-body{overflow-wrap:anywhere}.message-body>*:first-child{margin-top:0}.message-body>*:last-child{margin-bottom:0}.message-body p{margin:.65rem 0}.message-body h1,.message-body h2,.message-body h3,.message-body h4,.message-body h5,.message-body h6{line-height:1.25}.message-body h1{font-size:1.45rem;margin:1rem 0 .5rem}.message-body h2{font-size:1.25rem;margin:1rem 0 .5rem}.message-body h3,.message-body h4,.message-body h5,.message-body h6{font-size:1rem;margin:1rem 0 .4rem}.message-body ul,.message-body ol{margin:.65rem 0;padding-left:1.4rem}.message-body a{color:var(--brand);overflow-wrap:anywhere}.message-body code{background:#edf1f5;border-radius:4px;padding:.1rem .25rem;font:85%/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.message-body pre{max-width:100%;overflow-x:auto;overflow-wrap:normal;background:#18212f;color:#f4f7fa;border-radius:8px;padding:.8rem;white-space:pre}.message-body pre code{background:transparent;color:inherit;padding:0;white-space:pre}.message-body blockquote{border-left:3px solid #b8c2cf;margin:.65rem 0;padding-left:.8rem;color:var(--muted)}.message.user{margin-left:12%}.message.assistant{margin-right:12%;border-left:4px solid #7589a3}.message .meta{font-size:.78rem;margin-bottom:.45rem;white-space:normal}.conversation{display:flex;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--line);padding:.8rem 0}.conversation:last-child{border:0}.conversation-meta{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;margin-top:.2rem;font-size:.78rem;color:var(--muted)}${statusPillStyles}.actions{display:flex;gap:.65rem;flex-wrap:wrap}.notice{background:#fff4d6;border:1px solid #f3d27c;border-radius:8px;padding:.8rem;margin-bottom:1rem}.readonly{display:inline-block;border:1px solid #a9b5c4;border-radius:999px;padding:.2rem .55rem;font-size:.78rem;font-weight:650}.brief-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 1rem}.brief-grid .wide{grid-column:1/-1}.brief-body{min-height:360px}.waiting{color:var(--warn)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:650px){header{display:block}.message.user,.message.assistant{margin-left:0;margin-right:0}.brief-grid{display:block}.brief-body{min-height:280px}}</style>`;
function page(
  title: string,
  user: HeaderAccount | string,
  body: string,
  script = "",
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)} · Roundhouse</title>${styles}</head><body>${renderSiteHeader(typeof user === "string" ? { githubLogin: user } : user)}<main>${body}</main>${script}</body></html>`;
}

export interface ActionableConversationStatus {
  readonly label: string;
  readonly tone: StatusTone;
}

type ConversationStatusInput = Pick<ConversationSummary, "status"> & {
  readonly promotionState?: ConversationSummary["promotionState"];
  readonly promotionRunStatus?: ConversationSummary["promotionRunStatus"];
  readonly currentBriefState?: ConversationSummary["currentBriefState"];
  readonly activeTurnState?: ConversationSummary["latestTurnState"];
  readonly latestTurnState?: ConversationSummary["latestTurnState"];
};

export function actionableConversationStatus(
  conversation: ConversationStatusInput,
): ActionableConversationStatus {
  switch (conversation.promotionState) {
    case "requested":
      return { label: "Preparing delivery", tone: "active" };
    case "issue_created":
      return { label: "Starting delivery", tone: "active" };
    case "awaiting_intake":
      return { label: "Waiting to start delivery", tone: "waiting" };
    case "accepted":
      return conversation.promotionRunStatus === "succeeded"
        ? { label: "Delivery complete", tone: "succeeded" }
        : { label: "Delivery started", tone: "active" };
    case "rejected":
      return { label: "Delivery not accepted", tone: "failed" };
    case undefined:
      break;
  }
  if (conversation.status === "handoff_pending")
    return { label: "Preparing delivery", tone: "active" };
  if (conversation.status === "promoted")
    return { label: "Delivery started", tone: "active" };
  if (conversation.currentBriefState === "draft")
    return { label: "Delivery brief ready for review", tone: "waiting" };
  if (conversation.activeTurnState)
    return { label: "Roundhouse is working", tone: "active" };
  if (conversation.latestTurnState === "failed")
    return { label: "Needs attention", tone: "failed" };
  return { label: "Waiting for your response", tone: "waiting" };
}

function isConversation(
  conversation: Conversation | ConversationSummary,
): conversation is Conversation {
  return typeof conversation.repository !== "string";
}

function conversationStatus(
  conversation: Conversation | ConversationSummary,
): ActionableConversationStatus {
  if (isConversation(conversation))
    return actionableConversationStatus({
      status: conversation.status,
      promotionState: conversation.promotion?.state,
      promotionRunStatus: conversation.promotion?.runStatus,
      currentBriefState: conversation.currentBrief?.state,
      activeTurnState: conversation.activeTurn?.state,
      latestTurnState: conversation.latestTurn?.state,
    });
  return actionableConversationStatus({
    status: conversation.status,
    promotionState: conversation.promotionState,
    promotionRunStatus: conversation.promotionRunStatus,
    currentBriefState: conversation.currentBriefState,
    activeTurnState: conversation.activeTurn?.state,
    latestTurnState: conversation.latestTurnState,
  });
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
  user: HeaderAccount | string,
  error?: string,
  messageId = crypto.randomUUID(),
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

function briefEditor(conversation: Conversation, brief: DeliveryBrief): string {
  return `<section class="card"><h2>Review and edit delivery brief</h2><p class="muted">The exact Markdown below will be published to a new GitHub issue. Editing it does not invoke the agent.</p><form method="post" action="/conversations/${encodeURIComponent(conversation.id)}/promote"><input type="hidden" name="brief_id" value="${escapeHtml(brief.id)}"><label for="title">Issue title</label><input id="title" name="title" maxlength="100" value="${escapeHtml(brief.title)}" required><label for="body">Issue body (Markdown)</label><textarea class="brief-body" id="body" name="body">${escapeHtml(brief.body)}</textarea><button class="promote" type="submit">Start delivery</button></form><p class="muted">Roundhouse will create one issue, post the normal start command, and wait for GitHub intake to accept the run before closing this conversation.</p></section>`;
}

function openControls(conversation: Conversation, messageId: string): string {
  if (conversation.activeTurn)
    return `<section class="card"><h2 class="waiting">Roundhouse is working…</h2><p class="muted">This turn is durable. You can leave this page and return later.</p></section>`;
  const composer = `<section class="card"><form method="post" action="/conversations/${encodeURIComponent(conversation.id)}/messages"><input type="hidden" name="message_id" value="${escapeHtml(messageId)}"><label for="message">Continue the conversation</label><textarea id="message" name="message" maxlength="12000"></textarea><div class="actions"><button type="submit">Send</button><button class="promote" type="submit" formaction="/conversations/${encodeURIComponent(conversation.id)}/brief">Prepare delivery brief</button></div></form><p class="muted">Prepare uses your optional answer and the conversation so far. You can review the exact issue brief before starting delivery.</p></section>`;
  return conversation.currentBrief?.state === "draft"
    ? `${briefEditor(conversation, conversation.currentBrief)}${composer}`
    : composer;
}

function promotionControls(conversation: Conversation): string {
  const promotion = conversation.promotion;
  if (!promotion) return "";
  const issue = promotion.issueUrl
    ? `<p><a class="button promote" href="${escapeHtml(promotion.issueUrl)}">Open GitHub issue #${promotion.issueNumber}</a></p>`
    : "";
  const run = conversation.links.find((link) => link.kind === "roundhouse.run");
  if (promotion.state === "accepted" || conversation.status === "promoted")
    return `<section class="card">${issue}${run ? `<p><a class="button" href="${escapeHtml(run.url)}">Open Roundhouse run</a></p>` : ""}</section>`;
  if (promotion.state === "rejected")
    return `<section class="card">${issue}<p class="notice">${escapeHtml(promotion.errorCode ?? "GitHub intake rejected this promotion")}. This conversation has not been marked delivered.</p></section>`;
  if (promotion.state === "awaiting_intake")
    return `<section class="card">${issue}<p class="muted">The issue and start comment exist. This conversation will close only after the normal GitHub webhook authorizes the actor and records the run.</p></section>`;
  return `<section class="card">${issue}<p class="muted">This operation is durable and reconciles existing GitHub writes before retrying.</p></section>`;
}

function messageVersion(message: Conversation["messages"][number]): string {
  return version([message.id, message.createdAt]);
}

function messageHtml(message: Conversation["messages"][number]): string {
  return `<article class="message ${message.role}" data-message-id="${escapeHtml(message.id)}" data-version="${escapeHtml(messageVersion(message))}"><div class="meta">${message.role === "user" ? escapeHtml(message.actorLogin) : "Roundhouse"}</div><div class="message-body">${renderSafeMarkdown(message.body)}</div></article>`;
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
  const status = conversationStatus(conversation);
  const failure =
    conversation.latestTurn?.state === "failed"
      ? `<div class="notice">Roundhouse could not complete the last ${conversation.latestTurn.kind === "brief" ? "delivery brief" : "reply"}. You can try again or continue the conversation.</div>`
      : "";
  return `<p><span class="status ${status.tone}">${escapeHtml(status.label)}</span></p>${failure}`;
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
  readonly messages: readonly {
    readonly id: string;
    readonly version: string;
    readonly html: string;
  }[];
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
      version: messageVersion(message),
      html: messageHtml(message),
    })),
    status: {
      version: version([
        key,
        conversation.status,
        conversation.latestTurn?.updatedAt,
        conversation.promotion?.updatedAt,
      ]),
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
        conversation.currentBrief?.state,
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
  user: HeaderAccount | string,
  notice?: string,
  messageId: string = crypto.randomUUID(),
): string {
  const startedAt = Date.now();
  const state = renderConversationPollState(conversation, messageId);
  const script = state.polling
    ? `<script defer src="/assets/conversation-poll.js" data-state-url="/conversations/${encodeURIComponent(conversation.id)}/state"></script>`
    : "";
  const rendered = page(
    "Conversation",
    user,
    `<div class="meta"><a href="/conversations">Conversations</a> · ${escapeHtml(conversation.repository.name)} · ${escapeHtml(conversation.context.model.id)} / ${escapeHtml(conversation.context.model.reasoning)}</div><h1>Conversation</h1><p class="muted"><span class="readonly">Read only</span> Repository context is pinned to <code>${escapeHtml(conversation.sourceCommit.slice(0, 12))}</code>. The assistant can read this public snapshot and research the public web, but cannot modify anything.</p>${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ""}<div id="conversation-status" data-version="${escapeHtml(state.status.version)}" data-status-key="${escapeHtml(state.status.key)}">${state.status.html}</div><section id="conversation-messages">${state.messages.map((message) => message.html).join("")}</section><section id="conversation-controls" data-version="${escapeHtml(state.controls.version)}">${state.controls.html}</section><div id="conversation-live-status" class="sr-only" role="status" aria-live="polite"></div>`,
    script,
  );
  console.log(
    JSON.stringify({
      message: "conversation_markdown_rendered",
      conversationId: conversation.id,
      messageCount: conversation.messages.length,
      durationMs: Date.now() - startedAt,
    }),
  );
  return rendered;
}
