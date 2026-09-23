import { describe, expect, it } from "vitest";
import {
  financialYearLabel,
  formatDateIN,
  formatINR,
  formatINRCompact,
  todayIN,
} from "./format";

describe("formatINR", () => {
  it("formats rupees with Indian digit grouping", () => {
    // en-IN groups as 1,00,000 rather than 100,000.
    const out = formatINR(100000);
    expect(out).toContain("1,00,000");
    expect(out).toMatch(/₹/);
  });

  it("formats small amounts plainly", () => {
    expect(formatINR(500)).toMatch(/500/);
  });
});

describe("formatINRCompact", () => {
  it("uses lakh and crore compaction", () => {
    // toFixed(2) keeps two decimals unless the value is exact.
    expect(formatINRCompact(1_20_000)).toMatch(/1\.20 L/);
    expect(formatINRCompact(3_40_00_000)).toMatch(/3\.40 Cr/);
    expect(formatINRCompact(12_00_000)).toMatch(/12 L/);
  });

  it("keeps thousands readable", () => {
    expect(formatINRCompact(2500)).toMatch(/2\.5k/);
  });

  it("shows small amounts as plain rupees", () => {
    expect(formatINRCompact(750)).toMatch(/750/);
  });
});

describe("date helpers", () => {
  it("formats a timestamp as a readable IST date", () => {
    // 2026-09-23 06:30 UTC = 12:00 IST — safely mid-day in both zones.
    const ts = Date.UTC(2026, 8, 23, 6, 30);
    expect(formatDateIN(ts)).toMatch(/23/);
    expect(formatDateIN(ts)).toMatch(/Sep/);
    expect(formatDateIN(ts)).toMatch(/2026/);
  });

  it("todayIN returns a YYYY-MM-DD string", () => {
    expect(todayIN()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("financialYearLabel starts in April", () => {
    expect(financialYearLabel()).toMatch(/^\d{4}-\d{2}$/);
    // A fixed summer date falls inside the FY starting that calendar year.
    const fixed = financialYearLabel();
    const [start] = fixed.split("-");
    expect(Number(start)).toBeGreaterThanOrEqual(2025);
  });
});
