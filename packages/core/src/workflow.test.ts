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
  it("adds arbitrary repository-defined reviewers without source changes", async () => {
    const reviewSource = `
version: 1
triggers:
  github.issue.started: review
nodes:
  review:
    executor: review
    review:
      reviewers:
        - id: review-holistic
          label: Holistic
          activation: always
          selects: [review-accessibility]
          mode: blocking
          blocking_severities: [critical, high, medium]
          model: { id: openai/gpt-5.6-sol, reasoning: low }
        - id: review-accessibility
          label: Accessibility
          activation: selected
          selected_by: review-holistic
          mode: advisory
          blocking_severities: [critical, high]
          model: { id: openai/gpt-5.6-sol, reasoning: high }
          prompt: prompts/review-accessibility.md
    capabilities: [repository.read, context.read]
    outputs: [review.status]
    transitions:
      - terminal: succeeded
`;
    const workflow = await compileWorkflow(
      reviewSource,
      commit,
      async () => "Review keyboard and screen-reader behavior.",
    );
    expect(workflow.nodes.review?.review?.reviewers[1]).toMatchObject({
      id: "review-accessibility",
      activation: "selected",
      selectedBy: "review-holistic",
      mode: "advisory",
      model: { id: "openai/gpt-5.6-sol", reasoning: "high" },
      prompt: {
        sourcePath: ".roundhouse/prompts/review-accessibility.md",
        content: "Review keyboard and screen-reader behavior.",
      },
    });
  });

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

