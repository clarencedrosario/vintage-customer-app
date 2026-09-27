import { describe, expect, it } from "vitest";
import {
  balanceFor,
  daysBetweenInclusive,
  decrementBalance,
  leaveApplicationError,
  unpaidDaysFor,
  type LeaveBalance,
} from "./hrLeave";

const BAL: LeaveBalance[] = [
  { leaveType: "casual", balance: 6, asOf: "2026-09-01" },
  { leaveType: "earned", balance: 12.5, asOf: "2026-09-01" },
];

describe("daysBetweenInclusive", () => {
  it("counts both ends (same day = 1)", () => {
    expect(daysBetweenInclusive("2026-09-01", "2026-09-01")).toBe(1);
    expect(daysBetweenInclusive("2026-09-01", "2026-09-03")).toBe(3);
    expect(daysBetweenInclusive("2026-02-28", "2026-03-01")).toBe(2);
    expect(daysBetweenInclusive("2024-02-28", "2024-02-29")).toBe(2); // leap
  });

  it("rejects malformed dates", () => {
    expect(() => daysBetweenInclusive("2026-9-1", "2026-09-03")).toThrow();
    expect(() => daysBetweenInclusive("2026-09-01", "01-09-2026")).toThrow();
  });
});

describe("leaveApplicationError", () => {
  it("accepts a valid application", () => {
    expect(
      leaveApplicationError({
        startDate: "2026-10-05",
        endDate: "2026-10-07",
        days: 3,
      }),
    ).toBeNull();
  });

  it("rejects inverted ranges and non-positive days", () => {
    expect(
      leaveApplicationError({
        startDate: "2026-10-07",
        endDate: "2026-10-05",
        days: 3,
      }),
    ).toMatch(/end before it starts/);
    expect(
      leaveApplicationError({
        startDate: "2026-10-05",
        endDate: "2026-10-05",
        days: 0,
      }),
    ).toMatch(/at least half a day/);
  });

  it("allows a half-day and rejects days that contradict the range", () => {
    expect(
      leaveApplicationError({
        startDate: "2026-10-05",
        endDate: "2026-10-05",
        days: 0.5,
      }),
    ).toBeNull();
    expect(
      leaveApplicationError({
        startDate: "2026-10-05",
        endDate: "2026-10-05",
        days: 2,
      }),
    ).toMatch(/do not match/);
  });
});

describe("balanceFor / unpaidDaysFor", () => {
  it("reads balances and defaults to zero for unknown types", () => {
    expect(balanceFor(BAL, "earned")).toBe(12.5);
    expect(balanceFor(BAL, "sick")).toBe(0);
    expect(balanceFor(undefined, "casual")).toBe(0);
  });

  it("splits applications into paid and LOP parts", () => {
    expect(unpaidDaysFor(BAL, "casual", 4)).toBe(0);
    expect(unpaidDaysFor(BAL, "casual", 8)).toBe(2);
    expect(unpaidDaysFor(BAL, "sick", 3)).toBe(3);
  });
});

describe("decrementBalance", () => {
  it("decrements in place and stamps asOf", () => {
    const out = decrementBalance(BAL, "casual", 1.5, "2026-09-27");
    expect(balanceFor(out, "casual")).toBe(4.5);
    expect(out.find((b) => b.leaveType === "casual")?.asOf).toBe("2026-09-27");
    expect(balanceFor(out, "earned")).toBe(12.5); // untouched
  });

  it("reaches exactly zero without going negative", () => {
    const out = decrementBalance(BAL, "casual", 6, "2026-09-27");
    expect(balanceFor(out, "casual")).toBe(0);
  });

  it("refuses to overdraw with an explicit error", () => {
    expect(() => decrementBalance(BAL, "casual", 6.5, "2026-09-27")).toThrow(
      /Insufficient casual balance: 6 day\(s\) available, 6.5 requested/,
    );
  });

  it("creates a row for a first use of an unknown type", () => {
    expect(() => decrementBalance(BAL, "sick", 1, "2026-09-27")).toThrow(
      /Insufficient sick/,
    );
    expect(() => decrementBalance(undefined, "earned", 0.5, "2026-09-27")).toThrow();
    expect(() => decrementBalance([], "earned", 0, "2026-09-27")).toThrow();
  });

  it("does not mutate the input array", () => {
    const snapshot = JSON.stringify(BAL);
    decrementBalance(BAL, "casual", 2, "2026-09-27");
    expect(JSON.stringify(BAL)).toBe(snapshot);
  });
});
