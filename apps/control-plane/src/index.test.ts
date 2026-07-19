// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  attemptAllowedHosts,
  RoundhouseAttemptContainer,
} from "./attempt-container.js";
import {
  controlPlaneService,
  handleRequest,
  recoverExpiredAttempts,
  scheduleAttemptContainerDestruction,
  successorWakeup,
} from "./index.js";
import worker from "./index.js";
import type { D1Like } from "./d1-store.js";

function detailsDb(found = true): D1Like {
  return {
    prepare(sql: string) {
      const statement = {
        bind: (..._values: unknown[]) => statement,
        first: async () =>
          found
            ? {
                document_json: JSON.stringify({
                  schemaVersion: 2,
                  id: "run_1",
                  repository: "zorkian/roundhouse",
                  issueNumber: 281,
                  baseCommit: "base",
                  currentHead: "head",
                  profileVersion: "v2",
                  status: "succeeded",
                  stage: "merge",
                  revision: 1,
                }),
                created_at: 1,
                updated_at: 2,
              }
            : null,
        run: async () => ({ meta: {} }),
        all: async () => ({
          meta: {},
          results: sql.includes("FROM attempts") ? [] : undefined,
        }),
      };
      return statement as unknown as ReturnType<D1Like["prepare"]>;
    },
  };
}

function dashboardDb(): D1Like {
  return {
    prepare() {
      const statement = {
        bind: (..._values: unknown[]) => statement,
        first: async () => null,
        run: async () => ({ meta: {} }),
        all: async () => ({ meta: {}, results: [] }),
      };
      return statement as unknown as ReturnType<D1Like["prepare"]>;
    },
  };
}

describe("V2 control plane", () => {
  it("serves the operational dashboard at the root", async () => {
    const fetch = worker.fetch as unknown as (
      request: Request,
      env: unknown,
      context: unknown,
    ) => Promise<Response>;
    const response = await fetch(
      new Request("https://v2.invalid/"),
      { DB: dashboardDb() } as never,
      {} as never,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    await expect(response.text()).resolves.toContain(
      "Development runs across enrolled repositories",
    );
  });

  it("reports a small versioned health contract", async () => {
    const response = handleRequest(new Request("https://v2.invalid/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 2,
      ok: true,
      service: controlPlaneService,
    });
  });

  it("reconciles immediate successor wakeups through review", () => {
    const processed = { runId: "run_1", expectedRevision: 1 };
    const run = {
      schemaVersion: 2,
      id: "run_1",
      repository: "zorkian/roundhouse",
      issueNumber: 1,
      baseCommit: "a".repeat(40),
      currentHead: "a".repeat(40),
      profileVersion: "v2",
      status: "active",
      stage: "reproduce",
      revision: 2,
    } as const;
    expect(successorWakeup(run, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, stage: "plan" }, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, stage: "implement" }, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, stage: "review" }, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, stage: "ci" }, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, stage: "merge" }, processed)).toEqual({
      runId: "run_1",
      expectedRevision: 2,
    });
    expect(successorWakeup({ ...run, revision: 3 }, processed)).toBeUndefined();
  });

  it("does not expose undeclared routes or methods", async () => {
    const missing = handleRequest(new Request("https://v2.invalid/v1/runs"));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: "not_found" });

    const mutation = handleRequest(
      new Request("https://v2.invalid/health", { method: "POST" }),
    );
    expect(mutation.status).toBe(405);
    expect(mutation.headers.get("allow")).toBe("GET");
  });

  it("serves run details and handles unknown, malformed, and non-GET routes", async () => {
    const fetch = worker.fetch as unknown as (
      request: Request,
      env: unknown,
      context: unknown,
    ) => Promise<Response>;
    const html = await fetch(
      new Request(
        "https://v2.invalid/repositories/zorkian/roundhouse/issues/281",
      ),
      { DB: detailsDb() } as never,
      {} as never,
    );
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
    await expect(html.text()).resolves.toContain("Roundhouse run details");

    const missing = await fetch(
      new Request(
        "https://v2.invalid/repositories/zorkian/roundhouse/issues/999",
      ),
      { DB: detailsDb(false) } as never,
      {} as never,
    );
    expect(missing.status).toBe(404);

    const malformed = await fetch(
      new Request(
        "https://v2.invalid/repositories/%E0%A4%A/roundhouse/issues/281",
      ),
      { DB: detailsDb() } as never,
      {} as never,
    );
    expect(malformed.status).toBe(404);

    const mutation = await fetch(
      new Request(
        "https://v2.invalid/repositories/zorkian/roundhouse/issues/281",
        {
          method: "POST",
        },
      ),
      { DB: detailsDb() } as never,
      {} as never,
    );
    expect(mutation.status).toBe(405);
    expect(mutation.headers.get("allow")).toBe("GET");
  });

  it("registers the private model egress handler with the Containers SDK", () => {
    expect(
      RoundhouseAttemptContainer.outboundByHost?.["model.roundhouse.internal"],
    ).toBeTypeOf("function");
  });

  it("allows only required attempt services and the package registry", () => {
    expect(
      attemptAllowedHosts(
        {
          artifact: {
            remote: "https://artifacts.test/repository.git",
            hostname: "artifacts.test",
          },
          publish: { hostname: "github.com" },
        },
        "https://control.test/attempts/callback",
      ),
    ).toEqual([
      "model.roundhouse.internal",
      "registry.npmjs.org",
      "artifacts.test",
      "github.com",
      "control.test",
    ]);
  });

  it("destroys an inactive sandbox before redispatching its stage", async () => {
    const events: string[] = [];
    const wakeup = { runId: "run_1", expectedRevision: 3 };
    await recoverExpiredAttempts(
      {
        idFromName: (name: string) => name,
        get: (id: unknown) => ({
          destroy: async () => {
            events.push(`destroy:${String(id)}`);
          },
          fetch: async () => new Response(),
        }),
      },
      [wakeup],
      async (next) => {
        events.push(`enqueue:${next.runId}:${next.expectedRevision}`);
      },
    );
    expect(events).toEqual(["destroy:run_1_rev_3", "enqueue:run_1:3"]);
  });

  it("schedules completed sandbox destruction by immutable attempt id", async () => {
    const events: string[] = [];
    const scheduled: Promise<unknown>[] = [];
    scheduleAttemptContainerDestruction(
      {
        idFromName: (name: string) => `id:${name}`,
        get: (id: unknown) => ({
          destroy: async () => {
            events.push(`destroy:${String(id)}`);
          },
          fetch: async () => new Response(),
        }),
      },
      "run_1_rev_4",
      {
        waitUntil: (promise) => {
          scheduled.push(promise);
        },
      },
    );
    expect(scheduled).toHaveLength(1);
    await Promise.all(scheduled);
    expect(events).toEqual(["destroy:id:run_1_rev_4"]);
  });
});
