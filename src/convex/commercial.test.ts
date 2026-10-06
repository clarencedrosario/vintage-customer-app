import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { monthKeyIST } from "./ai";

// =====================================================================
// Commercial release (turn 27) — subscription lifecycle, AI
// entitlements, public catalog and enterprise contact, against the real
// Convex functions (convexTest) with synthetic data only.
// =====================================================================

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

const asUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

const DAY = 86_400_000;

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ADVOKATE_ADVANCED_MODEL",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
] as const;

type Seed = Awaited<ReturnType<typeof seedCommercialOrg>>;

async function seedCommercialOrg(
  t: ReturnType<typeof convexTest>,
  orgKind: "chamber" | "firm" = "chamber",
): Promise<{
  userId: string;
  orgId: string;
  matterId: string;
  subId: string;
  practiceM: string;
  practiceY: string;
  aiM: string;
  aiY: string;
  firmAiM: string;
  enterprise: string;
  soloM: string;
}> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "commercial-owner@synthetic.test",
      emailVerified: true,
      isAnonymous: false,
      isPlatformAdmin: false,
    });
    const orgId = await ctx.db.insert("organizations", {
      name: "Commercial Chamber (synthetic)",
      slug: `commercial-${Math.random().toString(36).slice(2, 8)}`,
      kind: orgKind,
      currency: "INR",
      timezone: "Asia/Kolkata",
      financialYearStart: "04-01",
      taxLabel: "GST",
      taxPercent: 18,
      invoicePrefix: "INV",
      createdBy: userId,
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", {
      orgId,
      userId,
      orgRole: "owner",
      status: "active",
      createdAt: Date.now(),
    });
    await ctx.db.patch(userId as never, { activeOrgId: orgId });
    const clientId = await ctx.db.insert("clients", {
      orgId,
      kind: "individual",
      name: "Synthetic Commercial Client",
      createdBy: userId,
      createdAt: Date.now(),
    });
    const matterId = await ctx.db.insert("matters", {
      orgId,
      clientId,
      reference: "CM/2026/0001",
      title: "Commercial test matter",
      practiceArea: "criminal",
      status: "open",
      createdBy: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    // Plan pair A (practice, monthly+yearly), pair B (practice+AI),
    // one firm_ai plan with the advanced tier, enterprise, and a solo
    // monthly plan whose group has NO yearly variant.
    const practiceM = await ctx.db.insert("saasPlans", {
      code: "practice_m",
      name: "Practice (Monthly)",
      kind: "firm",
      priceMinor: 49_900,
      interval: "monthly",
      active: true,
      sortOrder: 1,
      category: "practice",
      billingUnit: "per_firm",
      planGroup: "practice",
      seatLimit: 5,
      storageLimitMb: 51_200,
      features: ["Matters", "Tasks", "Billing"],
      renewalTerms: "Renews by payment link at the end of each period.",
      overagePolicy: "No automatic overage charges.",
      createdAt: Date.now(),
    });
    const practiceY = await ctx.db.insert("saasPlans", {
      code: "practice_y",
      name: "Practice (Yearly)",
      kind: "firm",
      priceMinor: 499_000,
      interval: "yearly",
      active: true,
      sortOrder: 2,
      category: "practice",
      billingUnit: "per_firm",
      planGroup: "practice",
      seatLimit: 5,
      storageLimitMb: 51_200,
      createdAt: Date.now(),
    });
    const aiM = await ctx.db.insert("saasPlans", {
      code: "practice_ai_m",
      name: "Practice + AI (Monthly)",
      kind: "firm",
      priceMinor: 99_900,
      interval: "monthly",
      active: true,
      sortOrder: 3,
      category: "practice_ai",
      billingUnit: "per_firm",
      planGroup: "practice_ai",
      aiEnabled: true,
      aiFeatures: ["Research", "Drafting", "Case X-Ray"],
      aiAllowanceTokens: 100_000,
      aiAdvancedModel: false,
      aiMaxConcurrentJobs: 2,
      createdAt: Date.now(),
    });
    const aiY = await ctx.db.insert("saasPlans", {
      code: "practice_ai_y",
      name: "Practice + AI (Yearly)",
      kind: "firm",
      priceMinor: 999_000,
      interval: "yearly",
      active: true,
      sortOrder: 4,
      category: "practice_ai",
      billingUnit: "per_firm",
      planGroup: "practice_ai",
      aiEnabled: true,
      aiAllowanceTokens: 100_000,
      createdAt: Date.now(),
    });
    const firmAiM = await ctx.db.insert("saasPlans", {
      code: "firm_ai_m",
      name: "Firm + Advanced AI (Monthly)",
      kind: "firm",
      priceMinor: 199_900,
      interval: "monthly",
      active: true,
      sortOrder: 5,
      category: "firm_ai",
      billingUnit: "per_user",
      planGroup: "firm_ai",
      aiEnabled: true,
      aiAllowanceTokens: 400_000,
      aiAdvancedModel: true,
      aiMaxConcurrentJobs: 3,
      seatLimit: 20,
      createdAt: Date.now(),
    });
    const enterprise = await ctx.db.insert("saasPlans", {
      code: "enterprise",
      name: "Enterprise",
      kind: "firm",
      priceMinor: 0,
      interval: "yearly",
      active: true,
      sortOrder: 6,
      category: "enterprise",
      billingUnit: "per_firm",
      planGroup: "enterprise",
      createdAt: Date.now(),
    });
    const soloM = await ctx.db.insert("saasPlans", {
      code: "solo_m",
      name: "Solo (Monthly)",
      kind: "individual",
      priceMinor: 29_900,
      interval: "monthly",
      active: true,
      sortOrder: 7,
      category: "practice",
      billingUnit: "per_user",
      planGroup: "solo",
      createdAt: Date.now(),
    });
    const subId = await ctx.db.insert("subscriptions", {
      orgId,
      planId: practiceM,
      status: "active",
      interval: "monthly",
      currentPeriodEnd: Date.now() + 20 * DAY,
      seatLimit: 5,
      createdAt: Date.now(),
    });
    return { userId, orgId, matterId, subId, practiceM, practiceY, aiM, aiY, firmAiM, enterprise, soloM };
  });
}

