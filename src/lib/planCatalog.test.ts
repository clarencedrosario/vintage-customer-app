import { describe, expect, it } from "vitest";
import {
  PLAN_CATEGORIES,
  categoryLabel,
  monthlyEquivalent,
  annualSavings,
  evaluateAiAccess,
  AI_RESERVE_ESTIMATE_TOKENS,
  type AiAccessInput,
} from "./planCatalog";

// =====================================================================
// Pure tests for the commercial-honesty rules. These functions are the
// exact logic the server (entitlements.ts) and both pricing surfaces
// (Pricing.tsx, SubscriptionCard.tsx) use — nothing is re-implemented.
// =====================================================================

const aiInput = (over: Partial<AiAccessInput> = {}): AiAccessInput => ({
  aiEnabled: true,
  status: "active",
  advancedTierPlan: false,
  allowanceTokens: 100_000,
  usedTokens: 0,
  reservedTokens: 0,
  runningJobs: 0,
  maxConcurrentJobs: 2,
  ...over,
});

describe("Plan categories (A–D)", () => {
  it("exposes exactly the four commercial categories", () => {
    expect(PLAN_CATEGORIES.map((c) => c.id)).toEqual([
      "practice",
      "practice_ai",
      "firm_ai",
      "enterprise",
    ]);
  });

  it("labels known categories and falls back honestly for unknown ones", () => {
    expect(categoryLabel("practice")).toBe("Practice Management");
    expect(categoryLabel("practice_ai")).toBe("Practice Management + AI");
    expect(categoryLabel("firm_ai")).toBe("Firm / Advanced AI");
    expect(categoryLabel("enterprise")).toBe("Enterprise");
    expect(categoryLabel("nonexistent")).toBe("Plan");
    expect(categoryLabel(null)).toBe("Plan");
    expect(categoryLabel(undefined)).toBe("Plan");
  });
});

describe("monthlyEquivalent (derived, never invented)", () => {
  it("derives the monthly figure from a configured yearly price", () => {
    expect(monthlyEquivalent(598_800)).toBe(49_900);
    expect(monthlyEquivalent(4_000)).toBe(333); // 333.33 → rounds to 333
  });

  it("returns null for absent, zero or negative prices — never 0 or ∞", () => {
    expect(monthlyEquivalent(null)).toBe(null);
    expect(monthlyEquivalent(undefined)).toBe(null);
    expect(monthlyEquivalent(0)).toBe(null);
    expect(monthlyEquivalent(-100)).toBe(null);
  });
});

describe("annualSavings (computed from configured prices only)", () => {
  it("computes genuine savings from both configured prices", () => {
    // ₹499.00/month × 12 = ₹5,988.00 vs ₹4,990.00/year.
    expect(annualSavings(49_900, 499_000)).toEqual({
      amountMinor: 99_800,
      percent: 17, // round(99800 / 598800 × 100)
    });
    expect(annualSavings(99_900, 999_000)).toEqual({
      amountMinor: 199_800,
      percent: 17,
    });
  });

  it("returns null when either price is missing — no discount claims without data", () => {
    expect(annualSavings(null, 499_000)).toBe(null);
    expect(annualSavings(49_900, null)).toBe(null);
    expect(annualSavings(undefined, undefined)).toBe(null);
  });

  it("returns null for zero or negative prices", () => {
    expect(annualSavings(0, 499_000)).toBe(null);
    expect(annualSavings(49_900, 0)).toBe(null);
    expect(annualSavings(-1, 499_000)).toBe(null);
  });

  it("returns null when the yearly price is NOT genuinely cheaper", () => {
    // Equal to 12×monthly → no discount, no claim.
    expect(annualSavings(49_900, 598_800)).toBe(null);
    // Yearly more expensive → never advertised as savings.
    expect(annualSavings(49_900, 700_000)).toBe(null);
  });
});

