import { describe, expect, it } from "vitest";
import {
  buildRescheduleAudit,
  carryReminderDays,
  describeClash,
  detectClashes,
  effectiveAdvocate,
  istDay,
  istDayBounds,
  istDayOrThrow,
  rescheduleRejection,
} from "./hearingSchedule";

// ---------------------------------------------------------------
// IST day model
// ---------------------------------------------------------------
// 2026-09-26T10:00:00+05:30 in epoch ms
const IST_MORNING = new Date("2026-09-26T10:00:00+05:30").getTime();
const IST_LATE_NIGHT = new Date("2026-09-26T23:30:00+05:30").getTime();
// 23:30 UTC = 05:00 IST the NEXT day
const UTC_EVE = Date.UTC(2026, 8, 26, 23, 30);

describe("IST day model", () => {
  it("maps timestamps to their Asia/Kolkata calendar day", () => {
    expect(istDay(IST_MORNING)).toBe("2026-09-26");
    expect(istDay(IST_LATE_NIGHT)).toBe("2026-09-26");
    expect(istDay(UTC_EVE)).toBe("2026-09-27"); // 05:00 IST next day
  });

  it("rejects invalid timestamps in istDayOrThrow", () => {
    expect(() => istDayOrThrow(Number.NaN)).toThrow("Invalid hearing time.");
    expect(istDayOrThrow(IST_MORNING)).toBe("2026-09-26");
  });

  it("bounds a YYYY-MM-DD IST day correctly", () => {
    const { start, end } = istDayBounds("2026-09-26");
    expect(istDay(start)).toBe("2026-09-26");
    expect(istDay(end)).toBe("2026-09-26");
    expect(end - start).toBe(24 * 60 * 60 * 1000 - 1);
    // 00:00 IST = 18:30 UTC the day before
    expect(new Date(start).toISOString()).toBe("2026-09-25T18:30:00.000Z");
  });

  it("rejects malformed day strings", () => {
    expect(() => istDayBounds("26-09-2026")).toThrow("YYYY-MM-DD");
  });
});

// ---------------------------------------------------------------
// Clash detection
// ---------------------------------------------------------------
const H1 = {
  hearingId: "h1",
  matterId: "m1",
  title: "City Bank v. Rao — CS 123/2026",
  at: IST_MORNING + 60 * 60 * 1000, // 11:00 IST
  courtroom: "Courtroom 3",
  appearingAdvocateId: "advA",
};

describe("detectClashes", () => {
  it("flags the same advocate at an overlapping time", () => {
    const clashes = detectClashes(
      { at: IST_MORNING + 60 * 60 * 1000 + 5 * 60 * 1000, appearingAdvocateId: "advA" },
      [H1],
    );
    expect(clashes).toHaveLength(1);
    expect(clashes[0].reason).toBe("same_advocate");
    expect(clashes[0].hearingId).toBe("h1");
  });

  it("flags the same courtroom at an overlapping time", () => {
    const clashes = detectClashes(
      { at: H1.at + 10 * 60 * 1000, courtroom: "Courtroom 3", appearingAdvocateId: "advB" },
      [H1],
    );
    expect(clashes).toHaveLength(1);
    expect(clashes[0].reason).toBe("same_courtroom");
  });

  it("does not flag different advocates in different courtrooms", () => {
    const clashes = detectClashes(
      { at: H1.at + 10 * 60 * 1000, courtroom: "Courtroom 7", appearingAdvocateId: "advB" },
      [H1],
    );
    expect(clashes).toHaveLength(0);
  });

  it("marks a bare time overlap with no resource info at all as adjacent", () => {
    const bare = { ...H1, courtroom: undefined, appearingAdvocateId: undefined };
    // No courtroom, no appearing advocate, no fallback lead: data too
    // sparse to rule out a clash → weak "adjacent" warning.
    const clashes = detectClashes({ at: H1.at + 60 * 1000 }, [bare]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].reason).toBe("adjacent");
  });

  it("stays silent when the candidate has a known lead but the other row is sparse", () => {
    const bare = { ...H1, courtroom: undefined, appearingAdvocateId: undefined };
    // Candidate's lead is leadX; the other hearing names nobody — the
    // candidate's diary alone cannot establish a shared resource, so no
    // warning is manufactured.
    expect(
      detectClashes({ at: H1.at + 60 * 1000, fallbackAdvocateId: "leadX" }, [bare]),
    ).toHaveLength(0);
  });

  it("matches the matter's lead lawyer against an existing hearing's advocate", () => {
    // The new hearing names no appearing advocate; the matter's lead is
    // advA — the same advocate already in H1's diary. This IS a clash.
    const clashes = detectClashes(
      { at: H1.at + 10 * 60 * 1000, fallbackAdvocateId: "advA" },
      [H1],
    );
    expect(clashes).toHaveLength(1);
    expect(clashes[0].reason).toBe("same_advocate");
  });

  it("does not clash when the lead lawyer differs from the existing advocate", () => {
    const clashes = detectClashes(
      { at: H1.at + 10 * 60 * 1000, fallbackAdvocateId: "leadOther" },
      [H1],
    );
    expect(clashes).toHaveLength(0);
  });

  it("falls back correctly when the existing hearing has no appearing advocate", () => {
    const noAdvocate = { ...H1, appearingAdvocateId: undefined };
    const clashes = detectClashes(
      { at: H1.at + 10 * 60 * 1000, fallbackAdvocateId: "leadX" },
      [noAdvocate],
    );
    // The existing row has no advocate of its own; the candidate's lead
    // alone cannot establish the OTHER hearing's advocate, so no clash.
    expect(clashes).toHaveLength(0);
  });

  it("ignores hearings on other IST days", () => {
    const otherDay = { ...H1, at: H1.at + 24 * 60 * 60 * 1000 };
    expect(
      detectClashes({ at: H1.at + 10 * 60 * 1000, appearingAdvocateId: "advA" }, [otherDay]),
    ).toHaveLength(0);
  });

  it("respects the buffer window", () => {
    // 45 minutes later — beyond the default 30-minute buffer.
    expect(
      detectClashes({ at: H1.at + 45 * 60 * 1000, appearingAdvocateId: "advA" }, [H1]),
    ).toHaveLength(0);
    // But flagged when the caller widens the buffer to an hour.
    expect(
      detectClashes(
        { at: H1.at + 45 * 60 * 1000, appearingAdvocateId: "advA" },
        [H1],
        60 * 60 * 1000,
      ),
    ).toHaveLength(1);
  });

  it("excludes the hearing being rescheduled (self)", () => {
    expect(
      detectClashes(
        { hearingId: "h1", at: H1.at + 5 * 60 * 1000, appearingAdvocateId: "advA" },
        [H1],
      ),
    ).toHaveLength(0);
  });

  it("deduplicates repeated candidate overlap reasons into one clash row", () => {
    // Same advocate AND same courtroom → single row, courtroom reason wins.
    const clashes = detectClashes(
      { at: H1.at + 5 * 60 * 1000, courtroom: "Courtroom 3", appearingAdvocateId: "advA" },
      [H1],
    );
    expect(clashes).toHaveLength(1);
    expect(clashes[0].reason).toBe("same_courtroom");
  });
});

