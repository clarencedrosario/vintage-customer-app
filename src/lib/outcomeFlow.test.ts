import { describe, expect, it } from "vitest";
import { suggestFromOutcome } from "./outcomeFlow";

describe("suggestFromOutcome", () => {
  it("suggests a chronology task when the hearing is held", () => {
    const s = suggestFromOutcome("held", "Arguments completed", undefined, undefined);
    expect(s.tasks.some((t) => /chronology/i.test(t.title))).toBe(true);
  });

  it("suggests adjournment follow-up and next-hearing prep when adjourned", () => {
    const s = suggestFromOutcome(
      "adjourned",
      "Adjourned at defendant's request",
      undefined,
      "Final arguments",
    );
    expect(s.tasks.some((t) => /adjournment grounds/i.test(t.title))).toBe(true);
    expect(s.tasks.some((t) => /Prepare for Final arguments/.test(t.title))).toBe(
      true,
    );
  });

  it("puts the lawyer's stated next action first with a near-term due date", () => {
    const s = suggestFromOutcome(
      "held",
      "Order reserved",
      "File written submissions",
      undefined,
    );
    expect(s.tasks[0]!.title).toBe("File written submissions");
    expect(s.tasks[0]!.dueInDays).toBe(3);
    // Filing-related wording maps to the schema's "filing" kind.
    expect(s.tasks[0]!.kind).toBe("filing");
  });

  it("maps non-filing next actions to general kind", () => {
    const s = suggestFromOutcome("held", "Settled in part", "Call the client", undefined);
    expect(s.tasks[0]!.kind).toBe("general");
  });

  it("produces a client update that names the result without promising outcomes", () => {
    const s = suggestFromOutcome(
      "adjourned",
      "The court adjourned to settle issues",
      undefined,
      "Framing of issues",
    );
    expect(s.clientUpdate).toMatch(/adjourned/);
    expect(s.clientUpdate).toMatch(/The court adjourned to settle issues/);
    expect(s.clientUpdate).toMatch(/next hearing/);
    // No internal jargon or strategy promises.
    expect(s.clientUpdate).not.toMatch(/we will win|guarantee|strategy/i);
  });

  it("never returns an empty client update", () => {
    const s = suggestFromOutcome("held", "Matter dismissed", undefined, undefined);
    expect(s.clientUpdate.length).toBeGreaterThan(20);
  });

  it("caps task titles and update length", () => {
    const long = "x".repeat(5000);
    const s = suggestFromOutcome("held", long, long, undefined);
    for (const t of s.tasks) expect(t.title.length).toBeLessThanOrEqual(200);
    expect(s.clientUpdate.length).toBeLessThanOrEqual(4000);
  });
});
