import { describe, expect, it } from "vitest";
import {
  addDaysIN,
  buildOutcomeProposals,
  directiveToDeadline,
  istDayEndUtcMs,
  istTodayIN,
  proposalKey,
} from "./outcomeProposals";

// Feature 2 — proposal generation (pure layer; server behaviour is
// integration-tested by construction: the mutation is a thin, typed
// wrapper around these functions).

const NOW = Date.UTC(2026, 8, 24, 6, 0, 0); // 24 Sep 2026, 11:30 IST

const baseCapture = {
  hearingId: "h1",
  hearingTitle: "Final arguments",
  matterId: "m1",
  status: "held" as const,
  outcomeText: "Arguments heard in part; order reserved.",
  hearingDateIN: "2026-09-24",
};

describe("proposal keys (duplicate prevention)", () => {
  it("are deterministic for the same hearing — a retry cannot double-generate", () => {
    const a = buildOutcomeProposals(baseCapture, NOW);
    const b = buildOutcomeProposals(baseCapture, NOW);
    expect(a.map((p) => p.key)).toEqual(b.map((p) => p.key));
  });

  it("differ across hearings and kinds", () => {
    const k1 = proposalKey("h1", "task", "File written submissions");
    const k2 = proposalKey("h2", "task", "File written submissions");
    const k3 = proposalKey("h1", "deadline", "File written submissions");
    expect(new Set([k1, k2, k3]).size).toBe(3);
  });

  it("always includes exactly one chronology proposal", () => {
    const items = buildOutcomeProposals(
      { ...baseCapture, directions: ["A", "B"] },
      NOW,
    );
    expect(items.filter((p) => p.kind === "chronology")).toHaveLength(1);
  });
});

describe("proposal generation", () => {
  it("creates chronology, client update and hearing flag payloads", () => {
    const items = buildOutcomeProposals(
      { ...baseCapture, updateNextPack: true },
      NOW,
    );
    const kinds = new Set(items.map((p) => p.kind));
    expect(kinds).toContain("chronology");
    expect(kinds).toContain("client_update");
    expect(kinds).toContain("hearing_pack");

    const chrono = items.find((p) => p.kind === "chronology")!;
    expect(chrono.payload.linkId).toBe("h1");
    expect(chrono.payload.linkKind).toBe("hearing");
    expect(String(chrono.payload.detail)).toContain("Arguments heard in part");
  });

  it("proposes one task per direction plus the next action", () => {
    const items = buildOutcomeProposals(
      {
        ...baseCapture,
        directions: ["File written submissions", "Serve summons"],
        nextAction: "Call the client",
      },
      NOW,
    );
    const taskTitles = items.filter((p) => p.kind === "task").map((p) => p.title);
    expect(taskTitles).toContain("File written submissions");
    expect(taskTitles).toContain("Serve summons");
    expect(taskTitles).toContain("Call the client");
  });

  it("client update uses the lawyer's summary and never promises outcomes", () => {
    const items = buildOutcomeProposals(
      { ...baseCapture, clientSummary: "We made good progress today." },
      NOW,
    );
    const update = items.find((p) => p.kind === "client_update")!;
    expect(String(update.payload.body)).toContain("We made good progress today.");
    expect(String(update.payload.body)).not.toMatch(/we will win|guaranteed/i);
  });

  it("next-hearing proposals only appear with a valid future date", () => {
    const withDate = buildOutcomeProposals(
      {
        ...baseCapture,
        nextHearing: { title: "Order pronouncement", atIso: new Date(NOW + 7 * 864e5).toISOString() },
      },
      NOW,
    );
    expect(withDate.filter((p) => p.kind === "next_hearing")).toHaveLength(1);

    const withoutDate = buildOutcomeProposals(
      { ...baseCapture, nextHearing: { title: "X", atIso: "not-a-date" } },
      NOW,
    );
    expect(withoutDate.filter((p) => p.kind === "next_hearing")).toHaveLength(0);
  });
});

describe("deadline proposals (source + rule + explicit approval)", () => {
  it("carry the source line and calculation rule in the payload", () => {
    const items = buildOutcomeProposals(
      {
        ...baseCapture,
        deadlines: [
          {
            title: "File written submissions",
            category: "court_order",
            date: "2026-10-24",
            source: "File written submissions within 30 days — order dated 24 Sep 2026",
            rule: "30 days from the hearing date (2026-09-24), counted in IST",
          },
        ],
      },
      NOW,
    );
    const dl = items.find((p) => p.kind === "deadline")!;
    expect(dl.payload.source).toContain("within 30 days");
    expect(dl.payload.rule).toContain("30 days");
    expect(dl.payload.dueAt).toBe(istDayEndUtcMs("2026-10-24"));
  });

  it("directiveToDeadline computes the IST date from a day count", () => {
    const rule = directiveToDeadline(
      "File affidavit within 15 days",
      "compliance",
      15,
      "2026-09-10",
      "File affidavit",
    );
    expect(rule).not.toBeNull();
    expect(rule!.date).toBe("2026-09-25");
    expect(rule!.rule).toContain("15 days from the hearing date");
  });

  it("refuses empty sources and non-positive day counts", () => {
    expect(directiveToDeadline("", "filing", 30, "2026-09-24", "X")).toBeNull();
    expect(directiveToDeadline("x", "filing", 0, "2026-09-24", "X")).toBeNull();
    expect(directiveToDeadline("x", "filing", -5, "2026-09-24", "X")).toBeNull();
  });

  it("addDaysIN respects month and year boundaries in IST", () => {
    expect(addDaysIN("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysIN("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIN("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDaysIN("bad-date", 5)).toBeNull();
  });

  it("istTodayIN and istDayEndUtcMs agree on the +05:30 convention", () => {
    const today = istTodayIN(NOW);
    expect(today).toBe("2026-09-24");
    // IST day ends 18:59:59.999 UTC the same calendar day.
    expect(istDayEndUtcMs(today)).toBe(Date.UTC(2026, 8, 24, 18, 59, 59, 999));
  });
});