describe("workflow competitions", () => {
  const competitionSource = (agentBlock: string) => `
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
${agentBlock}
    capabilities:
      - repository.read
    outputs:
      - qualification.classification
    transitions:
      - terminal: succeeded
`;
  const competitionBlock = `      competition:
        candidates:
          - id: alpha
            model: { id: openai/gpt-alpha, reasoning: low }
          - id: beta
            model: { id: anthropic/claude-beta, reasoning: medium }
        judge:
          model: { id: openai/gpt-judge, reasoning: high }`;

  it("compiles an agent competition with candidates and a judge", async () => {
    const compiled = await compileWorkflow(
      competitionSource(competitionBlock),
      commit,
    );
    const competition = compiled.nodes.qualify?.agent?.competition;
    expect(competition?.candidates.map((candidate) => candidate.id)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(competition?.candidates[0]?.model).toEqual({
      id: "openai/gpt-alpha",
      reasoning: "low",
    });
    expect(competition?.judge.model).toEqual({
      id: "openai/gpt-judge",
      reasoning: "high",
    });
    expect(compiled.nodes.qualify?.agent?.model).toBeUndefined();
  });

  it("round-trips a competition through the serializer", async () => {
    const { serializeWorkflow } = await import("./workflow.js");
    const compiled = await compileWorkflow(
      competitionSource(competitionBlock),
      commit,
    );
    const serialized = serializeWorkflow(compiled);
    expect(serialized).toContain("competition");
    expect(serialized).toContain("alpha");
    const reparsed = await compileWorkflow(serialized, commit);
    expect(reparsed.nodes.qualify?.agent?.competition).toEqual(
      compiled.nodes.qualify?.agent?.competition,
    );
    expect(reparsed.hash).toBe(compiled.hash);
  });

  it("compiles a reviewer competition", async () => {
    const reviewCompetition = `
version: 1
triggers:
  github.issue.started: review
nodes:
  review:
    executor: review
    role: review
    review:
      reviewers:
        - id: review-holistic
          label: Holistic design review
          activation: always
          mode: blocking
          blocking_severities: [critical]
          competition:
            candidates:
              - id: alpha
                model: { id: openai/gpt-alpha, reasoning: low }
              - id: beta
                model: { id: anthropic/claude-beta, reasoning: low }
            judge:
              model: { id: openai/gpt-judge, reasoning: high }
    capabilities:
      - repository.read
    outputs:
      - review.status
    transitions:
      - terminal: succeeded
`;
    const compiled = await compileWorkflow(reviewCompetition, commit);
    const reviewer = compiled.nodes.review?.review?.reviewers[0];
    expect(reviewer?.competition?.candidates).toHaveLength(2);
    expect(reviewer?.model).toBeUndefined();
  });

  it("rejects mixed, incomplete, and duplicate competition definitions", async () => {
    await expect(
      compileWorkflow(
        competitionSource(
          `      model: { id: openai/gpt-5.6-sol, reasoning: low }\n${competitionBlock}`,
        ),
        commit,
      ),
    ).rejects.toThrow("workflow_agent_invalid");
    await expect(
      compileWorkflow(
        competitionSource(`      competition:
        candidates:
          - id: alpha
            model: { id: openai/gpt-alpha, reasoning: low }
        judge:
          model: { id: openai/gpt-judge, reasoning: high }`),
        commit,
      ),
    ).rejects.toThrow("workflow_competition_invalid");
    await expect(
      compileWorkflow(
        competitionSource(`      competition:
        candidates:
          - id: alpha
            model: { id: openai/gpt-alpha, reasoning: low }
          - id: alpha
            model: { id: openai/gpt-beta, reasoning: low }
        judge:
          model: { id: openai/gpt-judge, reasoning: high }`),
        commit,
      ),
    ).rejects.toThrow("workflow_competition_duplicate");
    await expect(
      compileWorkflow(
        competitionSource(`      competition:
        candidates:
          - id: alpha
            model: { id: openai/gpt-alpha, reasoning: low }
          - id: beta
            model: { id: openai/gpt-beta, reasoning: low }`),
        commit,
      ),
    ).rejects.toThrow("workflow_competition_invalid");
    await expect(
      compileWorkflow(
        competitionSource(`      competition:
        candidates:
          - id: alpha
            model: { id: openai/gpt-alpha, reasoning: low }
          - id: beta
            model: { id: openai/gpt-beta, reasoning: low }
        judge:
          model: { id: not-a-model, reasoning: high }`),
        commit,
      ),
    ).rejects.toThrow("workflow_competition_judge_invalid");
  });

  it("rejects competition identifiers whose derived roles exceed the runtime limit", async () => {
    const longBase = "a" + "b".repeat(63); // 64 characters, the accepted maximum
    const boundarySource = (role: string, candidateId: string) => `
version: 1
triggers:
  github.issue.started: qualify
nodes:
  qualify:
    executor: agent.read
    role: ${role}
    agent:
      task: qualification
      inputs:
        issue: trigger.issue
      result:
        key: qualification
        schema: roundhouse.qualification.v1
      competition:
        candidates:
          - id: ${candidateId}
            model: { id: openai/gpt-alpha, reasoning: low }
          - id: beta
            model: { id: anthropic/claude-beta, reasoning: medium }
        judge:
          model: { id: openai/gpt-judge, reasoning: high }
    capabilities:
      - repository.read
    outputs:
      - qualification.classification
    transitions:
      - terminal: succeeded
`;
    // The derived judge role `${role}-judge` is 70 characters.
    await expect(
      compileWorkflow(boundarySource(longBase, "alpha"), commit),
    ).rejects.toThrow("workflow_competition_role_invalid");
    // The judge role fits (59 chars) but the candidate role is 65 chars.
    await expect(
      compileWorkflow(boundarySource("c".repeat(53), "d".repeat(54)), commit),
    ).rejects.toThrow("workflow_competition_role_invalid");
    // Boundary: base 49 chars + '-candidate-' + 4-char candidate = 64 exactly.
    const compiled = await compileWorkflow(
      boundarySource("c".repeat(49), "e"),
      commit,
    );
    expect(compiled.nodes.qualify?.agent?.competition?.candidates).toHaveLength(
      2,
    );
  });

  it("rejects reviewer competitions whose derived roles exceed the runtime limit", async () => {
    const longReviewer = "a" + "b".repeat(63);
    const source = (reviewerId: string, candidateId: string) => `
version: 1
triggers:
  github.issue.started: review
nodes:
  review:
    executor: review
    role: review
    review:
      reviewers:
        - id: ${reviewerId}
          label: Holistic design review
          activation: always
          mode: blocking
          blocking_severities: [critical]
          competition:
            candidates:
              - id: ${candidateId}
                model: { id: openai/gpt-alpha, reasoning: low }
              - id: beta
                model: { id: anthropic/claude-beta, reasoning: low }
            judge:
              model: { id: openai/gpt-judge, reasoning: high }
    capabilities:
      - repository.read
    outputs:
      - review.status
    transitions:
      - terminal: succeeded
`;
    await expect(
      compileWorkflow(source(longReviewer, "alpha"), commit),
    ).rejects.toThrow("workflow_competition_role_invalid");
    await expect(
      compileWorkflow(source("review-holistic", "c".repeat(64)), commit),
    ).rejects.toThrow("workflow_competition_role_invalid");
    const compiled = await compileWorkflow(
      source("review-holistic", "alpha"),
      commit,
    );
    expect(
      compiled.nodes.review?.review?.reviewers[0]?.competition?.candidates,
    ).toHaveLength(2);
  });
});