async function insertJob(
  t: ReturnType<typeof convexTest>,
  s: Seed,
  job: {
    status: "pending" | "done" | "failed" | "expired";
    promptTokens?: number;
    completionTokens?: number;
    reservedTokens?: number;
    monthKey?: string;
  },
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("aiJobs", {
      orgId: s.orgId as never,
      matterId: s.matterId as never,
      kind: "summary",
      status: job.status,
      requestedById: s.userId as never,
      createdAt: Date.now(),
      monthKey: job.monthKey,
      promptTokens: job.promptTokens,
      completionTokens: job.completionTokens,
      reservedTokens: job.reservedTokens,
    });
  });
}

async function lastHistoryText(
  t: ReturnType<typeof convexTest>,
  subId: string,
): Promise<string> {
  return t.run(async (ctx) => {
    const sub = (await ctx.db.get(subId as never)) as { history?: { text: string }[] };
    return (sub!.history ?? []).slice(-1)[0]?.text ?? "";
  });
}

describe("Plan change lifecycle (changePlan / scheduled change / withdraw)", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("applies an immediate upgrade with an honest proration note", async () => {
    const s = await seedCommercialOrg(t);
    const r = await asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
      planId: s.aiM as never,
      timing: "immediately",
    });
    expect(r.applied).toBe(true);
    expect(r.scheduled).toBe(false);

    const sub = (await t.run((ctx) => ctx.db.get(s.subId as never))) as {
      planId: string;
      interval: string;
      scheduledPlanId?: string;
    };
    expect(sub.planId).toBe(s.aiM);
    expect(sub.interval).toBe("monthly");
    expect(sub.scheduledPlanId).toBeUndefined();

    const last = await lastHistoryText(t, s.subId);
    expect(last).toContain("Plan changed to Practice + AI (Monthly) (monthly) effective immediately");
    expect(last).toContain("Proration: not calculated in this release");

    // The org's own subscription pointer follows the change.
    const org = (await t.run((ctx) => ctx.db.get(s.orgId as never))) as {
      subscription?: { planId: string; status: string } | null;
    };
    expect(org.subscription?.planId).toBe(s.aiM);
    expect(org.subscription?.status).toBe("active");
  });

  it("schedules a downgrade for period end with explicit dates", async () => {
    const s = await seedCommercialOrg(t);
    // Move to the AI plan immediately first; then schedule the downgrade.
    await asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
      planId: s.aiM as never,
      timing: "immediately",
    });
    const before = (await t.run((ctx) => ctx.db.get(s.subId as never))) as {
      currentPeriodEnd: number;
    };
    const periodEnd = before.currentPeriodEnd;

    const r = await asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
      planId: s.practiceM as never,
      timing: "period_end",
    });
    expect(r.applied).toBe(false);
    expect(r.scheduled).toBe(true);
    expect(r.effectiveAt).toBe(periodEnd);

    const sub = (await t.run((ctx) => ctx.db.get(s.subId as never))) as {
      planId: string;
      scheduledPlanId?: string;
      scheduledChangeAt?: number;
      scheduledChangeNote?: string;
    };
    expect(sub.planId).toBe(s.aiM); // unchanged until period end
    expect(sub.scheduledPlanId).toBe(s.practiceM);
    expect(sub.scheduledChangeAt).toBe(periodEnd);
    expect(sub.scheduledChangeNote).toContain("Practice (Monthly)");
    const last = await lastHistoryText(t, s.subId);
    expect(last).toContain("scheduled for");
    expect(last).toContain("end of the current period");
    expect(last).toContain("The current plan stays active until then");
  });

  it("surfaces the scheduled change in mySubscription with name and date", async () => {
    const s = await seedCommercialOrg(t);
    let ms = await asUser(t, s.userId).query(api.subscriptions.mySubscription, {});
    expect(ms.subscription!.scheduledChange).toBe(null);

    await asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
      planId: s.practiceY as never,
      timing: "period_end",
    });
    ms = await asUser(t, s.userId).query(api.subscriptions.mySubscription, {});
    expect(ms.subscription!.scheduledChange).toMatchObject({
      planId: s.practiceY,
      planName: "Practice (Yearly)",
      note: "Change to Practice (Yearly) (yearly)",
    });
    expect(ms.subscription!.scheduledChange!.at).toBe(ms.subscription!.currentPeriodEnd);
  });

  it("withdraws a scheduled change; the current plan continues unchanged", async () => {
    const s = await seedCommercialOrg(t);
    await asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
      planId: s.practiceY as never,
      timing: "period_end",
    });
    const r = await asUser(t, s.userId).mutation(api.subscriptions.cancelScheduledPlanChange, {});
    expect(r.ok).toBe(true);

    const sub = (await t.run((ctx) => ctx.db.get(s.subId as never))) as {
      planId: string;
      scheduledPlanId?: string;
      scheduledChangeAt?: number;
    };
    expect(sub.planId).toBe(s.practiceM);
    expect(sub.scheduledPlanId).toBeUndefined();
    expect(sub.scheduledChangeAt).toBeUndefined();
    const last = await lastHistoryText(t, s.subId);
    expect(last).toContain("withdrawn");
    expect(last).toContain("the current plan continues unchanged");
  });

  it("refuses enterprise plans — contact sales only", async () => {
    const s = await seedCommercialOrg(t);
    await expect(
      asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
        planId: s.enterprise as never,
        timing: "immediately",
      }),
    ).rejects.toThrow(/contact-sales/);
  });

  it("refuses a change to the plan the organization is already on", async () => {
    const s = await seedCommercialOrg(t);
    await expect(
      asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
        planId: s.practiceM as never,
        timing: "immediately",
      }),
    ).rejects.toThrow(/already on that plan/);
  });

  it("refuses plan changes once the subscription is no longer live", async () => {
    const s = await seedCommercialOrg(t);
    await t.run(async (ctx) => ctx.db.patch(s.subId as never, { status: "grace" }));
    await expect(
      asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
        planId: s.aiM as never,
        timing: "immediately",
      }),
    ).rejects.toThrow(/only while the subscription is live/);
  });

  it("refuses members without the billing capability", async () => {
    const s = await seedCommercialOrg(t);
    const staffId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "commercial-staff@synthetic.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: false,
      });
      await ctx.db.insert("memberships", {
        orgId: s.orgId as never,
        userId: uid,
        orgRole: "support_staff",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.patch(uid as never, { activeOrgId: s.orgId });
      return uid;
    });
    await expect(
      asUser(t, staffId).mutation(api.subscriptions.changePlan, {
        planId: s.aiM as never,
        timing: "immediately",
      }),
    ).rejects.toThrow(/not permitted to do this \(billing\.invoice\)/);
  });

  it("refuses an individual plan for a firm organization", async () => {
    const s = await seedCommercialOrg(t, "firm");
    await expect(
      asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
        planId: s.soloM as never,
        timing: "immediately",
      }),
    ).rejects.toThrow(/Individual plans are for single-lawyer chambers/);
  });

  it("runExpiryScan applies the scheduled change at its effective date", async () => {
    const s = await seedCommercialOrg(t);
    await asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
      planId: s.practiceY as never,
      timing: "period_end",
    });
    // Simulate time passing the effective date.
    await t.run(async (ctx) => {
      await ctx.db.patch(s.subId as never, { scheduledChangeAt: Date.now() - 1000 });
    });
    const scan = await t.mutation(internal.subscriptions.runExpiryScan, {});
    expect(scan.changed).toBeGreaterThanOrEqual(1);

    const sub = (await t.run((ctx) => ctx.db.get(s.subId as never))) as {
      planId: string;
      interval: string;
      scheduledPlanId?: string;
    };
    expect(sub.planId).toBe(s.practiceY);
    expect(sub.interval).toBe("yearly");
    expect(sub.scheduledPlanId).toBeUndefined();
    expect(await lastHistoryText(t, s.subId)).toContain("Scheduled change applied");
    const org = (await t.run((ctx) => ctx.db.get(s.orgId as never))) as {
      subscription?: { planId: string } | null;
    };
    expect(org.subscription?.planId).toBe(s.practiceY);
  });

  it("clears a scheduled change honestly when the target plan is no longer available", async () => {
    const s = await seedCommercialOrg(t);
    await asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
      planId: s.practiceY as never,
      timing: "period_end",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(s.practiceY as never, { active: false });
      await ctx.db.patch(s.subId as never, { scheduledChangeAt: Date.now() - 1000 });
    });
    await t.mutation(internal.subscriptions.runExpiryScan, {});

    const sub = (await t.run((ctx) => ctx.db.get(s.subId as never))) as {
      planId: string;
      scheduledPlanId?: string;
    };
    expect(sub.planId).toBe(s.practiceM); // current plan continues
    expect(sub.scheduledPlanId).toBeUndefined();
    expect(await lastHistoryText(t, s.subId)).toContain("no longer available");
  });
});

