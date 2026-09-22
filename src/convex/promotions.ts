import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAccess } from "./access";

// ===============================================================
// Paid listings & promotions (section 23).
//
// Compliance gate: nothing can be sold, displayed or paid for until an
// owner records a professional-advertising review for the operating
// jurisdiction and explicitly enables the feature. Paid placements are
// stored and rendered separately from organic results, always carry a
// clear sponsored label, and never influence or display verification
// status. Everything expires automatically by its endsAt timestamp.
// ===============================================================

/** Feature gate — throws when the org has not enabled promotions. */
async function requirePromotionsEnabled(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
): Promise<Doc<"organizations">> {
  const org = await ctx.db.get(orgId);
  if (!org) throw new Error("Organization not found.");
  if (!(org.promotionsEnabled ?? false)) {
    throw new Error(
      "Paid placements are disabled. An owner must first record the professional-advertising compliance review and enable the feature.",
    );
  }
  return org;
}

async function requireOwner(ctx: MutationCtx) {
  const ac = await requireAccess(ctx);
  if (ac.membership.orgRole !== "owner" && ac.membership.orgRole !== "administrator") {
    throw new Error("Only the chamber owner or an administrator can manage paid placements.");
  }
  return ac;
}

// ---------------------------------------------------------------
// Feature gate & pop-up settings (owner)
// ---------------------------------------------------------------

export const setEnabled = mutation({
  args: {
    enabled: v.boolean(),
    complianceNote: v.optional(v.string()),
    jurisdiction: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireOwner(ctx);
    if (args.enabled) {
      const note = args.complianceNote?.trim() ?? "";
      if (note.length < 20) {
        throw new Error(
          "Record the compliance review first: state the jurisdiction reviewed, the professional-advertising rules considered and the date of review (at least a sentence).",
        );
      }
      await ctx.db.patch(ac.org._id, {
        promotionsEnabled: true,
        promotionsComplianceNote: note.slice(0, 1000),
        promotionsComplianceAt: Date.now(),
        promotionsComplianceBy: ac.user._id,
      });
    } else {
      await ctx.db.patch(ac.org._id, {
        promotionsEnabled: false,
        // The recorded review stays for the audit trail.
      });
    }
    return { ok: true };
  },
});

export const setPopup = mutation({
  args: {
    enabled: v.boolean(),
    headline: v.optional(v.string()),
    body: v.optional(v.string()),
    cta: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireOwner(ctx);
    await requirePromotionsEnabled(ctx, ac.org._id);
    await ctx.db.patch(ac.org._id, {
      promoPopupEnabled: args.enabled,
      promoPopupHeadline: args.headline?.trim().slice(0, 120) ?? undefined,
      promoPopupBody: args.body?.trim().slice(0, 400) ?? undefined,
      promoPopupCta: args.cta?.trim().slice(0, 40) ?? undefined,
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------
// Packages (owner) — pricing, duration, placement type
// ---------------------------------------------------------------

export const savePackage = mutation({
  args: {
    packageId: v.optional(v.id("promotionPackages")),
    name: v.string(),
    placement: v.union(
      v.literal("sponsored_listing"),
      v.literal("banner"),
      v.literal("popup"),
    ),
    priceMinor: v.number(),
    durationDays: v.number(),
    description: v.optional(v.string()),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const ac = await requireOwner(ctx);
    await requirePromotionsEnabled(ctx, ac.org._id);
    const name = args.name.trim();
    if (!name) throw new Error("Give the package a name.");
    if (!Number.isInteger(args.priceMinor) || args.priceMinor <= 0) {
      throw new Error("Price must be a positive number of paise.");
    }
    if (!Number.isInteger(args.durationDays) || args.durationDays < 1 || args.durationDays > 365) {
      throw new Error("Duration must be between 1 and 365 days.");
    }
    const base = {
      orgId: ac.org._id,
      name: name.slice(0, 80),
      placement: args.placement,
      priceMinor: args.priceMinor,
      durationDays: args.durationDays,
      description: args.description?.trim().slice(0, 300) ?? undefined,
      active: args.active,
      updatedAt: Date.now(),
    };
    if (args.packageId) {
      const existing = await ctx.db.get(args.packageId);
      if (!existing || existing.orgId !== ac.org._id) {
        throw new Error("Package not found.");
      }
      await ctx.db.patch(args.packageId, base);
      return { packageId: args.packageId };
    }
    const id = await ctx.db.insert("promotionPackages", {
      ...base,
      createdById: ac.user._id,
      createdAt: Date.now(),
    });
    return { packageId: id };
  },
});

export const listPackages = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    const rows = await ctx.db
      .query("promotionPackages")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return rows.sort((a, b) => a.priceMinor - b.priceMinor);
  },
});

// ---------------------------------------------------------------
// Member submissions — lawyer picks a package & pays
// ---------------------------------------------------------------

export const availablePackages = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    if (!(ac.org.promotionsEnabled ?? false)) return [];
    const rows = await ctx.db
      .query("promotionPackages")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return rows.filter((p) => p.active);
  },
});

