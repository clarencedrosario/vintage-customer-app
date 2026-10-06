import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAccess } from "./access";
import { getCurrentUser } from "./users";
import {
  annualSavings,
  evaluateAiAccess,
  AI_RESERVE_ESTIMATE_TOKENS,
  type AiAccessResult,
  type SubscriptionGateStatus,
} from "../lib/planCatalog";
import { availableTiers } from "../lib/aiModels";
import { monthKeyIST } from "./ai";

// =====================================================================
// Entitlements (commercial release, turn 27).
//
// ONE resolver for "what may this organization do with AI right now",
// built on the existing subscription state machine (subscriptions.ts)
// and the plan configuration (saasPlans). Every AI entry point —
// prepareJob, retries, morning briefing, legal research, the runner
// itself — enforces through HERE. Paying for AI never grants access to
// another person's matters: matter-level authorization stays in
// access.ts; this module only answers "is AI on for this org, and how
// much of the allowance is left".
//
// RESERVATION MODEL: a pending job holds an ESTIMATE (6,000 tokens);
// the reservation exists only while the job row is pending, so success
// (actual tokens charged), failure and expiry all release it by
// construction — failed jobs never consume allowance. Simultaneous
// requests cannot silently overrun: remaining = allowance − used −
// reserved.
//
// Never any unapproved overage: when the allowance is gone the gate
// refuses with the usage, the reset date and the approved options.
// =====================================================================

/** First epoch-ms of the NEXT IST month (the usage meter's reset). */
export function nextMonthResetIST(at = Date.now()): number {
  const key = monthKeyIST(at); // YYYY-MM
  const [y, m] = key.split("-").map((n) => parseInt(n, 10));
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return Date.parse(`${next}-01T00:00:00+05:30`);
}

function paymentsConfigured(): boolean {
  return !!process.env.RAZORPAY_KEY_ID && !!process.env.RAZORPAY_KEY_SECRET;
}

type PlanRow = {
  code: string;
  name: string;
  kind: "individual" | "firm";
  category?: "practice" | "practice_ai" | "firm_ai" | "enterprise";
  billingUnit?: "per_user" | "per_firm";
  planGroup?: string;
  aiEnabled?: boolean;
  aiFeatures?: string[];
  aiAllowanceTokens?: number;
  aiAdvancedModel?: boolean;
  aiMaxConcurrentJobs?: number;
  seatLimit?: number;
  storageLimitMb?: number;
  taxInclusive?: boolean;
  renewalTerms?: string;
  overagePolicy?: string;
};

/** Resolve the org's live AI entitlement from subscription + plan + usage. */
async function resolveForOrg(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
): Promise<AiAccessResult & {
  planCode: string | null;
  planName: string | null;
  category: string | null;
  billingUnit: string | null;
  status: SubscriptionGateStatus;
  resetAt: number;
  liveConfigured: boolean;
  availableTiers: { id: string; label: string; modelId: string | null; provider: string }[];
  aiFeatures: string[];
  seatLimit: number | null;
  storageLimitMb: number | null;
}> {
  const sub = (
    await ctx.db.query("subscriptions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
  )[0];
  const plan: PlanRow | null = sub ? await ctx.db.get(sub.planId) : null;

  const status: SubscriptionGateStatus = sub ? (sub.status as SubscriptionGateStatus) : "none";

  // Usage this IST month: actual tokens charged + pending reservations.
  const key = monthKeyIST();
  const monthJobs = await ctx.db
    .query("aiJobs")
    .withIndex("by_org_month", (q) => q.eq("orgId", orgId).eq("monthKey", key))
    .collect();
  const usedTokens = monthJobs.reduce(
    (s, r) => s + (r.promptTokens ?? 0) + (r.completionTokens ?? 0),
    0,
  );
  const reservedTokens = monthJobs
    .filter((r) => r.status === "pending")
    .reduce((s, r) => s + (r.reservedTokens ?? 0), 0);
  const runningJobs = monthJobs.filter((r) => r.status === "pending").length;

  const liveConfigured = !!process.env.OPENAI_API_KEY;
  const advancedModelId = (process.env.ADVOKATE_ADVANCED_MODEL ?? "").trim() || null;

  const result = evaluateAiAccess({
    aiEnabled: plan?.aiEnabled === true,
    status,
    advancedTierPlan: plan?.aiAdvancedModel === true,
    allowanceTokens: plan?.aiAllowanceTokens ?? 0,
    usedTokens,
    reservedTokens,
    runningJobs,
    maxConcurrentJobs: plan?.aiMaxConcurrentJobs ?? 2,
  });

  return {
    ...result,
    planCode: plan?.code ?? null,
    planName: plan?.name ?? null,
    category: plan?.category ?? null,
    billingUnit: plan?.billingUnit ?? (plan?.kind === "firm" ? "per_firm" : "per_user"),
    status,
    resetAt: nextMonthResetIST(),
    liveConfigured,
    availableTiers: liveConfigured
      ? availableTiers(liveConfigured, advancedModelId).map((t) => ({
          id: t.id,
          label: t.label,
          modelId: t.modelId,
          provider: t.provider,
        }))
      : [],
    aiFeatures: plan?.aiFeatures ?? [],
    seatLimit: sub?.seatLimit ?? plan?.seatLimit ?? null,
    storageLimitMb: sub?.storageLimitMb ?? plan?.storageLimitMb ?? null,
  };
}

/** Internal resolver — used by ai.ts entry points and the runner. */
export const orgAiEntitlement = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => resolveForOrg(ctx, args.orgId),
});