describe("AI entitlement (myAiEntitlement)", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("a non-AI plan keeps the workspace but refuses AI with the honest reason", async () => {
    const s = await seedCommercialOrg(t);
    const e = await asUser(t, s.userId).query(api.entitlements.myAiEntitlement, {});
    expect(e.allowed).toBe(false);
    expect(e.tier).toBe("none");
    expect(e.reason).toContain("does not include AI");
    expect(e.reason).toContain("full operational workspace");
    expect(e.usage.allowance).toBe(null);
    expect(e.planCode).toBe("practice_m");
    expect(e.category).toBe("practice");
    expect(e.status).toBe("active");
    // Deployment honesty: no model tiers offered without an API key.
    expect(e.liveConfigured).toBe(false);
    expect(e.availableTiers).toEqual([]);
  });

  it("an AI plan with a configured allowance is allowed on the standard tier", async () => {
    const s = await seedCommercialOrg(t);
    await asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
      planId: s.aiM as never,
      timing: "immediately",
    });
    process.env.OPENAI_API_KEY = "sk-test-key";

    const e = await asUser(t, s.userId).query(api.entitlements.myAiEntitlement, {});
    expect(e.allowed).toBe(true);
    expect(e.tier).toBe("standard");
    expect(e.reason).toBe(null);
    expect(e.usage).toEqual({ used: 0, reserved: 0, allowance: 100_000, remaining: 100_000 });
    expect(e.planCode).toBe("practice_ai_m");
    expect(e.planName).toBe("Practice + AI (Monthly)");
    expect(e.aiFeatures).toEqual(["Research", "Drafting", "Case X-Ray"]);
    expect(e.resetAt).toBeGreaterThan(Date.now());
    // Only the configured standard tier is offered; advanced is unset.
    expect(e.availableTiers.map((x) => x.id)).toEqual(["standard"]);
    expect(e.availableTiers[0]!.modelId).toBe("gpt-4o-mini");
  });

  it("the advanced tier appears only when the operator configured the model, even on advanced plans", async () => {
    const s = await seedCommercialOrg(t);
    await asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
      planId: s.firmAiM as never,
      timing: "immediately",
    });
    process.env.OPENAI_API_KEY = "sk-test-key";

    // Plan permits advanced, but no model is mapped: the tier is NOT
    // advertised (plan permission ≠ model availability).
    let e = await asUser(t, s.userId).query(api.entitlements.myAiEntitlement, {});
    expect(e.availableTiers.map((x) => x.id)).toEqual(["standard"]);

    // Now the operator maps a real model (whitespace-trimmed server-side).
    process.env.ADVOKATE_ADVANCED_MODEL = "  openai/gpt-x-high ";
    e = await asUser(t, s.userId).query(api.entitlements.myAiEntitlement, {});
    expect(e.availableTiers.map((x) => x.id)).toEqual(["standard", "advanced"]);
    expect(e.availableTiers[1]!.modelId).toBe("openai/gpt-x-high");
    expect(e.tier).toBe("advanced");
  });

  it("counts this month's usage and pending reservations against the allowance", async () => {
    const s = await seedCommercialOrg(t);
    await asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
      planId: s.aiM as never,
      timing: "immediately",
    });
    const key = monthKeyIST();
    await insertJob(t, s, { status: "done", promptTokens: 40_000, completionTokens: 20_000, monthKey: key });
    await insertJob(t, s, { status: "pending", reservedTokens: 30_000, monthKey: key });

    let e = await asUser(t, s.userId).query(api.entitlements.myAiEntitlement, {});
    expect(e.usage).toEqual({ used: 60_000, reserved: 30_000, allowance: 100_000, remaining: 10_000 });
    expect(e.allowed).toBe(true);

    // One more done job pushes used+reserved to the allowance.
    await insertJob(t, s, { status: "done", promptTokens: 10_000, monthKey: key });
    e = await asUser(t, s.userId).query(api.entitlements.myAiEntitlement, {});
    expect(e.usage.remaining).toBe(0);
    expect(e.allowed).toBe(false);
    expect(e.reason).toContain("exhausted");
    expect(e.reason).toContain("70,000 of 1,00,000"); // en-IN grouping
    expect(e.reason).toContain("resets next month");
    expect(e.reason).toContain("nothing is charged automatically");
  });

  it("usage from previous months does not count against this month", async () => {
    const s = await seedCommercialOrg(t);
    await asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
      planId: s.aiM as never,
      timing: "immediately",
    });
    const lastMonth = monthKeyIST(Date.now() - 31 * DAY);
    await insertJob(t, s, { status: "done", promptTokens: 100_000, monthKey: lastMonth });
    const e = await asUser(t, s.userId).query(api.entitlements.myAiEntitlement, {});
    expect(e.usage.used).toBe(0);
    expect(e.allowed).toBe(true);
  });

  it("failed and expired jobs consume nothing — reservations exist only while pending", async () => {
    const s = await seedCommercialOrg(t);
    await asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
      planId: s.aiM as never,
      timing: "immediately",
    });
    const key = monthKeyIST();
    await insertJob(t, s, { status: "failed", reservedTokens: 6_000, promptTokens: 0, monthKey: key });
    await insertJob(t, s, { status: "expired", reservedTokens: 6_000, monthKey: key });
    const e = await asUser(t, s.userId).query(api.entitlements.myAiEntitlement, {});
    expect(e.usage).toEqual({ used: 0, reserved: 0, allowance: 100_000, remaining: 100_000 });
    expect(e.allowed).toBe(true);
  });

  it("enforces the plan's concurrency cap while the allowance remains", async () => {
    const s = await seedCommercialOrg(t);
    await asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
      planId: s.aiM as never,
      timing: "immediately",
    });
    const key = monthKeyIST();
    await insertJob(t, s, { status: "pending", reservedTokens: 100, monthKey: key });
    await insertJob(t, s, { status: "pending", reservedTokens: 100, monthKey: key });
    const e = await asUser(t, s.userId).query(api.entitlements.myAiEntitlement, {});
    expect(e.usage.remaining).toBe(99_800); // allowance intact
    expect(e.allowed).toBe(false);
    expect(e.reason).toContain("up to 2 AI request(s) at a time");
    expect(e.reason).toContain("the allowance is not consumed by queued requests");
  });

  it("an organization without a subscription has no AI and a choose-a-plan reason", async () => {
    const s = await seedCommercialOrg(t);
    await t.run(async (ctx) => ctx.db.delete(s.subId as never));
    const e = await asUser(t, s.userId).query(api.entitlements.myAiEntitlement, {});
    expect(e.status).toBe("none");
    expect(e.allowed).toBe(false);
    expect(e.reason).toContain("no subscription");
    expect(e.planCode).toBe(null);
    expect(e.usage.allowance).toBe(null);
  });
});