/** My promotion submissions in this chamber. */
export const myPromotions = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    const rows = await ctx.db
      .query("promotions")
      .withIndex("by_submitted_by", (q) => q.eq("submittedByUserId", ac.user._id))
      .collect();
    return rows
      .filter((p) => p.orgId === ac.org._id)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * Submit a promotion request: creates an unpaid row pending owner
 * approval, then (via scheduler) a Razorpay payment link. Payment never
 * activates anything by itself — approval is a separate owner decision,
 * and the run window only starts when BOTH approval and payment exist.
 */
export const submit = mutation({
  args: {
    packageId: v.id("promotionPackages"),
    message: v.optional(v.string()),
    targetUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const org = await requirePromotionsEnabled(ctx, ac.org._id);
    if (ac.membership.orgRole === "support_staff") {
      throw new Error("Support staff accounts cannot purchase promotions.");
    }
    const pkg = await ctx.db.get(args.packageId);
    if (!pkg || pkg.orgId !== ac.org._id || !pkg.active) {
      throw new Error("That promotion package is not available.");
    }
    // The member must have a published directory profile to promote.
    const profiles = await ctx.db
      .query("publicProfiles")
      .withIndex("by_user", (q) => q.eq("userId", ac.user._id))
      .collect();
    const profile = profiles.find((p) => p.orgId === ac.org._id);
    if (!profile || !profile.published) {
      throw new Error("Publish your directory profile before purchasing a promotion.");
    }

    const now = Date.now();
    const id = await ctx.db.insert("promotions", {
      orgId: ac.org._id,
      packageId: pkg._id,
      submittedByUserId: ac.user._id,
      profileId: profile._id,
      advocateName: ac.user.name ?? ac.user.email ?? "Advocate",
      message: args.message?.trim().slice(0, 200) ?? undefined,
      targetUrl: /^https?:\/\/.+/.test(args.targetUrl?.trim() ?? "")
        ? args.targetUrl!.trim().slice(0, 300)
        : undefined,
      approvalStatus: "pending",
      amountMinor: pkg.priceMinor,
      paymentStatus: "unpaid",
      createdAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.paymentsProvider.createPromotionPaymentLink, {
      promotionId: id,
      orgId: ac.org._id,
      packageName: pkg.name,
      amountMinor: pkg.priceMinor,
      payerEmail: ac.user.email ?? undefined,
      payerName: ac.user.name ?? "Advocate",
      orgName: org.name,
    });

    return { promotionId: id, priceMinor: pkg.priceMinor };
  },
});

/** Owner approves or rejects a submission. */
export const decide = mutation({
  args: {
    promotionId: v.id("promotions"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireOwner(ctx);
    const org = await requirePromotionsEnabled(ctx, ac.org._id);
    void org;
    const promo = await ctx.db.get(args.promotionId);
    if (!promo || promo.orgId !== ac.org._id) {
      throw new Error("Promotion not found.");
    }
    if (promo.approvalStatus !== "pending") {
      throw new Error("This promotion has already been decided.");
    }
    if (args.decision === "rejected") {
      const reason = args.reason?.trim();
      if (!reason) throw new Error("Give the member a written rejection reason.");
      await ctx.db.patch(promo._id, {
        approvalStatus: "rejected",
        approvedById: ac.user._id,
        approvedAt: Date.now(),
        rejectionReason: reason.slice(0, 300),
        updatedAt: Date.now(),
      });
      return { ok: true };
    }
    // Approved — activation happens when payment completes (or instantly
    // if already paid).
    await ctx.db.patch(promo._id, {
      approvalStatus: "approved",
      approvedById: ac.user._id,
      approvedAt: Date.now(),
      rejectionReason: undefined,
      updatedAt: Date.now(),
    });
    await maybeActivate(ctx, promo._id);
    return { ok: true };
  },
});

/** Owner can cancel a paid-but-live promotion (no refund implied). */
export const cancelByOwner = mutation({
  args: { promotionId: v.id("promotions"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireOwner(ctx);
    const promo = await ctx.db.get(args.promotionId);
    if (!promo || promo.orgId !== ac.org._id) throw new Error("Promotion not found.");
    await ctx.db.patch(promo._id, {
      paymentStatus: promo.paymentStatus === "paid" ? "refunded" : promo.paymentStatus,
      approvalStatus: "rejected",
      rejectionReason:
        args.reason?.trim().slice(0, 300) ?? "Withdrawn by the chamber.",
      endsAt: Math.min(promo.endsAt ?? Infinity, Date.now()),
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------
// Owner desk
// ---------------------------------------------------------------

export const adminList = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    if (ac.membership.orgRole !== "owner" && ac.membership.orgRole !== "administrator")
      return [];
    const [promos, packages] = await Promise.all([
      ctx.db
        .query("promotions")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect(),
      ctx.db
        .query("promotionPackages")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect(),
    ]);
    const pkgById = new Map(packages.map((p) => [p._id, p]));
    return promos
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((p) => {
        const pkg = pkgById.get(p.packageId);
        const live =
          p.approvalStatus === "approved" &&
          p.paymentStatus === "paid" &&
          (p.startsAt ?? 0) <= Date.now() &&
          (p.endsAt ?? 0) > Date.now();
        return {
          _id: p._id,
          packageName: pkg?.name ?? "Package",
          placement: pkg?.placement ?? "sponsored_listing",
          advocateName: p.advocateName,
          message: p.message ?? null,
          targetUrl: p.targetUrl ?? null,
          approvalStatus: p.approvalStatus,
          paymentStatus: p.paymentStatus,
          amountMinor: p.amountMinor,
          startsAt: p.startsAt ?? null,
          endsAt: p.endsAt ?? null,
          live,
          impressions: p.impressions ?? 0,
          clicks: p.clicks ?? 0,
          rejectionReason: p.rejectionReason ?? null,
          paymentLinkUrl: p.paymentLinkUrl ?? null,
          submittedAt: p.createdAt,
        };
      });
  },
});

// ---------------------------------------------------------------
// Public placements (no auth) — only when enabled, approved, paid,
// within window, and always labeled
// ---------------------------------------------------------------

function placementShape(p: Doc<"promotions">) {
  return {
    promotionId: p._id,
    advocateName: p.advocateName,
    message: p.message ?? null,
    targetUrl: p.targetUrl ?? null,
    profileId: p.profileId ?? null,
  };
}

export const publicPlacements = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    enabled: boolean;
    sponsored: {
      promotionId: Id<"promotions">;
      advocateName: string;
      message: string | null;
      targetUrl: string | null;
      profileId: Id<"publicProfiles"> | null;
    }[];
    banner: { promotionId: Id<"promotions">; message: string | null; targetUrl: string | null; advocateName: string } | null;
    popup: {
      enabled: boolean;
      headline: string | null;
      body: string | null;
      cta: string | null;
    } | null;
  }> => {
    // Find any org with promotions enabled (the directory is org-agnostic;
    // each placement carries its chamber attribution).
    const orgs = await ctx.db.query("organizations").collect();
    const enabled = orgs.some((o) => o.promotionsEnabled ?? false);
    if (!enabled) {
      return { enabled: false, sponsored: [], banner: null, popup: null };
    }
    const enabledOrgIds = new Set(
      orgs.filter((o) => o.promotionsEnabled ?? false).map((o) => o._id),
    );
    const now = Date.now();
    const all = await ctx.db.query("promotions").collect();
    const live = all.filter(
      (p) =>
        enabledOrgIds.has(p.orgId) &&
        p.approvalStatus === "approved" &&
        p.paymentStatus === "paid" &&
        (p.startsAt ?? 0) <= now &&
        (p.endsAt ?? 0) > now,
    );

    const sponsoredRows: { p: Doc<"promotions">; pkg: Doc<"promotionPackages"> | null }[] = [];
    let banner: {
      promotionId: Id<"promotions">;
      message: string | null;
      targetUrl: string | null;
      advocateName: string;
    } | null = null;
    for (const p of live) {
      const pkg = await ctx.db.get(p.packageId);
      if (pkg?.placement === "sponsored_listing") sponsoredRows.push({ p, pkg });
      if (pkg?.placement === "banner" && banner === null) {
        banner = {
          promotionId: p._id,
          message: p.message ?? null,
          targetUrl: p.targetUrl ?? null,
          advocateName: p.advocateName,
        };
      }
    }
    sponsoredRows.sort(() => Math.random() - 0.5); // rotate placement order

    const popupOrg = orgs.find(
      (o) => (o.promotionsEnabled ?? false) && (o.promoPopupEnabled ?? false),
    );

    return {
      enabled: true,
      sponsored: sponsoredRows.slice(0, 3).map(({ p }) => placementShape(p)),
      banner,
      popup: popupOrg
        ? {
            enabled: true,
            headline: popupOrg.promoPopupHeadline ?? "Promoted",
            body: popupOrg.promoPopupBody ?? null,
            cta: popupOrg.promoPopupCta ?? "Learn more",
          }
        : null,
    };
  },
});

// ---------------------------------------------------------------
// Metrics (no auth — public directory path, cheap increments)
// ---------------------------------------------------------------

/** Public: count one impression per rendered placement (live only). */
export const recordImpressions = mutation({
  args: { promotionIds: v.array(v.id("promotions")) },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.promotionIds.slice(0, 10)) {
      const p = await ctx.db.get(id);
      if (!p) continue;
      if (
        p.approvalStatus !== "approved" ||
        p.paymentStatus !== "paid" ||
        (p.startsAt ?? 0) > now ||
        (p.endsAt ?? 0) <= now
      )
        continue;
      await ctx.db.patch(id, { impressions: (p.impressions ?? 0) + 1 });
    }
  },
});

