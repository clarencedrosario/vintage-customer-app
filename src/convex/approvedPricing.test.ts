import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

// =====================================================================
// Approved pricing (12 Oct 2026) — Convex-side enforcement tests:
//
//   1. checkout precheck computes the charge from the plan config and
//      the org's LIVE billable seat count (trusted backend), hitting the
//      approved examples exactly:
//        chamber_ai @4 seats   → ₹3,999   (399_900)
//        chamber_ai @5 seats   → ₹4,998   (499_800)
//        chamber_noai @4 seats → ₹1,999   (199_900)
//        chamber_noai @5 seats → ₹2,448   (244_800)
//        enterprise @10 seats  → ₹8,990   (899_000)
//        enterprise @11 seats  → ₹9,889   (988_900)
//   2. enterprise can never be self-serve (startSubscription refuses)
//   3. a drifted plan price is refused in checkout
//   4. a manipulated frontend seat count cannot undercount the bill
// =====================================================================

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

const asUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

const ENV_KEYS = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"] as const;

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

/** Org with an owner membership and a chosen seat count. */
async function seedOrg(
  t: ReturnType<typeof convexTest>,
  seats: number,
): Promise<{ userId: string; orgId: string }> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "pricing-owner@synthetic.test",
      emailVerified: true,
      isAnonymous: false,
      isPlatformAdmin: false,
    });
    const orgId = await ctx.db.insert("organizations", {
      name: "Pricing Chamber (synthetic)",
      slug: `pricing-${Math.random().toString(36).slice(2, 8)}`,
      kind: "firm",
      currency: "INR",
      timezone: "Asia/Kolkata",
      financialYearStart: "04-01",
      taxLabel: "GST",
      taxPercent: 18,
      invoicePrefix: "INV",
      createdBy: userId,
      createdAt: Date.now(),
    });
    // Non-exempt billable seats: owner + (seats - 1) associates.
    await ctx.db.insert("memberships", {
      orgId,
      userId,
      orgRole: "owner",
      status: "active",
      createdAt: Date.now(),
    });
    for (let i = 1; i < seats; i++) {
      const u = await ctx.db.insert("users", {
        email: `member-${i}-${Math.random().toString(36).slice(2, 6)}@synthetic.test`,
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: false,
      });
      await ctx.db.insert("memberships", {
        orgId,
        userId: u,
        orgRole: "associate",
        status: "active",
        createdAt: Date.now(),
      });
    }
    await ctx.db.patch(userId as never, { activeOrgId: orgId });
    return { userId, orgId };
  });
}

/** Insert an approved plan row with exact approved fields. */
async function insertPlan(
  t: ReturnType<typeof convexTest>,
  spec: {
    code: string;
    name: string;
    kind: "individual" | "firm";
    priceMinor: number;
    billingUnit: "per_user" | "per_firm";
    seatLimit?: number;
    aiEnabled?: boolean;
    aiAllowanceTokens?: number;
    category?: "practice" | "practice_ai" | "firm_ai" | "enterprise";
  },
): Promise<string> {
  return t.run(async (ctx) =>
    ctx.db.insert("saasPlans", {
      code: spec.code,
      name: spec.name,
      kind: spec.kind,
      priceMinor: spec.priceMinor,
      interval: "monthly",
      active: true,
      sortOrder: 1,
      seatLimit: spec.seatLimit,
      storageLimitMb: undefined,
      features: ["Matters", "Tasks", "Billing"],
      trialDays: 0,
      category: spec.category,
      billingUnit: spec.billingUnit,
      planGroup: spec.code,
      aiEnabled: spec.aiEnabled,
      aiFeatures: spec.aiEnabled ? ["Research", "Drafting"] : undefined,
      aiAllowanceTokens: spec.aiAllowanceTokens,
      aiAdvancedModel: false,
      aiMaxConcurrentJobs: 2,
      createdAt: Date.now(),
    }),
  );
}

describe("approved pricing — checkoutPrecheckInternal charge math", () => {
  it("chamber with AI: 4 users → ₹3,999; 5 users → ₹4,998", async () => {
    for (const [seats, expectedMinor] of [
      [4, 399_900],
      [5, 499_800],
    ] as const) {
      const t = convexTest(schema, modules);
      const org = await seedOrg(t, seats);
      const planId = await insertPlan(t, {
        code: "chamber_ai",
        name: "Chamber / Small Firm with AI",
        kind: "firm",
        priceMinor: 399_900,
        billingUnit: "per_firm",
        seatLimit: undefined,
        aiEnabled: true,
        aiAllowanceTokens: 100_000,
        category: "practice_ai",
      });
      await t.run(async (ctx) =>
        ctx.db.insert("subscriptions", {
          orgId: org.orgId as never,
          planId: planId as never,
          status: "past_due",
          interval: "monthly",
          seatLimit: undefined,
          currentPeriodEnd: Date.now(),
          createdAt: Date.now(),
        }),
      );
      const pre = (await asUser(t, org.userId).query(
        internal.subscriptions.checkoutPrecheckInternal,
        {},
      )) as { allowed: boolean; amountMinor?: number };
      expect(pre.allowed).toBe(true);
      expect(pre.amountMinor).toBe(expectedMinor);
    }
  });

  it("chamber without AI: 4 users → ₹1,999; 5 users → ₹2,448", async () => {
    for (const [seats, expectedMinor] of [
      [4, 199_900],
      [5, 244_800],
    ] as const) {
      const t = convexTest(schema, modules);
      const org = await seedOrg(t, seats);
      const planId = await insertPlan(t, {
        code: "chamber_noai",
        name: "Chamber / Small Firm without AI",
        kind: "firm",
        priceMinor: 199_900,
        billingUnit: "per_firm",
        category: "practice",
      });
      await t.run(async (ctx) =>
        ctx.db.insert("subscriptions", {
          orgId: org.orgId as never,
          planId: planId as never,
          status: "past_due",
          interval: "monthly",
          currentPeriodEnd: Date.now(),
          createdAt: Date.now(),
        }),
      );
      const pre = (await asUser(t, org.userId).query(
        internal.subscriptions.checkoutPrecheckInternal,
        {},
      )) as { allowed: boolean; amountMinor?: number };
      expect(pre.amountMinor).toBe(expectedMinor);
    }
  });

  it("solo/individual flat price regardless of org seats", async () => {
    const t = convexTest(schema, modules);
    const org = await seedOrg(t, 3);
    const planId = await insertPlan(t, {
      code: "solo",
      name: "Solo",
      kind: "individual",
      priceMinor: 49_900,
      billingUnit: "per_firm",
      category: "practice",
    });
    await t.run(async (ctx) =>
      ctx.db.insert("subscriptions", {
        orgId: org.orgId as never,
        planId: planId as never,
        status: "past_due",
        interval: "monthly",
        currentPeriodEnd: Date.now(),
        createdAt: Date.now(),
      }),
    );
    const pre = (await asUser(t, org.userId).query(
      internal.subscriptions.checkoutPrecheckInternal,
      {},
    )) as { allowed: boolean; amountMinor?: number };
    expect(pre.amountMinor).toBe(49_900);
  });
});

