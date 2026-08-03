// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { Marked } from "marked";

const escapeHtml = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const markdownLinkProtocols = new Set(["http:", "https:", "mailto:"]);

function safeMarkdownLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    return markdownLinkProtocols.has(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const safeMarkdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      const destination = safeMarkdownLink(href);
      return destination
        ? `<a href="${escapeHtml(destination)}" target="_blank" rel="noopener noreferrer">${text}</a>`
        : text;
    },
    image({ text }) {
      return escapeHtml(text);
    },
  },
});

export function renderSafeMarkdown(value: string): string {
  return safeMarkdown.parse(value, { async: false });
}