export const recordClick = mutation({
  args: { promotionId: v.id("promotions") },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.promotionId);
    if (!p) return;
    // Only count clicks on live promotions.
    const org = await ctx.db.get(p.orgId);
    if (!(org?.promotionsEnabled ?? false)) return;
    const now = Date.now();
    if (
      p.approvalStatus !== "approved" ||
      p.paymentStatus !== "paid" ||
      (p.startsAt ?? 0) > now ||
      (p.endsAt ?? 0) <= now
    )
      return;
    await ctx.db.patch(args.promotionId, { clicks: (p.clicks ?? 0) + 1 });
  },
});

/** Internal: store the created payment link on the promotion. */
export const attachPaymentLinkInternal = internalMutation({
  args: {
    promotionId: v.id("promotions"),
    paymentLinkId: v.string(),
    paymentLinkUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.promotionId, {
      paymentLinkId: args.paymentLinkId,
      paymentLinkUrl: args.paymentLinkUrl,
      updatedAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------
// Activation from the verified payment webhook
// ---------------------------------------------------------------

/** Called by billing.reconcileWebhookInternal when a promotion payment. */
export const activateOnPaymentInternal = internalMutation({
  args: { promotionId: v.id("promotions"), providerPaymentId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.promotionId);
    if (!p || p.paymentStatus === "paid") return { applied: false };
    const pkg = await ctx.db.get(p.packageId);
    const now = Date.now();
    const durationDays = pkg?.durationDays ?? 30;
    // Window starts now regardless of approval state; if approval comes
    // later, maybeActivate keeps the same window.
    await ctx.db.patch(args.promotionId, {
      paymentStatus: "paid",
      paidAt: now,
      providerPaymentId: args.providerPaymentId,
      startsAt: p.startsAt ?? now,
      endsAt: p.startsAt ?? now + durationDays * 24 * 60 * 60 * 1000,
      updatedAt: now,
    });
    await maybeActivate(ctx, args.promotionId);
    return { applied: true };
  },
});

/** Start the window only when both approved AND paid. */
async function maybeActivate(ctx: MutationCtx, promotionId: Id<"promotions">) {
  const p = await ctx.db.get(promotionId);
  if (!p) return;
  if (p.approvalStatus !== "approved" || p.paymentStatus !== "paid") return;
  const now = Date.now();
  const pkg = await ctx.db.get(p.packageId);
  const durationDays = pkg?.durationDays ?? 30;
  const startsAt = p.startsAt ?? now;
  const endsAt = p.endsAt ?? startsAt + durationDays * 24 * 60 * 60 * 1000;
  if (p.startsAt === undefined || p.endsAt === undefined) {
    await ctx.db.patch(promotionId, { startsAt, endsAt, updatedAt: now });
  }
}