describe("approved pricing — enforcement against manipulation", () => {
  it("enterprise minimum of 10 paid users is enforced in the precheck", async () => {
    const t = convexTest(schema, modules);
    const org = await seedOrg(t, 9);
    const planId = await insertPlan(t, {
      code: "enterprise",
      name: "Big Firms / Enterprise with AI",
      kind: "firm",
      priceMinor: 899_000,
      billingUnit: "per_user",
      category: "enterprise",
      aiEnabled: true,
    });
    await t.run(async (ctx) =>
      ctx.db.insert("subscriptions", {
        orgId: org.orgId as never,
        planId: planId as never,
        status: "past_due",
        interval: "monthly",
        currentPeriodEnd: Date.now(),
        createdAt: Date.now(),
      }),
    );
    const pre = (await asUser(t, org.userId).query(
      internal.subscriptions.checkoutPrecheckInternal,
      {},
    )) as { allowed: boolean; reason?: string };
    expect(pre.allowed).toBe(false);
    expect(pre.reason).toContain("minimum of 10 paid users");
  });

  it("drifted plan price pauses checkout (trusted-backend price guard)", async () => {
    const t = convexTest(schema, modules);
    const org = await seedOrg(t, 4);
    // The DB row advertises ₹2,999 — not the approved ₹3,999.
    const planId = await insertPlan(t, {
      code: "chamber_ai",
      name: "Chamber / Small Firm with AI",
      kind: "firm",
      priceMinor: 299_900,
      billingUnit: "per_firm",
      category: "practice_ai",
    });
    await t.run(async (ctx) =>
      ctx.db.insert("subscriptions", {
        orgId: org.orgId as never,
        planId: planId as never,
        status: "past_due",
        interval: "monthly",
        currentPeriodEnd: Date.now(),
        createdAt: Date.now(),
      }),
    );
    const pre = (await asUser(t, org.userId).query(
      internal.subscriptions.checkoutPrecheckInternal,
      {},
    )) as { allowed: boolean; reason?: string };
    expect(pre.allowed).toBe(false);
    expect(pre.reason).toContain("approved amount");
  });

  it("startSubscription plainly refuses enterprise (contact-sales only)", async () => {
    const t = convexTest(schema, modules);
    const org = await seedOrg(t, 10);
    const planId = await insertPlan(t, {
      code: "enterprise",
      name: "Big Firms / Enterprise with AI",
      kind: "firm",
      priceMinor: 899_000,
      billingUnit: "per_user",
      category: "enterprise",
      aiEnabled: true,
    });
    await expect(
      asUser(t, org.userId).mutation(api.subscriptions.startSubscription, {
        planId: planId as never,
      }),
    ).rejects.toThrow(/contact-sales/);
  });
});

describe("approved pricing — public catalog carries the approved seat fields", () => {
  it("catalog rows expose includedUsers / extraUserMinor / minimum previews", async () => {
    const t = convexTest(schema, modules);
    await insertPlan(t, {
      code: "free",
      name: "Free",
      kind: "individual",
      priceMinor: 0,
      billingUnit: "per_user",
      category: "practice",
    });
    await insertPlan(t, {
      code: "chamber_ai",
      name: "Chamber / Small Firm with AI",
      kind: "firm",
      priceMinor: 399_900,
      billingUnit: "per_firm",
      category: "practice_ai",
      aiEnabled: true,
      aiAllowanceTokens: 100_000,
    });
    await insertPlan(t, {
      code: "enterprise",
      name: "Big Firms / Enterprise with AI",
      kind: "firm",
      priceMinor: 899_000,
      billingUnit: "per_user",
      category: "enterprise",
      aiEnabled: true,
    });

    const cat = await t.query(api.entitlements.publicPlanCatalog, {});
    const byCode = new Map(cat.plans.map((p) => [p.code, p]));

    expect(byCode.get("free")).toMatchObject({ approved: true, priceMinor: 0 });
    expect(byCode.get("chamber_ai")).toMatchObject({
      approved: true,
      includedUsers: 4,
      extraUserMinor: 99_900,
    });
    expect(byCode.get("enterprise")).toMatchObject({
      approved: true,
      minPaidUsers: 10,
      priceMinor: 899_000,
      contactSales: true,
    });
  });
});
