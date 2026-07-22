// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import type { Browser } from "puppeteer-core";
import puppeteer from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunDetails } from "./d1-store.js";
import { D1RunRepository, type D1Like } from "./d1-store.js";
import { renderRunDetails } from "./run-details.js";

describe("run details", () => {
  it("assembles the current run and chronological attempts by repository issue", async () => {
    // Multi-repository enrollment stores the numeric GitHub repository ID in
    // github_id and keeps the owner/name in the profile metadata, so the
    // stub only matches when the query looks the name up in that metadata.
    const enrolledGithubId = "1297678423";
    const enrolledRepository = "zorkian/roundhouse";
    const enrolledIssueNumber = 281;
    const calls: { sql: string; values: unknown[] }[] = [];
    const db: D1Like = {
      prepare(sql: string) {
        const call = { sql, values: [] as unknown[] };
        calls.push(call);
        const statement = {
          bind: (...values: unknown[]) => {
            call.values = values;
            return statement;
          },
          first: async () => {
            const [repository, issueNumber] = call.values;
            const matchesRepository = sql.includes("github_id")
              ? repository === enrolledGithubId
              : repository === enrolledRepository;
            if (!matchesRepository || issueNumber !== enrolledIssueNumber)
              return null;
            return {
              document_json: JSON.stringify({
                schemaVersion: 2,
                id: "current-run",
                repository: "zorkian/roundhouse",
                issueNumber: 281,
                baseCommit: "base",
                currentHead: "head",
                profileVersion: "v2",
                status: "active",
                stage: "review",
                revision: 4,
              }),
              created_at: 10,
              updated_at: 20,
            };
          },
          all: async () => {
            if (sql.includes("FROM model_usage"))
              return {
                meta: {},
                results: [
                  {
                    call_id: "call-1",
                    attempt_id: "first",
                    model: "model-a",
                    provider: "openai",
                    configured_model: "model-a",
                    routing_rule: "qualification-default-v1",
                    input_tokens: null,
                    cached_input_tokens: null,
                    cache_creation_input_tokens: null,
                    reasoning_tokens: null,
                    output_tokens: null,
                    total_tokens: 10,
                    cost_usd: null,
                    created_at: 15,
                  },
                ],
              };
            if (sql.includes("FROM events"))
              return {
                meta: {},
                results: [
                  {
                    attempt_id: "first",
                    kind: "attempt_progress",
                    payload_json: '{"phase":"workspace_started"}',
                    created_at: 13,
                  },
                ],
              };
            return {
              meta: {},
              results: [
                {
                  id: "first",
                  run_id: "current-run",
                  run_revision: 1,
                  kind: "agent",
                  stage: "qualify",
                  role: "qualifier",
                  state: "completed",
                  deadline_at: 9,
                  base_commit: "base",
                  expected_head: "base",
                  accepted_head: null,
                  result_json: '{"qualification":{"summary":"ok"}}',
                  routing_json:
                    '{"provider":"openai","model":"model-a","protocol":"openai-responses","thinkingLevel":"low","rule":"qualification-default-v1"}',
                  created_at: 11,
                  updated_at: 12,
                },
              ],
            };
          },
          run: async () => ({ meta: {} }),
        };
        return statement as unknown as ReturnType<D1Like["prepare"]>;
      },
    };
    const details = await new D1RunRepository(db).detailsByIssue(
      "zorkian/roundhouse",
      281,
    );
    expect(calls[0]?.sql).toContain("profile_json");
    expect(calls[0]?.sql).not.toContain("github_id");
    expect(calls[0]?.values).toEqual(["zorkian/roundhouse", 281]);
    expect(calls[1]?.sql).toContain("ORDER BY created_at ASC,id ASC");
    expect(calls[1]?.values).toEqual(["current-run"]);
    expect(details).toMatchObject({
      run: { id: "current-run" },
      createdAt: 10,
      updatedAt: 20,
      attempts: [
        {
          id: "first",
          createdAt: 11,
          updatedAt: 12,
          routing: {
            provider: "openai",
            model: "model-a",
            protocol: "openai-responses",
            thinkingLevel: "low",
            rule: "qualification-default-v1",
          },
        },
      ],
      usage: [{ callId: "call-1", createdAt: 15 }],
      events: [
        {
          attemptId: "first",
          kind: "attempt_progress",
          payload: { phase: "workspace_started" },
          createdAt: 13,
        },
      ],
    });
    expect(calls[2]?.sql).toContain("u.created_at");
    expect(calls[3]?.sql).toContain("ORDER BY created_at,id");

    await expect(
      new D1RunRepository(db).detailsByIssue("zorkian/roundhouse", 282),
    ).resolves.toBeUndefined();
    await expect(
      new D1RunRepository(db).detailsByIssue("unknown/repository", 281),
    ).resolves.toBeUndefined();
  });

  it("renders summary and expandable attempt details without duplicate sections", () => {
    const details: RunDetails = {
      run: {
        schemaVersion: 2,
        id: "run_1",
        repository: "zorkian/roundhouse",
        issueNumber: 281,
        baseCommit: "base-sha",
        currentHead: "merged-sha",
        profileVersion: "test",
        status: "succeeded",
        stage: "merge",
        revision: 7,
        issue: {
          title: "<script>alert(1)</script>",
          body: "issue body",
          url: "https://github.com/zorkian/roundhouse/issues/281",
          actor: "user",
        },
      },
      createdAt: 1,
      updatedAt: 2,
      usage: [
        {
          callId: "call-1",
          attemptId: "implementation",
          model: "test-model",
          inputTokens: 100,
          cachedInputTokens: 40,
          reasoningTokens: 10,
          outputTokens: 20,
          totalTokens: 120,
          costUsd: 0.01,
        },
      ],
      attempts: [
        {
          id: "implementation",
          runId: "run_1",
          runRevision: 3,
          kind: "agent",
          stage: "implement",
          role: "developer",
          state: "completed",
          deadlineAt: 3,
          baseCommit: "base-sha",
          expectedHead: "base-sha",
          acceptedHead: "candidate-sha",
          result: {
            implementation: {
              summary: "done <img src=x onerror=alert(1)>",
              validation: [{ command: "npm test", output: "<b>bad</b>" }],
              pullRequest: {
                number: 99,
                html_url: "https://github.com/zorkian/roundhouse/pull/99",
              },
            },
          },
          routing: {
            provider: "openai",
            model: "test-model",
            protocol: "openai-responses",
            thinkingLevel: "low",
            rule: "implementation-default-v1",
          },
          createdAt: 3,
          updatedAt: 4,
        },
        {
          id: "review",
          runId: "run_1",
          runRevision: 4,
          kind: "agent",
          stage: "review",
          role: "reviewer",
          state: "completed",
          deadlineAt: 5,
          baseCommit: "base-sha",
          expectedHead: "candidate-sha",
          acceptedHead: "candidate-sha",
          result: { review: { status: "clean", findings: [] } },
          createdAt: 5,
          updatedAt: 6,
        },
        {
          id: "ci",
          runId: "run_1",
          runRevision: 5,
          kind: "external",
          stage: "ci",
          role: "github-checks",
          state: "completed",
          deadlineAt: 7,
          baseCommit: "base-sha",
          expectedHead: "candidate-sha",
          acceptedHead: "candidate-sha",
          result: {
            ci: { checks: [{ name: "test", url: "https://example.test" }] },
          },
          createdAt: 7,
          updatedAt: 8,
        },
        {
          id: "merge",
          runId: "run_1",
          runRevision: 6,
          kind: "external",
          stage: "merge",
          role: "github-merge",
          state: "completed",
          deadlineAt: 9,
          baseCommit: "base-sha",
          expectedHead: "candidate-sha",
          acceptedHead: "merged-sha",
          result: { merge: { status: "merged" } },
          createdAt: 9,
          updatedAt: 10,
        },
      ],
    };
    const html = renderRunDetails(details);
    expect(html).toContain("candidate-sha");
    expect(html).toContain("merged-sha");
    expect(html).toContain("test-model");
    expect(html).toContain("120 tokens");
    expect(html).toContain("$0.01");
    expect(html).toContain(
      "<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>",
    );
    expect(html).toContain("<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>");
    expect(html).toContain('class="status succeeded">Succeeded</span>');
    expect(html).toContain("<dt>Elapsed</dt><dd>1 ms</dd>");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain(
      "100 input, 40 cached input, unavailable cache creation input, 10 reasoning, 20 output",
    );
    expect(html).toContain("npm test");
    expect(html).toContain("&lt;b&gt;bad&lt;/b&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain(
      "https://github.com/zorkian/roundhouse/pull/99/files",
    );
    expect(html).toContain('<a href="https://example.test">test</a>');
    expect(html).toContain("</dl>\n<section><h2>Attempt history</h2>");
    expect(html).toContain(
      "@media(max-width:700px){body{box-sizing:border-box;margin:1rem auto;max-width:none;padding:0 .75rem;width:100%}summary{grid-template-columns:1fr 1fr}.phase{grid-column:auto}dl{grid-template-columns:minmax(0,1fr)}",
    );
    expect(html).toContain(
      ".attempt-details{padding:0 0 1rem .75rem;margin-left:0;min-width:0}",
    );
    expect(html).toContain("table{display:block;overflow-x:auto}");
    for (const heading of [
      "Issue",
      "Commit trace",
      "Usage by workflow step",
      "Qualification",
      "Reproduction",
      "Current behavior",
      "Plan",
      "Implementation and validation",
      "Review",
      "CI checks",
      "Merge",
    ]) {
      expect(html).not.toContain(`<h2>${heading}</h2>`);
    }
  });

  it("renders attempts chronologically as collapsed timeline rows", () => {
    const attempt = (
      id: string,
      stage: "implement" | "review",
      createdAt: number,
    ) => ({
      id,
      runId: "run_timeline",
      runRevision: 1,
      kind: "agent" as const,
      stage,
      role: "worker",
      state: "completed" as const,
      deadlineAt: createdAt + 10_000,
      baseCommit: "base",
      expectedHead: "base",
      createdAt,
      updatedAt: createdAt + 65_000,
    });
    const html = renderRunDetails({
      run: {
        schemaVersion: 2,
        id: "run_timeline",
        repository: "zorkian/roundhouse",
        issueNumber: 3,
        baseCommit: "base",
        currentHead: "base",
        profileVersion: "test",
        status: "active",
        stage: "review",
        revision: 2,
      },
      createdAt: 1,
      updatedAt: 2,
      attempts: [
        attempt("later", "review", Date.UTC(2026, 0, 2)),
        attempt("earlier", "implement", Date.UTC(2026, 0, 1)),
      ],
    });

    expect(html.indexOf(">implement</span>")).toBeLessThan(
      html.indexOf(">review</span>"),
    );
    expect(html).toContain("2026-01-01T00:00:00.000Z");
    expect(html).toContain('<span class="label">Revision</span>1');
    expect(html).toContain("1m 5s");
    expect(html).toContain('<span class="label">Status</span>completed');
    expect(html.match(/<details>/g)).toHaveLength(2);
    expect(html).not.toContain("<details open");
  });

  it("labels feature evidence as current behavior", () => {
    const common = {
      runId: "run_feature",
      kind: "agent" as const,
      state: "completed" as const,
      deadlineAt: 2,
      baseCommit: "base",
      expectedHead: "base",
      createdAt: 1,
      updatedAt: 2,
    };
    const html = renderRunDetails({
      run: {
        schemaVersion: 2,
        id: "run_feature",
        repository: "zorkian/roundhouse",
        issueNumber: 3,
        baseCommit: "base",
        currentHead: "base",
        profileVersion: "test",
        status: "active",
        stage: "reproduce",
        revision: 2,
      },
      createdAt: 1,
      updatedAt: 2,
      attempts: [
        {
          ...common,
          id: "investigation",
          runRevision: 2,
          stage: "reproduce",
          role: "reproduce",
          result: {
            requestClassification: "feature",
            reproduction: {
              status: "confirmed",
            },
          },
        },
      ],
    });
    expect(html).toContain('<span class="phase">Current behavior</span>');
    expect(html).not.toContain('<span class="phase">reproduce</span>');
    expect(html).toContain("<dt>Current stage</dt><dd>Current behavior</dd>");
    expect(html).not.toContain("<dt>reproduce</dt>");
    expect(html).not.toContain("<h2>Current behavior</h2>");
    expect(html).not.toContain("<h2>Reproduction</h2>");
  });

  it("shows total and per-attempt usage without workflow usage sections", () => {
    const html = renderRunDetails({
      run: {
        schemaVersion: 2,
        id: "run_usage",
        repository: "zorkian/roundhouse",
        issueNumber: 4,
        baseCommit: "base",
        currentHead: "base",
        profileVersion: "test",
        status: "active",
        stage: "implement",
        revision: 2,
      },
      createdAt: 1,
      updatedAt: 2,
      attempts: [
        {
          id: "implement-1",
          runId: "run_usage",
          runRevision: 1,
          kind: "agent",
          stage: "implement",
          role: "developer",
          state: "failed",
          deadlineAt: 2,
          baseCommit: "base",
          expectedHead: "base",
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: "implement-2",
          runId: "run_usage",
          runRevision: 2,
          kind: "agent",
          stage: "implement",
          role: "developer",
          state: "completed",
          deadlineAt: 3,
          baseCommit: "base",
          expectedHead: "base",
          createdAt: 2,
          updatedAt: 3,
        },
      ],
      usage: [
        {
          callId: "call-1",
          attemptId: "implement-1",
          model: "test-model",
          totalTokens: 100,
          costUsd: 0.01,
        },
        {
          callId: "call-2",
          attemptId: "implement-2",
          model: "test-model",
          totalTokens: 250,
          costUsd: 0.02,
        },
      ],
    });

    expect(html).toContain('<dt>Total usage</dt><dd><span class="usage-hint"');
    expect(html).toContain('>350 tokens · $0.03<span class="usage-breakdown"');
    expect(html).toContain(
      ".usage-hint:hover .usage-breakdown,.usage-hint:focus .usage-breakdown,.usage-hint:focus-within .usage-breakdown{display:block}",
    );
    expect(html).toContain("100 tokens");
    expect(html).toContain("250 tokens");
    expect(html).toContain("$0.03");
    expect(html).not.toContain("<h2>Usage by workflow step</h2>");
  });

  // The bundled Chromium binary from chrome-aws-lambda is built for
  // Amazon Linux x86_64, so the real-browser regression only runs there.
  const canLaunchBundledChromium =
    process.platform === "linux" && process.arch === "x64";
  describe.skipIf(!canLaunchBundledChromium)(
    "rendered layout regression for issue #399",
    () => {
      const layoutFixture = () =>
        renderRunDetails({
          run: {
            schemaVersion: 2,
            id: "run_tooltip_overflow",
            repository: "zorkian/roundhouse",
            issueNumber: 399,
            baseCommit: "base",
            currentHead: "head",
            profileVersion: "test",
            status: "succeeded",
            stage: "implement",
            revision: 1,
          },
          createdAt: 1_000,
          updatedAt: 2_000,
          attempts: [],
          events: [],
          usage: [
            {
              callId: "call-long",
              attemptId: "implement-1",
              model: "test-model",
              totalTokens: 123_456_789,
              inputTokens: 123_456_789,
              outputTokens: 123_456_789,
              costUsd: 123.45,
            },
          ],
        });

      interface Measurement {
        scrollWidth: number;
        clientWidth: number;
        bodyLeft: number;
        bodyContentWidth: number;
        tooltipDisplay: string;
        tooltipWhiteSpace: string;
        tooltipRight: number | null;
      }

      let browser: Browser | undefined;
      let chromiumTempDir: string | undefined;

      const nssLibraryPath = () => {
        // Chromium links against NSS, which is not installed in minimal CI
        // containers. The @achingbrain/nss package ships the shared libraries,
        // so fall back to them only when the system has none.
        const require = createRequire(import.meta.url);
        const nssDir = path.join(
          path.dirname(require.resolve("@achingbrain/nss/package.json")),
          "linux",
        );
        try {
          const ldconfig = execFileSync("ldconfig", ["-p"], {
            encoding: "utf8",
          });
          if (ldconfig.includes("libnss3.so")) return undefined;
        } catch {
          for (const dir of ["/usr/lib", "/lib"]) {
            try {
              if (
                fs
                  .readdirSync(dir, { recursive: true })
                  .some((entry) => String(entry).endsWith("libnss3.so"))
              )
                return undefined;
            } catch {
              // Keep looking.
            }
          }
        }
        return nssDir;
      };

      const chromiumExecutablePath = () => {
        // chrome-aws-lambda only inflates its bundled binary on Lambda, so
        // decompress the brotli-packed Chromium from the package directly.
        const require = createRequire(import.meta.url);
        const binDir = path.join(
          path.dirname(require.resolve("chrome-aws-lambda/package.json")),
          "bin",
        );
        chromiumTempDir = fs.mkdtempSync(
          path.join(os.tmpdir(), "run-details-chromium-"),
        );
        const target = path.join(chromiumTempDir, "chromium");
        fs.writeFileSync(
          target,
          zlib.brotliDecompressSync(
            fs.readFileSync(path.join(binDir, "chromium.br")),
          ),
        );
        fs.chmodSync(target, 0o755);
        return target;
      };

      beforeAll(async () => {
        const libraryPath = nssLibraryPath();
        browser = await puppeteer.launch({
          executablePath: chromiumExecutablePath(),
          args: [
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--headless",
          ],
          env: {
            ...process.env,
            ...(libraryPath
              ? {
                  LD_LIBRARY_PATH: [libraryPath, process.env.LD_LIBRARY_PATH]
                    .filter(Boolean)
                    .join(":"),
                }
              : {}),
          },
        });
      }, 120_000);

      afterAll(async () => {
        await browser?.close();
        if (chromiumTempDir)
          fs.rmSync(chromiumTempDir, { recursive: true, force: true });
      });

      const measure = async (
        html: string,
        width: number,
        height: number,
        revealTooltip: boolean,
      ): Promise<Measurement> => {
        const page = await browser!.newPage();
        try {
          await page.setViewport({ width, height });
          await page.setContent(html, { waitUntil: "load" });
          if (revealTooltip) await page.hover(".usage-hint");
          return await page.evaluate(() => {
            // Runs in the browser; the project compiles against WebWorker
            // libs, so access DOM globals through a structural type.
            interface Rect {
              left: number;
              right: number;
              width: number;
            }
            const win = globalThis as unknown as {
              document: {
                documentElement: { scrollWidth: number; clientWidth: number };
                body: { getBoundingClientRect(): Rect };
                querySelector(selector: string): {
                  getBoundingClientRect(): Rect;
                } | null;
              };
              getComputedStyle(element: unknown): {
                display: string;
                whiteSpace: string;
                paddingLeft: string;
                paddingRight: string;
              };
            };
            const root = win.document.documentElement;
            const bodyStyle = win.getComputedStyle(win.document.body);
            const bodyRect = win.document.body.getBoundingClientRect();
            const tooltip = win.document.querySelector(".usage-breakdown");
            const tooltipStyle = tooltip ? win.getComputedStyle(tooltip) : null;
            const tooltipRect =
              tooltip && tooltipStyle?.display !== "none"
                ? tooltip.getBoundingClientRect()
                : null;
            return {
              scrollWidth: root.scrollWidth,
              clientWidth: root.clientWidth,
              bodyLeft: bodyRect.left,
              bodyContentWidth:
                bodyRect.width -
                Number.parseFloat(bodyStyle.paddingLeft) -
                Number.parseFloat(bodyStyle.paddingRight),
              tooltipDisplay: tooltipStyle?.display ?? "",
              tooltipWhiteSpace: tooltipStyle?.whiteSpace ?? "",
              tooltipRight: tooltipRect ? tooltipRect.right : null,
            };
          });
        } finally {
          await page.close();
        }
      };

      it("keeps the document inside the iPhone portrait viewport while the usage breakdown is inactive", async () => {
        const measurement = await measure(layoutFixture(), 390, 844, false);
        // The diagnosed issue #399 failure rendered an 848px document at this
        // viewport because the hidden nowrap tooltip stayed in layout.
        expect(measurement.clientWidth).toBe(390);
        expect(measurement.scrollWidth).toBe(390);
        expect(measurement.bodyLeft).toBe(0);
        expect(measurement.bodyContentWidth).toBe(390 - 2 * 12);
        expect(measurement.tooltipDisplay).toBe("none");
      });

      it("keeps the revealed usage breakdown inside the portrait viewport", async () => {
        const measurement = await measure(layoutFixture(), 390, 844, true);
        expect(measurement.tooltipDisplay).toBe("block");
        expect(measurement.tooltipWhiteSpace).toBe("normal");
        expect(measurement.tooltipRight).not.toBeNull();
        expect(measurement.tooltipRight!).toBeLessThanOrEqual(390);
        expect(measurement.scrollWidth).toBe(390);
      });

      it("preserves the centered desktop layout and nowrap hover tooltip", async () => {
        const measurement = await measure(layoutFixture(), 1280, 900, true);
        expect(measurement.bodyContentWidth).toBe(1000);
        expect(measurement.bodyLeft).toBe((1280 - (1000 + 2 * 16)) / 2);
        expect(measurement.tooltipDisplay).toBe("block");
        expect(measurement.tooltipWhiteSpace).toBe("nowrap");
        expect(measurement.tooltipRight!).toBeLessThanOrEqual(1280);
        expect(measurement.scrollWidth).toBe(1280);
      });

      it("detects the original failure mode when the hidden tooltip stays in layout", async () => {
        // Guard the regression itself: restoring the pre-fix pattern
        // (visibility:hidden with the element still laid out) must reproduce
        // the horizontal overflow measured in the issue reproduction.
        const regressed = layoutFixture()
          .replace(
            ".usage-breakdown{background:#202124;",
            ".usage-breakdown{visibility:hidden;background:#202124;",
          )
          .replace("display:none;font-size:.875rem", "font-size:.875rem")
          .replace(
            ".usage-breakdown{max-width:calc(100vw - 2rem);white-space:normal}",
            "",
          );
        const measurement = await measure(regressed, 390, 844, false);
        expect(measurement.tooltipDisplay).not.toBe("none");
        expect(measurement.scrollWidth).toBeGreaterThan(390);
      });
    },
  );

  it("shows recovered executions with separate outcomes and usage", () => {
    const html = renderRunDetails({
      run: {
        schemaVersion: 2,
        id: "run_recovered",
        repository: "zorkian/roundhouse",
        issueNumber: 336,
        baseCommit: "base",
        currentHead: "head",
        profileVersion: "test",
        status: "succeeded",
        stage: "implement",
        revision: 13,
      },
      createdAt: 1_000,
      updatedAt: 9_000,
      attempts: [
        {
          id: "implementation",
          runId: "run_recovered",
          runRevision: 13,
          kind: "agent",
          stage: "implement",
          role: "developer",
          state: "completed",
          deadlineAt: 10_000,
          baseCommit: "base",
          expectedHead: "base",
          createdAt: 1_000,
          updatedAt: 9_000,
        },
      ],
      events: [
        {
          attemptId: "implementation",
          kind: "attempt_progress",
          payload: { phase: "workspace_started" },
          createdAt: 2_000,
        },
        {
          attemptId: "implementation",
          kind: "attempt_lease_expired",
          payload: {},
          createdAt: 4_000,
        },
        {
          attemptId: "implementation",
          kind: "attempt_progress",
          payload: { phase: "workspace_started" },
          createdAt: 5_000,
        },
      ],
      usage: [
        {
          callId: "before",
          attemptId: "implementation",
          model: "model-a",
          totalTokens: 100,
          costUsd: 0.01,
          createdAt: 3_000,
        },
        {
          callId: "during-teardown",
          attemptId: "implementation",
          model: "model-a",
          totalTokens: 50,
          costUsd: 0.005,
          createdAt: 4_500,
        },
        {
          callId: "after-1",
          attemptId: "implementation",
          model: "model-b",
          totalTokens: 200,
          costUsd: 0.02,
          createdAt: 6_000,
        },
        {
          callId: "after-2",
          attemptId: "implementation",
          model: "model-b",
          totalTokens: 300,
          costUsd: 0.03,
          createdAt: 7_000,
        },
      ],
    });

    expect(html.match(/class="execution"/g)).toHaveLength(2);
    expect(html).toContain("Interrupted");
    expect(html).toContain("Restarted · Completed");
    expect(html).toContain("2s");
    expect(html).toContain("4s");
    expect(html.match(/<dt>Model calls<\/dt><dd>2<\/dd>/g)).toHaveLength(2);
    expect(html).toContain("150 tokens · $0.01");
    expect(html).toContain("500 tokens · $0.05");
    expect(html).toContain("650 tokens · $0.07");
    expect(html).toContain("<h4>Model usage total</h4>");
  });

  it("marks a recovered final execution active", () => {
    const html = renderRunDetails({
      run: {
        schemaVersion: 2,
        id: "active",
        repository: "zorkian/roundhouse",
        issueNumber: 336,
        baseCommit: "base",
        currentHead: "base",
        profileVersion: "test",
        status: "active",
        stage: "implement",
        revision: 1,
      },
      createdAt: 1,
      updatedAt: 5,
      attempts: [
        {
          id: "attempt",
          runId: "active",
          runRevision: 1,
          kind: "agent",
          stage: "implement",
          role: "developer",
          state: "dispatched",
          deadlineAt: 10,
          baseCommit: "base",
          expectedHead: "base",
          createdAt: 1,
          updatedAt: 5,
        },
      ],
      events: [
        {
          attemptId: "attempt",
          kind: "attempt_progress",
          payload: { phase: "workspace_started" },
          createdAt: 2,
        },
      ],
    });
    expect(html).toContain("In progress");
    expect(html).toContain("<dt>State</dt><dd>Active</dd>");
    expect(html).toContain("<dt>Elapsed</dt><dd>3 ms</dd>");
  });

  it.each([
    ["failed", "active", "Failed"],
    ["dispatched", "cancelled", "Cancelled"],
  ] as const)(
    "shows a %s execution on a %s run as %s rather than active or completed",
    (attemptState, runStatus, outcome) => {
      const html = renderRunDetails({
        run: {
          schemaVersion: 2,
          id: "terminal",
          repository: "zorkian/roundhouse",
          issueNumber: 336,
          baseCommit: "base",
          currentHead: "base",
          profileVersion: "test",
          status: runStatus,
          stage: "implement",
          revision: 1,
        },
        createdAt: 1,
        updatedAt: 5,
        attempts: [
          {
            id: "attempt",
            runId: "terminal",
            runRevision: 1,
            kind: "agent",
            stage: "implement",
            role: "developer",
            state: attemptState,
            deadlineAt: 10,
            baseCommit: "base",
            expectedHead: "base",
            createdAt: 1,
            updatedAt: 5,
          },
        ],
        events: [
          {
            attemptId: "attempt",
            kind: "attempt_progress",
            payload: { phase: "workspace_started" },
            createdAt: 2,
          },
        ],
      });

      expect(html).toContain(`<dt>Outcome</dt><dd>${outcome}</dd>`);
      expect(html).not.toContain("<dt>State</dt><dd>Active</dd>");
    },
  );

  it("identifies missing optional evidence", () => {
    const html = renderRunDetails({
      run: {
        schemaVersion: 2,
        id: "run_2",
        repository: "zorkian/roundhouse",
        issueNumber: 1,
        baseCommit: "base",
        currentHead: "base",
        profileVersion: "test",
        status: "active",
        stage: "qualify",
        revision: 0,
      },
      createdAt: 1,
      updatedAt: 1,
      attempts: [],
    });
    expect(html).toContain("No attempts recorded");
    expect(html).toContain("<title>Issue #1</title>");
    expect(html).toContain("<h1>Issue #1</h1>");
    expect(html).toContain("Unavailable");
  });

  it("renders explicit allowed and protected paths", () => {
    const base = {
      schemaVersion: 2 as const,
      repository: "zorkian/roundhouse",
      issueNumber: 9,
      baseCommit: "base",
      currentHead: "base",
      profileVersion: "test",
      status: "active" as const,
      stage: "qualify" as const,
      revision: 1,
    };
    const html = renderRunDetails({
      run: {
        ...base,
        id: "run_profile_v1",
        profile: {
          sourcePath: ".roundhouse/profile.yaml",
          sourceCommit: "c".repeat(40),
          version: 1,
          hash: "e".repeat(64),
          paths: { allowed: ["**"], protected: [".github/workflows/**"] },
        },
      },
      createdAt: 1,
      updatedAt: 2,
      attempts: [],
    });
    expect(html).toContain("<dt>Schema version</dt><dd>1</dd>");
    expect(html).toContain("<dt>Allowed paths</dt>");
    expect(html).toContain("<dt>Protected paths</dt>");
    expect(html).toContain(".github/workflows/**");
    expect(html).not.toContain("Path rules");
  });

  it("shows the distinct candidate, base, and integration identities", () => {
    const html = renderRunDetails({
      run: {
        schemaVersion: 2,
        id: "run_integrated",
        repository: "zorkian/roundhouse",
        issueNumber: 3,
        baseCommit: "a".repeat(40),
        currentHead: "d".repeat(40),
        candidateHead: "b".repeat(40),
        reviewedHead: "b".repeat(40),
        targetBaseHead: "c".repeat(40),
        integrationHead: "d".repeat(40),
        profileVersion: "test",
        status: "active",
        stage: "ci",
        revision: 8,
      },
      createdAt: 1,
      updatedAt: 2,
      attempts: [],
    });
    expect(html).toContain("<dt>Authored candidate head</dt>");
    expect(html).toContain("<dt>Reviewed candidate head</dt>");
    expect(html).toContain("<dt>Target base head</dt>");
    expect(html).toContain("<dt>Validated integration head</dt>");
    expect(html).toContain("b".repeat(40));
    expect(html).toContain("c".repeat(40));
    expect(html).toContain("d".repeat(40));
  });

  it("does not label an unaccepted merge head as merged", () => {
    const html = renderRunDetails({
      run: {
        schemaVersion: 2,
        id: "run_failed_merge",
        repository: "zorkian/roundhouse",
        issueNumber: 2,
        baseCommit: "base",
        currentHead: "candidate",
        profileVersion: "test",
        status: "failed",
        stage: "merge",
        revision: 1,
      },
      createdAt: 1,
      updatedAt: 2,
      attempts: [
        {
          id: "merge",
          runId: "run_failed_merge",
          runRevision: 1,
          kind: "external",
          stage: "merge",
          role: "github-merge",
          state: "failed",
          deadlineAt: 2,
          baseCommit: "base",
          expectedHead: "candidate",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });
    expect(html).toContain(
      "<dt>Accepted head</dt><dd><code>Unavailable</code></dd>",
    );
  });
});
