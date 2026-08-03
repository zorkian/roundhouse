// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { conversationPollClientScript } from "./conversation-client.js";

type Rectangle = { top: number; bottom: number; height: number };
type Message = {
  getAttribute(name: string): string | null;
  matches(selector: string): boolean;
  getBoundingClientRect(): Rectangle;
};

type Region = {
  innerHTML: string;
  textContent?: string;
  children: Message[];
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

function message(
  id: string,
  role: "assistant" | "user",
  version: string,
  rectangle: () => Rectangle,
): Message {
  return {
    getAttribute: (name) =>
      name === "data-message-id"
        ? id
        : name === "data-version"
          ? version
          : null,
    matches: (selector) =>
      selector === ".message.assistant" && role === "assistant",
    getBoundingClientRect: rectangle,
  };
}

async function flushPoll(scheduled: (() => void)[]): Promise<void> {
  scheduled[0]!();
  await new Promise((resolve) => setTimeout(resolve, 0));
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
    await flushPoll(scheduled);

    expect(status.innerHTML).toBe("<p>Done</p>");
    expect(controls.innerHTML).toBe("<form></form>");
    expect(live.textContent).toBe("Roundhouse finished this turn.");
    expect(scrollTo).toHaveBeenCalledWith(40, 80);
    expect(scheduled).toHaveLength(1);
  });

  it("keeps unchanged keyed messages in place", async () => {
    const messages = region("messages");
    messages.children = [
      message("message", "user", "message-version", () => ({
        top: 0,
        bottom: 50,
        height: 50,
      })),
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
    await flushPoll(scheduled);

    expect(createElement).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  function pendingResponseFixture(options: {
    responseTop: number;
    responseHeight?: number;
    role?: "assistant" | "user";
    composerTop?: number;
    polling?: boolean;
    initialBannerHidden?: boolean;
  }) {
    let responseTop = options.responseTop;
    const responseHeight = options.responseHeight ?? 200;
    const role = options.role ?? "assistant";
    const response = message("response", role, "response-version", () => ({
      top: responseTop,
      bottom: responseTop + responseHeight,
      height: responseHeight,
    }));
    const messages = region("messages") as Region & {
      appendChild(element: Message): void;
    };
    messages.appendChild = (element) => messages.children.push(element);
    const status = region("status", "turn:running");
    const controls = region("controls");
    const scheduled: (() => void)[] = [];
    const scrollListeners: (() => void)[] = [];
    let click: (() => void) | undefined;
    const newResponse = {
      hidden: options.initialBannerHidden ?? true,
      style: { bottom: "1rem" },
      addEventListener: (_event: string, handler: () => void) => {
        click = handler;
      },
    };
    const composer = {
      getBoundingClientRect: () => ({
        top: options.composerTop ?? 500,
        bottom: 600,
        height: 100,
      }),
    };
    const landing = { getAttribute: () => "composer", scrollIntoView: vi.fn() };
    const document = {
      currentScript: {
        getAttribute: (name: string) =>
          name === "data-state-url"
            ? "/conversations/id/state"
            : name === "data-polling"
              ? options.polling === false
                ? "false"
                : "true"
              : null,
      },
      documentElement: { scrollHeight: 2_000 },
      body: { scrollHeight: 0 },
      querySelector: (selector: string) =>
        selector === ".composer" ? composer : landing,
      getElementById: (id: string) => {
        if (id === "conversation-new-response") return newResponse;
        const elements: Record<string, Region> = {
          "conversation-messages": messages,
          "conversation-status": status,
          "conversation-controls": controls,
        };
        return elements[id] ?? null;
      },
      createElement: () => ({ content: { firstElementChild: response } }),
    };
    const window = {
      scrollX: 0,
      scrollY: 100,
      innerHeight: 600,
      scrollTo: vi.fn(),
      setTimeout: (callback: () => void) => scheduled.push(callback),
      addEventListener: (_event: string, handler: () => void) =>
        scrollListeners.push(handler),
    };
    const fetch = async () => ({
      ok: true,
      json: async () => ({
        messages: [
          {
            id: "response",
            version: "response-version",
            html: `<article class="message ${role}" data-message-id="response"></article>`,
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
    return {
      click: () => click!(),
      document,
      fetch,
      landing,
      newResponse,
      responseTop: (top: number) => {
        responseTop = top;
      },
      scheduled,
      scrollListeners,
      window,
    };
  }

  it("does not show the banner when an appended response begins in the readable area", async () => {
    const fixture = pendingResponseFixture({ responseTop: 100 });
    new Function(
      "document",
      "window",
      "fetch",
      "console",
      conversationPollClientScript,
    )(fixture.document, fixture.window, fixture.fetch, {
      log: () => undefined,
    });
    await flushPoll(fixture.scheduled);

    expect(fixture.newResponse.hidden).toBe(true);
  });

  it("shows the banner for an appended response below the readable area", async () => {
    const fixture = pendingResponseFixture({ responseTop: 550 });
    new Function(
      "document",
      "window",
      "fetch",
      "console",
      conversationPollClientScript,
    )(fixture.document, fixture.window, fixture.fetch, {
      log: () => undefined,
    });
    await flushPoll(fixture.scheduled);

    expect(fixture.newResponse.hidden).toBe(false);
    expect(fixture.newResponse.style.bottom).toBe("116px");
  });

  it("permanently dismisses a pending response after its beginning becomes visible", async () => {
    const fixture = pendingResponseFixture({ responseTop: 550 });
    new Function(
      "document",
      "window",
      "fetch",
      "console",
      conversationPollClientScript,
    )(fixture.document, fixture.window, fixture.fetch, {
      log: () => undefined,
    });
    await flushPoll(fixture.scheduled);

    fixture.responseTop(300);
    fixture.scrollListeners[0]!();
    expect(fixture.newResponse.hidden).toBe(true);

    fixture.responseTop(700);
    fixture.scrollListeners[0]!();
    expect(fixture.newResponse.hidden).toBe(true);
  });

  it("scrolls from the banner to the pending response with breathing room above it", async () => {
    const fixture = pendingResponseFixture({ responseTop: 550 });
    new Function(
      "document",
      "window",
      "fetch",
      "console",
      conversationPollClientScript,
    )(fixture.document, fixture.window, fixture.fetch, {
      log: () => undefined,
    });
    await flushPoll(fixture.scheduled);

    fixture.click();

    expect(fixture.newResponse.hidden).toBe(true);
    expect(fixture.window.scrollTo).toHaveBeenLastCalledWith({
      top: 626,
      behavior: "smooth",
    });
    expect(fixture.landing.scrollIntoView).toHaveBeenCalledOnce();
  });

  it("does not show the response banner for a non-assistant append", async () => {
    const fixture = pendingResponseFixture({ responseTop: 550, role: "user" });
    new Function(
      "document",
      "window",
      "fetch",
      "console",
      conversationPollClientScript,
    )(fixture.document, fixture.window, fixture.fetch, {
      log: () => undefined,
    });
    await flushPoll(fixture.scheduled);

    expect(fixture.newResponse.hidden).toBe(true);
  });

  it("follows an appended assistant response when the reader is near the bottom", async () => {
    const fixture = pendingResponseFixture({ responseTop: 550 });
    fixture.window.scrollY = 1_300;
    new Function(
      "document",
      "window",
      "fetch",
      "console",
      conversationPollClientScript,
    )(fixture.document, fixture.window, fixture.fetch, {
      log: () => undefined,
    });
    await flushPoll(fixture.scheduled);

    expect(fixture.landing.scrollIntoView).toHaveBeenCalledTimes(2);
    expect(fixture.newResponse.hidden).toBe(true);
  });

  it("keeps the banner hidden when a completed conversation is opened", () => {
    const fixture = pendingResponseFixture({
      responseTop: 550,
      polling: false,
      initialBannerHidden: false,
    });
    new Function(
      "document",
      "window",
      "fetch",
      "console",
      conversationPollClientScript,
    )(fixture.document, fixture.window, fixture.fetch, {
      log: () => undefined,
    });

    expect(fixture.newResponse.hidden).toBe(true);
    expect(fixture.scheduled).toHaveLength(0);
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
    await flushPoll(scheduled);

    expect(scheduled).toHaveLength(2);
  });
});