describe("Public catalog (publicPlanCatalog)", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("without provider keys nothing is purchasable — savings still computed from configured prices", async () => {
    await seedCommercialOrg(t);
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;

    const cat = await t.query(api.entitlements.publicPlanCatalog, {});
    expect(cat.purchasingAvailable).toBe(false);
    const byCode = new Map(cat.plans.map((p) => [p.code, p]));

    // Yearly genuinely cheaper than 12×monthly → computed savings.
    expect(byCode.get("practice_y")).toMatchObject({ savingsAmountMinor: 99_800, savingsPercent: 17 });
    // Monthly rows never claim savings.
    expect(byCode.get("practice_m")!.savingsAmountMinor).toBe(null);
    // Group with only a monthly variant → no savings claim at all.
    expect(byCode.get("solo_m")!.savingsAmountMinor).toBe(null);
    // Nothing purchasable without the provider.
    expect(byCode.get("practice_m")!.purchasable).toBe(false);
    // Enterprise is contact-sales, never self-serve, and unpriced.
    expect(byCode.get("enterprise")).toMatchObject({
      contactSales: true,
      purchasable: false,
      priceConfigured: false,
    });
    expect(cat.disclosure).toContain("configuration pending");
  });

  it("with provider keys, priced non-enterprise plans are purchasable", async () => {
    await seedCommercialOrg(t);
    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    process.env.RAZORPAY_KEY_SECRET = "secret_x";

    const cat = await t.query(api.entitlements.publicPlanCatalog, {});
    expect(cat.purchasingAvailable).toBe(true);
    const byCode = new Map(cat.plans.map((p) => [p.code, p]));
    expect(byCode.get("practice_m")!.purchasable).toBe(true);
    expect(byCode.get("practice_ai_m")!.purchasable).toBe(true);
    expect(byCode.get("practice_ai_m")).toMatchObject({ aiEnabled: true, aiAllowanceTokens: 100_000 });
    expect(byCode.get("enterprise")!.purchasable).toBe(false); // still contact sales
    // The AI yearly pair also shows computed savings from configured prices.
    expect(byCode.get("practice_ai_y")!.savingsAmountMinor).toBe(199_800);
  });

  it("hides inactive plans from the public catalog", async () => {
    const s = await seedCommercialOrg(t);
    await t.run(async (ctx) => ctx.db.patch(s.soloM as never, { active: false }));
    const cat = await t.query(api.entitlements.publicPlanCatalog, {});
    expect(cat.plans.map((p) => p.code)).not.toContain("solo_m");
    expect(cat.plans.map((p) => p.code)).toContain("practice_m");
  });
});

