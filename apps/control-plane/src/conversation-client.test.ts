// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { conversationPollClientScript } from "./conversation-client.js";

type Region = {
  innerHTML: string;
  textContent?: string;
  children: { getAttribute(name: string): string | null }[];
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
};

function region(version: string, key?: string): Region {
  const attributes = new Map<string, string>([["data-version", version]]);
  if (key) attributes.set("data-status-key", key);
  return {
    innerHTML: "",
    children: [],
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
  };
}

describe("conversation polling client", () => {
  it("reconciles only keyed regions, preserves scroll, announces status, and stops at terminal state", async () => {
    const messages = region("messages");
    const status = region("active-status", "turn:running");
    const controls = region("active-controls");
    const live = region("live");
    const scheduled: (() => void)[] = [];
    const scrollTo = vi.fn();
    const document = {
      currentScript: { getAttribute: () => "/conversations/id/state" },
      getElementById: (id: string) => {
        const elements: Record<string, Region> = {
          "conversation-messages": messages,
          "conversation-status": status,
          "conversation-controls": controls,
          "conversation-live-status": live,
        };
        return elements[id] ?? null;
      },
      createElement: () => ({ content: { firstElementChild: null } }),
    };
    const window = {
      scrollX: 40,
      scrollY: 80,
      scrollTo,
      setTimeout: (callback: () => void) => scheduled.push(callback),
    };
    const fetch = async () => ({
      ok: true,
      json: async () => ({
        messages: [],
        status: {
          version: "terminal-status",
          html: "<p>Done</p>",
          key: "turn:succeeded",
          announcement: "Roundhouse finished this turn.",
        },
        controls: { version: "terminal-controls", html: "<form></form>" },
        polling: false,
      }),
    });

    new Function(
      "document",
      "window",
      "fetch",
      "console",
      conversationPollClientScript,
    )(document, window, fetch, { log: () => undefined });
    expect(scheduled).toHaveLength(1);
    scheduled[0]!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(status.innerHTML).toBe("<p>Done</p>");
    expect(controls.innerHTML).toBe("<form></form>");
    expect(live.textContent).toBe("Roundhouse finished this turn.");
    expect(scrollTo).toHaveBeenCalledWith(40, 80);
    expect(scheduled).toHaveLength(1);
  });

  it("continues polling after a failed request", async () => {
    const messages = region("messages");
    const status = region("active-status", "turn:running");
    const controls = region("active-controls");
    const scheduled: (() => void)[] = [];
    const document = {
      currentScript: { getAttribute: () => "/conversations/id/state" },
      getElementById: (id: string) => {
        const elements: Record<string, Region> = {
          "conversation-messages": messages,
          "conversation-status": status,
          "conversation-controls": controls,
        };
        return elements[id] ?? null;
      },
      createElement: () => ({ content: { firstElementChild: null } }),
    };
    const window = {
      scrollX: 0,
      scrollY: 0,
      scrollTo: vi.fn(),
      setTimeout: (callback: () => void) => scheduled.push(callback),
    };
    const fetch = async () => {
      throw new Error("temporary failure");
    };

    new Function(
      "document",
      "window",
      "fetch",
      "console",
      conversationPollClientScript,
    )(document, window, fetch, { log: () => undefined });
    scheduled[0]!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scheduled).toHaveLength(2);
  });
});