describe("effectiveAdvocate", () => {
  it("prefers the appearing advocate over the matter lead", () => {
    expect(effectiveAdvocate("advA", "leadZ")).toBe("advA");
  });
  it("falls back to the matter lead", () => {
    expect(effectiveAdvocate(undefined, "leadZ")).toBe("leadZ");
    expect(effectiveAdvocate(undefined, undefined)).toBeUndefined();
  });
});

describe("describeClash", () => {
  it("renders a human-readable warning", () => {
    const text = describeClash({ ...H1, reason: "same_advocate" });
    expect(text).toContain("City Bank v. Rao");
    expect(text).toContain("same advocate");
    expect(text).toContain("2026");
  });
});

// ---------------------------------------------------------------
// Reschedule validation
// ---------------------------------------------------------------
const NOW = IST_MORNING;

describe("rescheduleRejection", () => {
  it("rejects moving a held hearing", () => {
    expect(
      rescheduleRejection({ currentStatus: "held", currentAt: NOW, newAt: NOW + 86400000, now: NOW }),
    ).toMatch(/held hearing cannot be rescheduled/i);
  });

  it("rejects moving a cancelled hearing", () => {
    expect(
      rescheduleRejection({ currentStatus: "cancelled", currentAt: NOW, newAt: NOW + 86400000, now: NOW }),
    ).toMatch(/cancelled hearing cannot be rescheduled/i);
  });

  it("allows scheduled and adjourned hearings", () => {
    expect(
      rescheduleRejection({ currentStatus: "scheduled", currentAt: NOW, newAt: NOW + 86400000, now: NOW }),
    ).toBeNull();
    expect(
      rescheduleRejection({ currentStatus: "adjourned", currentAt: NOW, newAt: NOW + 86400000, now: NOW }),
    ).toBeNull();
  });

  it("rejects a no-op reschedule", () => {
    expect(
      rescheduleRejection({ currentStatus: "scheduled", currentAt: NOW, newAt: NOW, now: NOW }),
    ).toMatch(/already scheduled then/i);
  });

  it("rejects past dates beyond the 24h grace", () => {
    expect(
      rescheduleRejection({ currentStatus: "scheduled", currentAt: NOW, newAt: NOW - 25 * 3600000, now: NOW }),
    ).toMatch(/future date/i);
    expect(
      rescheduleRejection({ currentStatus: "scheduled", currentAt: NOW, newAt: NOW - 12 * 3600000, now: NOW }),
    ).toBeNull();
  });
});

describe("audit trail helpers", () => {
  it("builds a complete reschedule audit record", () => {
    const rec = buildRescheduleAudit("u1", "A. Partner", "Adjourned by court", 1000, 2000, 5000);
    expect(rec).toEqual({
      at: 5000,
      byId: "u1",
      byName: "A. Partner",
      reason: "Adjourned by court",
      oldAt: 1000,
      newAt: 2000,
    });
  });

  it("substitutes a placeholder when no reason is given and truncates long ones", () => {
    expect(buildRescheduleAudit("u1", "A", "   ", 1, 2, 3).reason).toBe(
      "No reason recorded.",
    );
    expect(
      buildRescheduleAudit("u1", "A", "x".repeat(600), 1, 2, 3).reason.length,
    ).toBe(500);
  });

  it("carries reminder cadence through a reschedule", () => {
    expect(carryReminderDays([30, 14, 7, 3, 1, 0])).toEqual([30, 14, 7, 3, 1, 0]);
    expect(carryReminderDays(undefined)).toBeUndefined();
    expect(carryReminderDays([])).toBeUndefined();
  });
});