describe("Enterprise contact workflow (requestEnterpriseContact)", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("validates and records enquiries, readable only by platform admins", async () => {
    const s = await seedCommercialOrg(t);
    const ok = await t.mutation(api.entitlements.requestEnterpriseContact, {
      name: "Meera Iyer",
      email: "meera@bigfirm.example",
      orgName: "Big Firm LLP",
      requirements: "We need SSO, data residency in India and a custom seat count.",
    });
    expect(ok.ok).toBe(true);
    expect(ok.message).toContain("nothing is charged");

    await expect(
      t.mutation(api.entitlements.requestEnterpriseContact, {
        name: "A",
        email: "meera@bigfirm.example",
        requirements: "We need SSO and data residency for our deployment.",
      }),
    ).rejects.toThrow(/name/);
    await expect(
      t.mutation(api.entitlements.requestEnterpriseContact, {
        name: "Meera Iyer",
        email: "not-an-email",
        requirements: "We need SSO and data residency for our deployment.",
      }),
    ).rejects.toThrow(/valid email/);
    await expect(
      t.mutation(api.entitlements.requestEnterpriseContact, {
        name: "Meera Iyer",
        email: "meera@bigfirm.example",
        requirements: "too short",
      }),
    ).rejects.toThrow(/at least 20/);

    // A regular member cannot read the leads.
    await expect(
      asUser(t, s.userId).query(api.entitlements.listEnterpriseLeads, {}),
    ).rejects.toThrow(/Platform administration/);

    // The platform admin can, and can move the lead's status with an audit row.
    await t.run(async (ctx) => ctx.db.patch(s.userId as never, { isPlatformAdmin: true }));
    const leads = await asUser(t, s.userId).query(api.entitlements.listEnterpriseLeads, {});
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ email: "meera@bigfirm.example", status: "new" });
    await asUser(t, s.userId).mutation(api.entitlements.setEnterpriseLeadStatus, {
      leadId: leads[0]!._id as never,
      status: "contacted",
    });
    const leads2 = await asUser(t, s.userId).query(api.entitlements.listEnterpriseLeads, {});
    expect(leads2[0]!.status).toBe("contacted");
    const audits = await t.run((ctx) => ctx.db.query("platformAdminAudit").collect());
    expect(audits.some((a) => a.action === "enterpriseLead.status")).toBe(true);
  });
});