describe("evaluateAiAccess — the single gate the server enforces", () => {
  it("refuses with a specific reason when there is no subscription", () => {
    const r = evaluateAiAccess(aiInput({ status: "none" }));
    expect(r.allowed).toBe(false);
    expect(r.tier).toBe("none");
    expect(r.reason).toContain("no subscription");
    expect(r.reason).toContain("choose a plan that includes AI");
  });

  it("pauses AI for past_due with a payment path and preserved work", () => {
    const r = evaluateAiAccess(aiInput({ status: "past_due" }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("payment is outstanding");
    expect(r.reason).toContain("saved drafts and research records are untouched");
  });

  it("pauses AI in grace but keeps saved work available", () => {
    const r = evaluateAiAccess(aiInput({ status: "grace" }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("grace period");
    expect(r.reason).toContain("saved work remains available");
  });

  it("refuses AI when read-only and when cancelled, preserving export/saved work", () => {
    const ro = evaluateAiAccess(aiInput({ status: "read_only" }));
    expect(ro.allowed).toBe(false);
    expect(ro.reason).toContain("read-only");
    expect(ro.reason).toContain("export");

    const c = evaluateAiAccess(aiInput({ status: "cancelled" }));
    expect(c.allowed).toBe(false);
    expect(c.reason).toContain("cancelled");
    expect(c.reason).toContain("saved work remains available");

    expect(evaluateAiAccess(aiInput({ status: "closed" })).allowed).toBe(false);
  });

  it("non-AI plan: keeps the full workspace and names the upgrade path — never a fake AI offer", () => {
    const r = evaluateAiAccess(aiInput({ aiEnabled: false }));
    expect(r.allowed).toBe(false);
    expect(r.tier).toBe("none");
    expect(r.reason).toContain("does not include AI");
    expect(r.reason).toContain("full operational workspace");
    expect(r.reason).toContain("upgrade to a plan with AI");
    // No AI plan → allowance is null (never 0-as-∞, never ∞).
    expect(r.usage.allowance).toBe(null);
  });

  it("AI enabled but allowance unconfigured: refuses and promises nothing is charged", () => {
    const r = evaluateAiAccess(aiInput({ allowanceTokens: 0 }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("allowance has not been configured");
    expect(r.reason).toContain("nothing can be charged");
  });

  it("trial status counts as live (allowed with AI, refused without)", () => {
    expect(evaluateAiAccess(aiInput({ status: "trialing" })).allowed).toBe(true);
    const noAi = evaluateAiAccess(aiInput({ status: "trialing", aiEnabled: false }));
    expect(noAi.allowed).toBe(false);
    expect(noAi.reason).toContain("does not include AI");
  });

  it("exhausted allowance: refuses with usage, reset and options — no silent overage", () => {
    const r = evaluateAiAccess(aiInput({ usedTokens: 100_000 }));
    expect(r.allowed).toBe(false);
    expect(r.tier).toBe("standard");
    expect(r.reason).toContain("exhausted");
    expect(r.reason).toContain("1,00,000 of 1,00,000"); // en-IN grouping
    expect(r.reason).toContain("resets next month");
    expect(r.reason).toContain("nothing is charged automatically");
    expect(r.reason).toContain("upgrade to a plan with a higher allowance");
  });

  it("used + reserved together exhaust the allowance (reservation model)", () => {
    const r = evaluateAiAccess(aiInput({ usedTokens: 90_000, reservedTokens: 10_000 }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("exhausted");
    expect(r.usage.remaining).toBe(0);
  });

  it("an exhausted plan on the advanced tier still reports its tier honestly while refusing", () => {
    const r = evaluateAiAccess(aiInput({ usedTokens: 100_000, advancedTierPlan: true }));
    expect(r.allowed).toBe(false);
    expect(r.tier).toBe("advanced");
  });

  it("allows when one token of the allowance remains", () => {
    const r = evaluateAiAccess(aiInput({ usedTokens: 99_999 }));
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe(null);
    expect(r.usage.remaining).toBe(1);
  });

  it("refuses on the concurrency cap with an honest queue explanation", () => {
    const r = evaluateAiAccess(aiInput({ runningJobs: 2, maxConcurrentJobs: 2 }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("up to 2 AI request(s) at a time");
    expect(r.reason).toContain("the allowance is not consumed by queued requests");
    // Refused only for concurrency — allowance still there.
    expect(r.usage.remaining).toBe(100_000);
  });

  it("allows under the concurrency cap and echoes the exact usage numbers", () => {
    const r = evaluateAiAccess(
      aiInput({ usedTokens: 1_234, reservedTokens: 6_000, runningJobs: 1, maxConcurrentJobs: 2 }),
    );
    expect(r.allowed).toBe(true);
    expect(r.tier).toBe("standard");
    expect(r.usage).toEqual({ used: 1_234, reserved: 6_000, allowance: 100_000, remaining: 92_766 });
  });

  it("advanced-tier plans report the advanced tier when allowed", () => {
    const r = evaluateAiAccess(aiInput({ advancedTierPlan: true }));
    expect(r.allowed).toBe(true);
    expect(r.tier).toBe("advanced");
  });

  it("clamps negative or fractional token inputs instead of trusting them", () => {
    const r = evaluateAiAccess(aiInput({ usedTokens: -5, reservedTokens: -1.6 }));
    expect(r.allowed).toBe(true);
    expect(r.usage.used).toBe(0);
    expect(r.usage.reserved).toBe(0); // Math.round(-1.6) = -2 → clamped to 0
    expect(r.usage.remaining).toBe(100_000);
  });
});

describe("reservation estimate", () => {
  it("is the documented 6,000-token estimate", () => {
    expect(AI_RESERVE_ESTIMATE_TOKENS).toBe(6_000);
  });
});
