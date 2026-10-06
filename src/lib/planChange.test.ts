import { describe, expect, it } from "vitest";
import {
  describePlanChange,
  planChangeConfirmText,
  formatPlanCharge,
  formatPlanDate,
  type PlanChangeFacts,
} from "./planChange";

// Pin the EXACT figures shown before a plan-change confirmation: the
// effective date, the next charge, zero-charged-today, the manual
// renewal label and the unpaid consequences.

const NOW = Date.parse("2026-10-06T10:00:00+05:30");
const PERIOD_END = Date.parse("2026-10-31T23:59:59+05:30");

const facts = (over: Partial<PlanChangeFacts> = {}): PlanChangeFacts => ({
  planName: "Practice + AI",
  interval: "monthly",
  priceMinor: 99_900,
  currentPeriodEnd: PERIOD_END,
  timing: "immediately",
  ...over,
});

describe("describePlanChange — the pre-confirmation facts", () => {
  it("immediate switch: effective today, nothing charged today, next charge is the new plan's full price", () => {
    const d = describePlanChange(facts(), NOW);
    expect(d.effectiveDate).toBe("6 Oct 2026");
    expect(d.chargedTodayMinor).toBe(0);
    expect(d.nextChargeMinor).toBe(99_900);
    expect(d.policyLabel).toContain("Next-billing-period change");
    expect(d.policyLabel).toContain("no proration");
    expect(d.policyLabel).toContain("nothing is charged today");
    expect(d.ifUnpaid).toContain("grace period");
    expect(d.ifUnpaid).toContain("read-only");
  });

  it("period-end switch: effective at the explicit period-end date", () => {
    const d = describePlanChange(facts({ timing: "period_end" }), NOW);
    expect(d.effectiveDate).toBe("31 Oct 2026");
    expect(d.nextChargeMinor).toBe(99_900);
    expect(d.chargedTodayMinor).toBe(0);
  });

  it("the next charge is the NEW plan's price, never prorated from the old one", () => {
    const d = describePlanChange(
      facts({ planName: "Firm + Advanced AI", interval: "yearly", priceMinor: 1_199_900 }),
      NOW,
    );
    expect(d.nextChargeMinor).toBe(1_199_900);
  });

  it("the unpaid window names the +7-day grace boundary", () => {
    const d = describePlanChange(facts(), NOW);
    expect(d.ifUnpaid).toContain("7 Nov 2026"); // PERIOD_END + 7 days
  });

  it("clamps malformed inputs instead of inventing amounts or dates", () => {
    const d = describePlanChange(facts({ priceMinor: -500, currentPeriodEnd: -1 }), NOW);
    expect(d.nextChargeMinor).toBe(0);
    // Immediate switch takes effect at the real current time (never the
    // clamped zero), while the unpaid window honestly derives from the
    // clamped period end.
    expect(d.effectiveDate).toBe("6 Oct 2026");
    expect(d.ifUnpaid).toContain("8 Jan 1970");
    // A period-end switch with a corrupt period end shows the clamped
    // date rather than inventing a future one.
    const de = describePlanChange(facts({ currentPeriodEnd: -1, timing: "period_end" }), NOW);
    expect(de.effectiveDate).toBe("1 Jan 1970");
  });
});

describe("planChangeConfirmText — the sentence shown in the dialog", () => {
  it("contains plan name, timing date, both amounts and the manual-renewal line", () => {
    const text = planChangeConfirmText(facts(), NOW);
    expect(text).toContain("Switch to Practice + AI (monthly) now (6 Oct 2026)?");
    expect(text).toContain("Charged today: ₹0.00");
    expect(text).toContain("Next charge: ₹999.00");
    expect(text).toContain("manual");
    expect(text).toContain("No automatic card charge is made");
  });

  it("period-end variant names the scheduled date, not 'now'", () => {
    const text = planChangeConfirmText(facts({ timing: "period_end" }), NOW);
    expect(text).toContain("at the end of the current period (31 Oct 2026)");
    expect(text).not.toContain("now (6 Oct 2026)");
  });
});

describe("formatters", () => {
  it("renders minor units as en-IN rupees and epoch as en-IN dates", () => {
    expect(formatPlanCharge(598_800)).toBe("₹5,988.00");
    expect(formatPlanDate(PERIOD_END)).toBe("31 Oct 2026");
  });
});