describe("Subscription surface (mySubscription)", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("returns commercial plan fields and honest numeric limits, never 'unlimited'", async () => {
    const s = await seedCommercialOrg(t);
    const ms = await asUser(t, s.userId).query(api.subscriptions.mySubscription, {});
    expect(ms.subscription).toMatchObject({
      status: "active",
      interval: "monthly",
      planName: "Practice (Monthly)",
      seatLimit: 5,
    });
    expect(ms.readOnly).toBe(false);
    expect(ms.graceUntil).toBe(null);
    expect(ms.subscription!.scheduledChange).toBe(null);

    const aiPlan = ms.plans.find((p) => p.code === "practice_ai_m")!;
    expect(aiPlan).toMatchObject({
      category: "practice_ai",
      billingUnit: "per_firm",
      aiEnabled: true,
      aiAllowanceTokens: 100_000,
    });
    // Allowances are numbers — the word "unlimited" must never appear.
    for (const p of ms.plans) {
      expect(JSON.stringify(p).toLowerCase()).not.toContain("unlimited");
    }
  });

  it("marks awaitingPayment honestly for past_due with an unconsumed payment link", async () => {
    const s = await seedCommercialOrg(t);
    await t.run(async (ctx) =>
      ctx.db.patch(s.subId as never, {
        status: "past_due",
        paymentLinkUrl: "https://rzp.io/i/testlink",
        paymentLinkId: "link_test",
        paymentLinkIdConsumed: false,
      }),
    );
    const ms = await asUser(t, s.userId).query(api.subscriptions.mySubscription, {});
    expect(ms.subscription!.awaitingPayment).toBe(true);
    expect(ms.subscription!.paymentLinkUrl).toBe("https://rzp.io/i/testlink");
    expect(ms.readOnly).toBe(false); // past_due still works read-focused, not read-only

    // With the link consumed, it is no longer awaiting payment.
    await t.run(async (ctx) => ctx.db.patch(s.subId as never, { paymentLinkIdConsumed: true }));
    const ms2 = await asUser(t, s.userId).query(api.subscriptions.mySubscription, {});
    expect(ms2.subscription!.awaitingPayment).toBe(false);
  });
});

