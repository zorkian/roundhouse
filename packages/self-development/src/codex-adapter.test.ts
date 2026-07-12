// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CodexExecAdapter } from "./codex-adapter.js";

const paths: string[] = [];

async function temporary(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  paths.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("CodexExecAdapter", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 2_147_483_648])(
    "rejects invalid timeout %s",
    (timeoutMs) => {
      expect(
        () =>
          new CodexExecAdapter({
            codexHome: "/tmp/codex-home",
            timeoutMs,
          }),
      ).toThrow("timeoutMs must be a positive supported integer");
    },
  );

  it("normalizes JSONL events and exposes only its scrubbed environment", async () => {
    const workspace = await temporary("roundhouse-codex-workspace-");
    const codexHome = await temporary("roundhouse-codex-auth-");
    const fake = join(await temporary("roundhouse-codex-fake-"), "fake.mjs");
    await writeFile(
      fake,
      `import { writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.cwd(), "invocation.json"), JSON.stringify({ argv: process.argv.slice(2), env: Object.keys(process.env).sort() }));
console.log(JSON.stringify({ type: "thread.started", thread_id: "session-test" }));
console.log(JSON.stringify({ type: "item.completed", item: { id: "message-1", type: "agent_message", text: "done" } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 12, output_tokens: 3 } }));
`,
    );
    const adapter = new CodexExecAdapter({
      binary: process.execPath,
      binaryPrefixArgs: [fake],
      codexHome,
      timeoutMs: 10_000,
    });

    const events = [];
    for await (const event of adapter.start({
      attemptId: "attempt-test",
      prompt: "Make the requested change.",
      workspace,
      allowedTools: ["shell", "apply_patch"],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "session.started", sessionId: "session-test" },
      { type: "message", role: "assistant", text: "done" },
      { type: "usage", inputTokens: 12, outputTokens: 3 },
      { type: "completed", outcome: "succeeded" },
    ]);
    const invocation = JSON.parse(
      await readFile(join(workspace, "invocation.json"), "utf8"),
    ) as { argv: string[]; env: string[] };
    expect(invocation.argv).toContain("--ephemeral");
    expect(invocation.argv).toContain(
      "sandbox_workspace_write.network_access=false",
    );
    expect(invocation.argv).toContain(
      'shell_environment_policy.inherit="none"',
    );
    expect(invocation.env).toContain("CODEX_HOME");
    expect(invocation.env).not.toContain("GH_TOKEN");
    expect(invocation.env).not.toContain("CLOUDFLARE_API_TOKEN");
  });

  it("rejects unsupported tool categories", async () => {
    const adapter = new CodexExecAdapter({
      codexHome: await temporary("roundhouse-codex-auth-"),
    });
    const consume = async () => {
      for await (const _event of adapter.start({
        attemptId: "attempt-test",
        prompt: "test",
        workspace: ".",
        allowedTools: ["browser"],
      })) {
        // Consume the iterator.
      }
    };
    await expect(consume()).rejects.toThrow(
      "Unsupported Codex tool category: browser",
    );
  });
});
