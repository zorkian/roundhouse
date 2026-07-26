// Copyright 2026 Mark Smith
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  advanceWorkflow,
  compileWorkflow,
  evaluateWorkflowCondition,
  selectWorkflowTransition,
} from "./workflow.js";

const commit = "a".repeat(40);
const source = `
version: 1
triggers:
  github.issue.started: qualify
nodes:
  qualify:
    executor: agent.read
    role: qualify
    agent:
      task: qualification
      inputs:
        issue: trigger.issue
      result:
        key: qualification
        schema: roundhouse.qualification.v1
      model: { id: openai/gpt-5.6-sol, reasoning: low }
    capabilities:
      - repository.read
      - context.read
    outputs:
      - qualification.classification
      - reproduction.status
      - plan.status
    transitions:
      - when:
          path: output.qualification.classification
          in: [bug, feature, maintenance]
        to: implement
      - when:
          path: output.qualification.classification
          equals: unclear
        wait: clarification
      - terminal: succeeded
  implement:
    executor: agent.write
    role: implement
    agent:
      task: implementation
      inputs:
        issue: trigger.issue
        qualification: nodes.qualify.qualification
        reproduction: nodes.qualify.reproduction
        plan: nodes.qualify.plan
      result:
        key: implementation
        schema: roundhouse.implementation.v1
      model: { id: moonshotai/kimi-k3, reasoning: low }
    capabilities:
      - repository.read
      - artifact.write
    outputs:
      - implementation.status
    transitions:
      - when:
          path: output.implementation.status
          equals: complete
        to: done
      - terminal: failed
  done:
    executor: terminal
    transitions:
      - terminal: succeeded
`;

describe("workflow compiler", () => {
  it("compiles a typed graph and selects structured branches", async () => {
    const workflow = await compileWorkflow(source, commit);
    expect(workflow.sourceCommit).toBe(commit);
    expect(workflow.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(workflow.triggers["github.issue.started"]).toBe("qualify");
    expect(
      selectWorkflowTransition(workflow.nodes.qualify!, {
        output: { qualification: { classification: "bug" } },
      }),
    ).toEqual({
      when: {
        path: "output.qualification.classification",
        in: ["bug", "feature", "maintenance"],
      },
      to: "implement",
    });
    expect(
      selectWorkflowTransition(workflow.nodes.qualify!, {
        output: { qualification: { classification: "unclear" } },
      }),
    ).toMatchObject({ wait: "clarification" });
    expect(
      selectWorkflowTransition(workflow.nodes.qualify!, {
        output: { qualification: { classification: "duplicate" } },
      }),
    ).toEqual({ terminal: "succeeded" });
  });

  it("advances branches, waits in place, and preserves loops durably", async () => {
    const workflow = await compileWorkflow(
      source.replace("to: done", "to: implement").replace(
        `  done:
    executor: terminal
    transitions:
      - terminal: succeeded
`,
        "",
      ),
      commit,
    );
    expect(
      advanceWorkflow(workflow, "qualify", {
        output: { qualification: { classification: "bug" } },
      }),
    ).toMatchObject({ status: "active", currentNodeId: "implement" });
    expect(
      advanceWorkflow(workflow, "qualify", {
        output: { qualification: { classification: "unclear" } },
      }),
    ).toMatchObject({
      status: "waiting",
      currentNodeId: "qualify",
      waitingReason: "clarification",
    });
    expect(
      advanceWorkflow(workflow, "implement", {
        output: { implementation: { status: "complete" } },
      }),
    ).toMatchObject({ status: "active", currentNodeId: "implement" });
  });

  it("snapshots repository-selected prompt, model, branch, and return edge", async () => {
    const configured = source
      .replace(
        "model: { id: openai/gpt-5.6-sol, reasoning: low }\n    capabilities:",
        "model: { id: openai/gpt-5.6-sol, reasoning: high }\n      prompt: prompts/qualification.md\n    capabilities:",
      )
      .replace("in: [bug, feature, maintenance]", "in: [feature, maintenance]")
      .replace(
        `    transitions:
      - when:
          path: output.implementation.status
          equals: complete
        to: done`,
        `    transitions:
      - when:
          path: output.implementation.status
          equals: retry
        to: qualify
      - when:
          path: output.implementation.status
          equals: complete
        to: done`,
      );
    const workflow = await compileWorkflow(configured, commit, async (path) =>
      path === ".roundhouse/prompts/qualification.md"
        ? "Repository qualification route"
        : Promise.reject(new Error("unexpected_file")),
    );
    expect(workflow.nodes.qualify?.agent).toMatchObject({
      model: { id: "openai/gpt-5.6-sol", reasoning: "high" },
      prompt: {
        sourcePath: ".roundhouse/prompts/qualification.md",
        content: "Repository qualification route",
      },
    });
    expect(
      selectWorkflowTransition(workflow.nodes.qualify!, {
        output: { qualification: { classification: "bug" } },
      }),
    ).toEqual({ terminal: "succeeded" });
    expect(
      selectWorkflowTransition(workflow.nodes.implement!, {
        output: { implementation: { status: "retry" } },
      }),
    ).toMatchObject({ to: "qualify" });
  });

  it("evaluates nested conditions without executable expressions", () => {
    expect(
      evaluateWorkflowCondition(
        {
          all: [
            { exists: "output.review" },
            {
              not: {
                path: "output.review.status",
                equals: "changes_requested",
              },
            },
            { path: "run.revision", greater_than_or_equal: 4 },
          ],
        },
        {
          output: { review: { status: "clean" } },
          run: { revision: 4 },
        },
      ),
    ).toBe(true);
  });

  it("rejects authority escalation", async () => {
    const changed = source.replace(
      /capabilities:\n      - repository\.read\n      - context\.read/,
      "capabilities: [github.merge]",
    );
    await expect(compileWorkflow(changed, commit)).rejects.toThrow(
      "workflow_capability_escalation",
    );
  });

  it("rejects conditions over undeclared output", async () => {
    const changed = source.replace(
      /outputs:\n      - qualification\.classification\n      - reproduction\.status\n      - plan\.status/,
      "outputs: []",
    );
    await expect(compileWorkflow(changed, commit)).rejects.toThrow(
      "workflow_condition_output_undeclared",
    );
  });

  it("rejects missing targets, dead configuration, and misplaced fallbacks", async () => {
    await expect(
      compileWorkflow(source.replace("to: implement", "to: missing"), commit),
    ).rejects.toThrow("workflow_transition_target_missing");
    await expect(
      compileWorkflow(
        `${source}
  orphan:
    executor: terminal
    transitions:
      - terminal: succeeded
`,
        commit,
      ),
    ).rejects.toThrow("workflow_node_unreachable");
    await expect(
      compileWorkflow(
        source.replace(
          "      - terminal: succeeded\n  implement:",
          `      - terminal: succeeded
      - when:
          exists: output.qualification.classification
        terminal: failed
  implement:`,
        ),
        commit,
      ),
    ).rejects.toThrow("workflow_transition_fallback_invalid");
  });
});
