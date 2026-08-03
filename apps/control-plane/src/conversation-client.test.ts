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
      currentScript: {
        getAttribute: (name: string) =>
          name === "data-state-url"
            ? "/conversations/id/state"
            : name === "data-polling"
              ? "true"
              : null,
      },
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

  it("keeps unchanged keyed messages in place", async () => {
    const messages = region("messages");
    messages.children = [
      {
        getAttribute: (name) =>
          name === "data-message-id"
            ? "message"
            : name === "data-version"
              ? "message-version"
              : null,
      },
    ];
    const status = region("status-version", "turn:running");
    const controls = region("controls-version");
    const scheduled: (() => void)[] = [];
    const createElement = vi.fn();
    const document = {
      currentScript: {
        getAttribute: (name: string) =>
          name === "data-state-url"
            ? "/conversations/id/state"
            : name === "data-polling"
              ? "true"
              : null,
      },
      getElementById: (id: string) => {
        const elements: Record<string, Region> = {
          "conversation-messages": messages,
          "conversation-status": status,
          "conversation-controls": controls,
        };
        return elements[id] ?? null;
      },
      createElement,
    };
    const window = {
      scrollX: 0,
      scrollY: 0,
      scrollTo: vi.fn(),
      setTimeout: (callback: () => void) => scheduled.push(callback),
    };
    const fetch = async () => ({
      ok: true,
      json: async () => ({
        messages: [
          {
            id: "message",
            version: "message-version",
            html: '<article data-message-id="message"></article>',
          },
        ],
        status: {
          version: "status-version",
          html: "<p>Working</p>",
          key: "turn:running",
          announcement: "Roundhouse is working.",
        },
        controls: { version: "controls-version", html: "<p>Working</p>" },
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
    scheduled[0]!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createElement).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("follows an appended assistant response when the reader is near the bottom", async () => {
    const messages = region("messages") as Region & {
      appendChild(element: unknown): void;
      lastElementChild?: unknown;
    };
    const appended: unknown[] = [];
    messages.appendChild = (element) => appended.push(element);
    const status = region("status", "turn:running");
    const controls = region("controls");
    const target = { getAttribute: () => "working", scrollIntoView: vi.fn() };
    const scheduled: (() => void)[] = [];
    const document = {
      currentScript: {
        getAttribute: (name: string) =>
          name === "data-state-url"
            ? "/conversations/id/state"
            : name === "data-polling"
              ? "true"
              : null,
      },
      documentElement: { scrollHeight: 1_000 },
      body: { scrollHeight: 0 },
      querySelector: () => target,
      getElementById: (id: string) => {
        const elements: Record<string, Region> = {
          "conversation-messages": messages,
          "conversation-status": status,
          "conversation-controls": controls,
        };
        return elements[id] ?? null;
      },
      createElement: () => ({
        content: {
          firstElementChild: { getAttribute: () => null },
        },
      }),
    };
    const window = {
      scrollX: 0,
      scrollY: 300,
      innerHeight: 600,
      scrollTo: vi.fn(),
      setTimeout: (callback: () => void) => scheduled.push(callback),
    };
    const fetch = async () => ({
      ok: true,
      json: async () => ({
        messages: [
          {
            id: "assistant",
            version: "assistant-version",
            html: '<article class="message assistant" data-message-id="assistant"></article>',
          },
        ],
        status: {
          version: "status",
          html: "",
          key: "turn:running",
          announcement: "Roundhouse is working.",
        },
        controls: { version: "controls", html: "" },
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
    scheduled[0]!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appended).toHaveLength(1);
    expect(target.scrollIntoView).toHaveBeenCalledTimes(2);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("preserves a reading anchor and exposes the new-response control", async () => {
    let top = 50;
    const anchor = {
      getAttribute: (name: string) =>
        name === "data-message-id"
          ? "older"
          : name === "data-version"
            ? "older-version"
            : null,
      getBoundingClientRect: () => ({ top, bottom: top + 50 }),
    };
    const messages = region("messages") as Region & {
      appendChild(element: unknown): void;
    };
    messages.children = [anchor];
    messages.appendChild = () => {
      top = 70;
    };
    const status = region("status", "turn:running");
    const controls = region("controls");
    let click: (() => void) | undefined;
    const newResponse = {
      hidden: true,
      style: { bottom: "1rem" },
      addEventListener: (_event: string, handler: () => void) => {
        click = handler;
      },
    };
    const target = { getAttribute: () => "composer", scrollIntoView: vi.fn() };
    const composer = {
      getBoundingClientRect: () => ({ height: 220 }),
    };
    const scheduled: (() => void)[] = [];
    const document = {
      currentScript: {
        getAttribute: (name: string) =>
          name === "data-state-url"
            ? "/conversations/id/state"
            : name === "data-polling"
              ? "true"
              : null,
      },
      documentElement: { scrollHeight: 2_000 },
      body: { scrollHeight: 0 },
      querySelector: (selector: string) =>
        selector === ".composer" ? composer : target,
      getElementById: (id: string) => {
        if (id === "conversation-new-response") return newResponse;
        const elements: Record<string, Region> = {
          "conversation-messages": messages,
          "conversation-status": status,
          "conversation-controls": controls,
        };
        return elements[id] ?? null;
      },
      createElement: () => ({
        content: { firstElementChild: { getAttribute: () => null } },
      }),
    };
    const window = {
      scrollX: 0,
      scrollY: 100,
      innerHeight: 600,
      scrollTo: vi.fn(),
      setTimeout: (callback: () => void) => scheduled.push(callback),
    };
    const fetch = async () => ({
      ok: true,
      json: async () => ({
        messages: [
          {
            id: "user",
            version: "user-version",
            html: '<article class="message user" data-message-id="user"></article>',
          },
        ],
        status: {
          version: "status",
          html: "",
          key: "turn:running",
          announcement: "Roundhouse is working.",
        },
        controls: { version: "controls", html: "" },
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
    scheduled[0]!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.scrollTo).toHaveBeenCalledWith(0, 120);
    expect(newResponse.hidden).toBe(false);
    expect(newResponse.style.bottom).toBe("236px");
    click!();
    expect(newResponse.hidden).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("initializes positioning without polling inactive conversations", () => {
    const messages = region("messages");
    const status = region("status", "turn:succeeded");
    const controls = region("controls");
    const target = { getAttribute: () => "delivery", scrollIntoView: vi.fn() };
    const scheduled: (() => void)[] = [];
    const document = {
      currentScript: {
        getAttribute: (name: string) =>
          name === "data-state-url" ? "/conversations/id/state" : "false",
      },
      querySelector: () => target,
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
      innerHeight: 600,
      scrollTo: vi.fn(),
      setTimeout: (callback: () => void) => scheduled.push(callback),
    };
    new Function(
      "document",
      "window",
      "fetch",
      "console",
      conversationPollClientScript,
    )(document, window, () => Promise.resolve(undefined), {
      log: () => undefined,
    });
    expect(target.scrollIntoView).toHaveBeenCalledOnce();
    expect(scheduled).toHaveLength(0);
  });

  it("continues polling after a failed request", async () => {
    const messages = region("messages");
    const status = region("active-status", "turn:running");
    const controls = region("active-controls");
    const scheduled: (() => void)[] = [];
    const document = {
      currentScript: {
        getAttribute: (name: string) =>
          name === "data-state-url"
            ? "/conversations/id/state"
            : name === "data-polling"
              ? "true"
              : null,
      },
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
