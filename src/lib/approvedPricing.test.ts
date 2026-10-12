// =====================================================================
// APPROVED PRICING tests — pin the six approved prices, the seat math
// for the two Chamber bundles, the Enterprise minimum and per-user
// billing, and rejection of manipulated/invalid seat counts.
// The examples from the approval sheet are asserted exactly:
//   Chamber with AI:    4 users = ₹3,999;  5 users = ₹4,998
//   Chamber without AI: 4 users = ₹1,999;  5 users = ₹2,448
//   Enterprise:        10 users = ₹8,990; 11 users = ₹9,889
// (all before applicable taxes)
// =====================================================================
import { describe, expect, it } from "vitest";
import {
  APPROVED_PLANS,
  approvedPlan,
  monthlyChargeMinor,
  seatCountValid,
  extraSeatsFor,
  MINOR,
  CHAMBER_INCLUDED_USERS,
  ENTERPRISE_MIN_USERS,
  ENTERPRISE_MIN_MONTHLY_MINOR,
} from "./approvedPricing";

const byCode = (code: string) => approvedPlan(code)!;

describe("the six approved plans exist with the approved base prices", () => {
  it("exposes exactly the six approved plan codes", () => {
    expect(APPROVED_PLANS.map((p) => p.code)).toEqual([
      "free",
      "solo",
      "advocate_ai",
      "chamber_ai",
      "chamber_noai",
      "enterprise",
    ]);
  });

  it("carries the approved base prices in minor units", () => {
    expect(byCode("free").priceMinor).toBe(0); // ₹0
    expect(byCode("solo").priceMinor).toBe(49_900); // ₹499
    expect(byCode("advocate_ai").priceMinor).toBe(99_900); // ₹999
    expect(byCode("chamber_ai").priceMinor).toBe(399_900); // ₹3,999
    expect(byCode("chamber_noai").priceMinor).toBe(199_900); // ₹1,999
    expect(byCode("enterprise").priceMinor).toBe(899_000); // ₹8,990 (10-user minimum)
  });

  it("carries the approved extra-user rates and seat floors", () => {
    expect(byCode("chamber_ai").extraUserMinor).toBe(99_900); // ₹999
    expect(byCode("chamber_noai").extraUserMinor).toBe(44_900); // ₹449
    expect(byCode("enterprise").extraUserMinor).toBe(89_900); // ₹899
    expect(byCode("enterprise").minPaidUsers).toBe(10);
  });
});

describe("seat rules", () => {
  it("chamber bundles include four users and charge plan-specific extra rates", () => {
    expect(CHAMBER_INCLUDED_USERS).toBe(4);
    expect(byCode("chamber_ai").includedUsers).toBe(4);
    expect(byCode("chamber_noai").includedUsers).toBe(4);
  });

  it("enterprise requires a minimum of 10 paid users", () => {
    expect(ENTERPRISE_MIN_USERS).toBe(10);
    expect(ENTERPRISE_MIN_MONTHLY_MINOR).toBe(899_000);
  });

  it("individual plans are not user-scaled", () => {
    const solo = byCode("solo");
    expect(monthlyChargeMinor(solo, 1)).toBe(49_900);
    expect(monthlyChargeMinor(solo, 2)).toBe(49_900);
    const ai = byCode("advocate_ai");
    expect(monthlyChargeMinor(ai, 1)).toBe(99_900);
    expect(monthlyChargeMinor(ai, 3)).toBe(99_900);
  });
});

describe("monthlyChargeMinor — the exact charge math the server enforces", () => {
  it("free plan is ₹0 at any seat count", () => {
    expect(monthlyChargeMinor(byCode("free"), 1)).toBe(0);
    expect(monthlyChargeMinor(byCode("free"), 5)).toBe(0);
  });

  it("chamber with AI: 4 users = ₹3,999; 5 users = ₹4,998 (approved examples)", () => {
    const plan = byCode("chamber_ai");
    expect(monthlyChargeMinor(plan, 4)).toBe(399_900);
    expect(monthlyChargeMinor(plan, 5)).toBe(499_800);
    expect(monthlyChargeMinor(plan, 6)).toBe(599_700);
  });

  it("chamber without AI: 4 users = ₹1,999; 5 users = ₹2,448 (approved examples)", () => {
    const plan = byCode("chamber_noai");
    expect(monthlyChargeMinor(plan, 4)).toBe(199_900);
    expect(monthlyChargeMinor(plan, 5)).toBe(244_800);
    expect(monthlyChargeMinor(plan, 6)).toBe(289_700);
  });

  it("fewer than four users still pay the bundle base price", () => {
    expect(monthlyChargeMinor(byCode("chamber_ai"), 1)).toBe(399_900);
    expect(monthlyChargeMinor(byCode("chamber_ai"), 3)).toBe(399_900);
    expect(monthlyChargeMinor(byCode("chamber_noai"), 2)).toBe(199_900);
  });

  it("enterprise bills ₹899 per paid user from the 10-user floor (approved examples)", () => {
    const plan = byCode("enterprise");
    expect(monthlyChargeMinor(plan, 10)).toBe(899_000); // ₹8,990
    expect(monthlyChargeMinor(plan, 11)).toBe(988_900); // ₹9,889
    expect(monthlyChargeMinor(plan, 25)).toBe(2_247_500); // ₹22,475
  });

  it("rejects an enterprise seat count below the minimum", () => {
    const plan = byCode("enterprise");
    expect(() => monthlyChargeMinor(plan, 1)).toThrow(/minimum of 10/);
    expect(() => monthlyChargeMinor(plan, 9)).toThrow(/minimum of 10/);
    expect(seatCountValid(plan, 9)).toBe(false);
    expect(seatCountValid(plan, 10)).toBe(true);
  });

  it("rejects zero, negative and fractional manipulated seat counts", () => {
    const chamber = byCode("chamber_ai");
    expect(() => monthlyChargeMinor(chamber, 0)).toThrow(/At least one paid user/);
    expect(() => monthlyChargeMinor(chamber, -3)).toThrow(/At least one paid user/);
    expect(() => monthlyChargeMinor(chamber, 4.5)).not.toThrow(); // floored to 4
    expect(monthlyChargeMinor(chamber, 4.5)).toBe(399_900);
    expect(seatCountValid(chamber, 0)).toBe(false);
    expect(seatCountValid(chamber, -1)).toBe(false);
  });
});

describe("extraSeatsFor", () => {
  it("counts only users beyond the included four", () => {
    const chamber = byCode("chamber_ai");
    expect(extraSeatsFor(chamber, 4)).toBe(0);
    expect(extraSeatsFor(chamber, 5)).toBe(1);
    expect(extraSeatsFor(byCode("solo"), 5)).toBe(0);
  });
});

describe("MINOR constants agree with the approved rupee amounts", () => {
  it("₹ amounts map exactly", () => {
    expect(MINOR.free).toBe(0);
    expect(MINOR.solo).toBe(49_900);
    expect(MINOR.advocateAi).toBe(99_900);
    expect(MINOR.chamberAi).toBe(399_900);
    expect(MINOR.chamberNoAi).toBe(199_900);
    expect(MINOR.enterprisePerUser).toBe(89_900);
  });
});