/** Authenticated display for the caller's org (subscription + AI pages). */
export const myAiEntitlement = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    return resolveForOrg(ctx, ac.org._id);
  },
});

// ---------------------------------------------------------------------
// Public plan catalog (pricing page — no authentication).
// Shows ONLY configured, active plans; savings computed from configured
// prices; purchasing flagged unavailable until prices AND the payment
// provider exist. Enterprise is contact-sales only.
// ---------------------------------------------------------------------
export const publicPlanCatalog = query({
  args: {},
  handler: async (ctx) => {
    const plans = (await ctx.db.query("saasPlans").collect())
      .filter((p) => p.active)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const payments = paymentsConfigured();

    const rows = plans.map((p) => {
      const group = p.planGroup ?? p.code;
      const monthly = plans.find(
        (o) => (o.planGroup ?? o.code) === group && o.interval === "monthly" && o.priceMinor > 0,
      );
      const yearly = plans.find(
        (o) => (o.planGroup ?? o.code) === group && o.interval === "yearly" && o.priceMinor > 0,
      );
      const savings =
        p.interval === "yearly"
          ? annualSavings(monthly?.priceMinor ?? null, p.priceMinor)
          : null;
      const purchasable =
        p.category !== "enterprise" && p.priceMinor > 0 && payments;
      return {
        planId: p._id,
        code: p.code,
        name: p.name,
        category: p.category ?? null,
        kind: p.kind,
        billingUnit: p.billingUnit ?? (p.kind === "firm" ? "per_firm" : "per_user"),
        interval: p.interval,
        priceMinor: p.priceMinor,
        priceConfigured: p.priceMinor > 0,
        seatLimit: p.seatLimit ?? null,
        storageLimitMb: p.storageLimitMb ?? null,
        features: p.features ?? [],
        aiEnabled: p.aiEnabled === true,
        aiFeatures: p.aiFeatures ?? [],
        aiAllowanceTokens: p.aiAllowanceTokens ?? null,
        aiAdvancedModel: p.aiAdvancedModel === true,
        taxInclusive: p.taxInclusive ?? null,
        renewalTerms: p.renewalTerms ?? null,
        overagePolicy: p.overagePolicy ?? null,
        trialDays: p.trialDays ?? null,
        savingsAmountMinor: savings?.amountMinor ?? null,
        savingsPercent: savings?.percent ?? null,
        purchasable,
        contactSales: p.category === "enterprise",
      };
    });
    return {
      plans: rows,
      purchasingAvailable: payments,
      disclosure:
        "AI access is provided through your ADVOKATE subscription — it does not include a separate consumer AI-service subscription. Plans without a configured price show \u201Cconfiguration pending\u201D and cannot be purchased yet.",
    };
  },
});

// ---------------------------------------------------------------------
// Enterprise contact sales — a genuine workflow, not a fake form.
// ---------------------------------------------------------------------
export const requestEnterpriseContact = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    orgName: v.optional(v.string()),
    orgSize: v.optional(v.string()),
    requirements: v.string(),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim().slice(0, 120);
    const email = args.email.trim().slice(0, 200);
    const requirements = args.requirements.trim().slice(0, 4000);
    if (name.length < 2) throw new Error("Please provide your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Please provide a valid email address so our team can reply.");
    }
    if (requirements.length < 20) {
      throw new Error(
        "Tell us a little about your requirements (at least 20 characters) so the reply is useful.",
      );
    }
    await ctx.db.insert("enterpriseLeads", {
      name,
      email,
      orgName: args.orgName?.trim().slice(0, 160) || undefined,
      orgSize: args.orgSize?.trim().slice(0, 40) || undefined,
      requirements,
      status: "new",
      createdAt: Date.now(),
    });
    return {
      ok: true as const,
      message:
        "Thank you — your enquiry is recorded. Our team will reply to your email; nothing is charged and no plan is activated by this request.",
    };
  },
});

/** Platform-operator view of enterprise enquiries. */
export const listEnterpriseLeads = query({
  args: {},
  handler: async (ctx) => {
    const admin = await getCurrentUser(ctx);
    if (!admin?.isPlatformAdmin) {
      throw new Error("Platform administration access required.");
    }
    const rows = await ctx.db.query("enterpriseLeads").withIndex("by_created").collect();
    return rows.reverse().map((r) => ({
      _id: r._id,
      name: r.name,
      email: r.email,
      orgName: r.orgName ?? null,
      orgSize: r.orgSize ?? null,
      requirements: r.requirements,
      status: r.status,
      createdAt: r.createdAt,
    }));
  },
});

export const setEnterpriseLeadStatus = mutation({
  args: { leadId: v.id("enterpriseLeads"), status: v.union(v.literal("new"), v.literal("contacted"), v.literal("closed")) },
  handler: async (ctx, args) => {
    const admin = await getCurrentUser(ctx);
    if (!admin?.isPlatformAdmin) {
      throw new Error("Platform administration access required.");
    }
    const lead = await ctx.db.get(args.leadId);
    if (!lead) throw new Error("Enquiry not found.");
    await ctx.db.patch(args.leadId, { status: args.status });
    await ctx.db.insert("platformAdminAudit", {
      actorId: admin._id,
      actorName: admin.name ?? admin.email ?? admin._id.slice(-6),
      action: "enterpriseLead.status",
      targetType: "enterpriseLead",
      targetId: args.leadId,
      detail: args.status,
      createdAt: Date.now(),
    });
  },
});

export { AI_RESERVE_ESTIMATE_TOKENS };
