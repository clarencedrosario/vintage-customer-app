import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { getCurrentUser } from "./users";
import { APPROVED_PLANS } from "../lib/approvedPricing";

// =====================================================================
// APPROVED PLAN SETUP (one-time, audited).
//
// Seeds (or updates) the six approved plans with EXACT regulated prices
// and seat rules. Idempotent: safe to run again — matching rows are
// confirmed, drifted rows are corrected, missing rows are inserted.
// Only a platform admin can run it; every change is audited.
//
// aiAllowanceTokens for AI plans is intentionally left at the operator's
// existing configuration — the approval sheet fixes PRICES and SEATS,
// not AI allowances. If unset here, the allowance honestly reads
// "configuration pending" until the operator sets one, and evaluateAiAccess
// refuses AI (nothing charged) until then.
// =====================================================================

export const seedApprovedPlans = mutation({
  args: {
    /** Optional AI allowances (paise-independent, tokens/month). */
    aiAllowanceTokens: v.optional(
      v.object({
        advocate_ai: v.number(),
        chamber_ai: v.number(),
        enterprise: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const admin = await getCurrentUser(ctx);
    if (!admin?.isPlatformAdmin) {
      throw new Error("Platform administration access required.");
    }
    const results: { code: string; action: string; detail: string }[] = [];
    const existing = await ctx.db.query("saasPlans").collect();
    const byCode = new Map(existing.map((p) => [p.code, p]));

    for (const p of APPROVED_PLANS) {
      const expectedPrice = p.priceMinor;
      const row = byCode.get(p.code);
      if (row) {
        if (row.priceMinor === expectedPrice && row.active) {
          results.push({ code: p.code, action: "ok", detail: "already matches the approved configuration" });
          continue;
        }
        // Approved price/structure wins: correct drifted rows.
        await ctx.db.replace(row._id, {
          code: p.code,
          name: p.name,
          kind: p.kind,
          priceMinor: expectedPrice,
          interval: "monthly",
          seatLimit:
            p.code === "chamber_ai" || p.code === "chamber_noai"
              ? undefined // bundles are seat-counted, nothing hard-caps at 4
              : row.seatLimit,
          storageLimitMb: row.storageLimitMb,
          features: row.features ?? [],
          trialDays: row.trialDays,
          active: true,
          sortOrder: row.sortOrder,
          category: p.category,
          billingUnit: p.billingUnit,
          planGroup: p.code,
          aiEnabled: p.aiEnabled,
          aiFeatures: row.aiFeatures,
          aiAllowanceTokens:
            args.aiAllowanceTokens?.[p.code as "advocate_ai" | "chamber_ai" | "enterprise"] ??
            row.aiAllowanceTokens,
          aiAdvancedModel: row.aiAdvancedModel,
          aiMaxConcurrentJobs: row.aiMaxConcurrentJobs,
          taxInclusive: row.taxInclusive,
          renewalTerms: row.renewalTerms,
          overagePolicy: row.overagePolicy,
          createdAt: row.createdAt,
          updatedAt: Date.now(),
        });
        await ctx.db.insert("platformAdminAudit", {
          actorId: admin._id,
          actorName: admin.name ?? admin.email ?? admin._id.slice(-6),
          action: "plan.approvedPriceCorrection",
          targetType: "saasPlan",
          targetId: row._id,
          detail: `${p.code} corrected to the approved configuration`,
          createdAt: Date.now(),
        });
        results.push({ code: p.code, action: "corrected", detail: `price set to ${expectedPrice} minor` });
        continue;
      }
      const id = await ctx.db.insert("saasPlans", {        code: p.code,
        name: p.name,
        kind: p.kind,
        priceMinor: expectedPrice,
        interval: "monthly",
        storageLimitMb: undefined,
        features: [],
        trialDays: 0,
        active: true,
        sortOrder: APPROVED_PLANS.indexOf(p) + 1,
        category: p.category,
        billingUnit: p.billingUnit,
        planGroup: p.code,
        aiEnabled: p.aiEnabled,
        aiFeatures: p.aiEnabled ? [] : undefined,
        aiAllowanceTokens:
          args.aiAllowanceTokens?.[p.code as "advocate_ai" | "chamber_ai" | "enterprise"],
        aiAdvancedModel: false,
        aiMaxConcurrentJobs: p.aiEnabled ? 2 : undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("platformAdminAudit", {
        actorId: admin._id,
        actorName: admin.name ?? admin.email ?? admin._id.slice(-6),
        action: "plan.approvedSeed",
        targetType: "saasPlan",
        targetId: id,
        detail: `${p.code} seeded at the approved price ${expectedPrice} minor`,
        createdAt: Date.now(),
      });
      results.push({ code: p.code, action: "created", detail: `seeded at ${expectedPrice} minor` });
    }
    return { results };
  },
});

void v;