describe("Case X-Ray incremental reassessment (prepareJob xrayDelta)", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("first X-Ray stores no delta; the second records the source-level diff and supersedes the old job", async () => {
    const s = await seedCommercialOrg(t);
    // An AI plan with a live subscription — the gate prepareJob enforces.
    await asUser(t, s.userId).mutation(api.subscriptions.changePlan, {
      planId: s.aiM as never,
      timing: "immediately",
    });

    // Four sources on the matter.
    const src = (name: string) => ({ name, role: "evidence" as const, text: `Text of ${name}`, charCount: 20, extraction: "text_layer" as const, addedById: s.userId, createdAt: Date.now() });
    const [fir, chargesheet, witness, medical] = await t.run(async (ctx) => [
      await ctx.db.insert("aiSources", { orgId: s.orgId as never, matterId: s.matterId as never, ...src("FIR copy") }),
      await ctx.db.insert("aiSources", { orgId: s.orgId as never, matterId: s.matterId as never, ...src("Charge sheet") }),
      await ctx.db.insert("aiSources", { orgId: s.orgId as never, matterId: s.matterId as never, ...src("Witness statement") }),
      await ctx.db.insert("aiSources", { orgId: s.orgId as never, matterId: s.matterId as never, ...src("Medical report") }),
    ]);

    // First X-Ray over [FIR, Charge sheet, Medical]: no previous job →
    // no delta, and it reserves its estimate against the allowance.
    const job1 = (await asUser(t, s.userId).mutation(api.ai.prepareJob, {
      matterId: s.matterId as never,
      kind: "xray",
      sourceIds: [fir, chargesheet, medical] as never[],
    })) as unknown as string;
    let got = await asUser(t, s.userId).query(api.ai.getJob, { jobId: job1 as never });
    expect(got!.xrayDelta).toBeNull();
    expect(got!.supersededByJobId).toBeNull();

    // The runner never runs here; mark the first assessment complete so
    // it is genuinely the previous COMPLETED X-Ray.
    await t.run(async (ctx) =>
      ctx.db.patch(job1 as never, { status: "done", completedAt: Date.now() - 1000 }),
    );

    // The medical report is re-extracted AFTER that completion.
    await t.run(async (ctx) => ctx.db.patch(medical as never, { documentUpdatedAt: Date.now() }));

    // Second X-Ray over [Charge sheet, Witness, Medical]: FIR left the
    // record, Witness is new, Medical changed, Charge sheet unchanged.
    const job2 = (await asUser(t, s.userId).mutation(api.ai.prepareJob, {
      matterId: s.matterId as never,
      kind: "xray",
      sourceIds: [chargesheet, witness, medical] as never[],
    })) as unknown as string;
    got = await asUser(t, s.userId).query(api.ai.getJob, { jobId: job2 as never });
    expect(got!.xrayDelta).toMatchObject({
      previousJobId: job1,
      added: ["Witness statement"],
      changed: ["Medical report"],
      removed: ["FIR copy"],
      unchangedCount: 1,
    });
    expect(got!.xrayDelta!.previousAt).toBeGreaterThan(0);

    // The old assessment is flagged outdated through the user-facing
    // read (never deleted), and history rows expose the pointer too.
    const old = await asUser(t, s.userId).query(api.ai.getJob, { jobId: job1 as never });
    expect(old!.supersededByJobId).toBe(job2);
    const history = await asUser(t, s.userId).query(api.ai.listJobs, { matterId: s.matterId as never });
    const oldRow = history.find((j) => j._id === job1);
    expect(oldRow).toBeDefined();
    expect(oldRow!.supersededByJobId).toBe(job2);

    // Reservation model: job 1 is done (reservation released by
    // construction), job 2 pending → exactly one 6,000-token hold.
    const e = await asUser(t, s.userId).query(api.entitlements.myAiEntitlement, {});
    expect(e.usage.reserved).toBe(6_000);
    expect(e.usage.used).toBe(0);
  });
});
