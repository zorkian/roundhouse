import { describe, expect, it } from "vitest";

import { approvalEventSchema, startRunSchema } from "./contracts.js";

describe("control-plane contracts", () => {
  it("accepts a valid start request", () => {
    expect(
      startRunSchema.parse({
        idempotencyKey: "issue-123-attempt-1",
        subject: "Fix issue 123",
        planRevision: 1,
      }),
    ).toMatchObject({ planRevision: 1 });
  });

  it("rejects an approval without a positive plan revision", () => {
    expect(() =>
      approvalEventSchema.parse({
        approvalId: "approval-id",
        actorId: "maintainer",
        planRevision: 0,
        occurredAt: new Date().toISOString(),
      }),
    ).toThrow();
  });
});
