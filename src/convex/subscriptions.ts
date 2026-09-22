import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { requireAccess, requireCapability, requireWriteAccess } from "./access";
import { getCurrentUser } from "./users";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// Commercial SaaS subscriptions (section 24).
//
// The platform itself is sold. Plans are platform-level (individual
// lawyer vs firm), configurable in seats/storage/features, with trials,
// checkout through the same signature-verified Razorpay webhook path as
// client invoices, renewal/cancellation/expiry, subscription invoices,
// a grace period ending in read-only mode, and one-time export tokens
// for taking data out before closure.
//
// SEPARATION OF MONEYS: subscription invoices live in
// subscriptionInvoices with their own ADV-SUB numbering — they never
// touch the lawyers' client invoices/payments.
// =====================================================================

const MAX_HISTORY = 80;
const GRACE_DAYS = 7;
const DAY = 86_400_000;
const MAX_EXPORT_TOKENS_PER_ORG = 3;

function now(): number {
  return Date.now();
}
function fmtINR(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function periodEnd(from: number, interval: "monthly" | "yearly"): number {
  const d = new Date(from);
  if (interval === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

function planLabel(p: Doc<"saasPlans">, interval: "monthly" | "yearly"): string {
  const base = `${p.name} (${interval === "yearly" ? "annual" : "monthly"})`;
  return base;
}

async function history(
  ctx: MutationCtx,
  sub: Doc<"subscriptions">,
  text: string,
) {
  await ctx.db.patch(sub._id, {
    history: [...(sub.history ?? []), { at: now(), text: text.slice(0, 300) }].slice(-MAX_HISTORY),
    updatedAt: now(),
  });
}

async function getSubForOrg(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
): Promise<Doc<"subscriptions"> | null> {
  const rows = await ctx.db
    .query("subscriptions")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------
// Public surface for members (Settings → Subscription)
// ---------------------------------------------------------------------

/** My organization's subscription + the purchasable plans. */
export const mySubscription = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    const sub = await getSubForOrg(ctx, ac.org._id);
    const plans = (
      await ctx.db.query("saasPlans").collect()
    )
      .filter((p) => p.active)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((p) => ({
        _id: p._id,
        code: p.code,
        name: p.name,
        kind: p.kind,
        priceMinor: p.priceMinor,
        interval: p.interval,
        seatLimit: p.seatLimit ?? null,
        storageLimitMb: p.storageLimitMb ?? null,
        features: p.features ?? [],
        trialDays: p.trialDays ?? null,
      }));

    if (!sub) {
      return { subscription: null, plans, readOnly: false, graceUntil: null };
    }
    const readOnly =
      sub.status === "read_only" ||
      sub.status === "closed" ||
      (sub.status === "grace" && (sub.graceUntil ?? 0) < now());
    return {
      subscription: {
        _id: sub._id,
        status: sub.status,
        interval: sub.interval,
        planId: sub.planId,
        planName: plans.find((p) => p._id === sub.planId)?.name ?? "—",
        seatLimit: sub.seatLimit ?? null,
        storageLimitMb: sub.storageLimitMb ?? null,
        trialEndsAt: sub.trialEndsAt ?? null,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAt: sub.cancelAt ?? null,
        paymentLinkUrl: sub.paymentLinkUrl ?? null,
        awaitingPayment:
          sub.status === "past_due" && !!sub.paymentLinkUrl && !sub.paymentLinkIdConsumed,
        lastInvoiceNumber: sub.lastInvoiceNumber ?? null,
        history: (sub.history ?? []).slice(-20).reverse(),
      },
      plans,
      readOnly,
      graceUntil: sub.graceUntil ?? null,
    };
  },
});

/** Subscription invoices for my organization. */
export const mySubscriptionInvoices = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    const sub = await getSubForOrg(ctx, ac.org._id);
    if (!sub) return [];
    const rows = await ctx.db
      .query("subscriptionInvoices")
      .withIndex("by_subscription", (q) => q.eq("subscriptionId", sub._id))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).map((r) => ({
      _id: r._id,
      number: r.number,
      planName: r.planName,
      interval: r.interval,
      amountMinor: r.amountMinor,
      status: r.status,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      dueOn: r.dueOn,
      paidAt: r.paidAt ?? null,
    }));
  },
});

/** Live seat usage vs the plan limit. */
export const seatUsage = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    const members = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const active = members.filter((m) => m.status === "active");
    const exempt = active.filter((m) => m.seatExempt === true).length;
    const sub = await getSubForOrg(ctx, ac.org._id);
    return {
      active: active.length,
      billable: active.length - exempt,
      exempt,
      limit: sub?.seatLimit ?? null,
    };
  },
});

// ---------------------------------------------------------------------
// Plans — platform administration
// ---------------------------------------------------------------------

export const upsertPlan = mutation({
  args: {
    planId: v.optional(v.id("saasPlans")),
    code: v.string(),
    name: v.string(),
    kind: v.union(v.literal("individual"), v.literal("firm")),
    priceMinor: v.number(),
    interval: v.union(v.literal("monthly"), v.literal("yearly")),
    seatLimit: v.optional(v.number()),
    storageLimitMb: v.optional(v.number()),
    features: v.optional(v.array(v.string())),
    trialDays: v.optional(v.number()),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const admin = await getCurrentUser(ctx);
    if (!admin?.isPlatformAdmin) {
      throw new Error("Platform administration access required.");
    }
    const code = args.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24);
    if (!code) throw new Error("Plan code is required.");
    if (!Number.isInteger(args.priceMinor) || args.priceMinor < 0) {
      throw new Error("Price must be whole paise.");
    }
    if (args.trialDays !== undefined && (args.trialDays < 0 || args.trialDays > 90)) {
      throw new Error("Trial length is 0–90 days.");
    }
    if (args.seatLimit !== undefined && args.seatLimit < 1) {
      throw new Error("Seat limit must be at least 1 when set.");
    }
    const existing = args.planId
      ? await ctx.db.get(args.planId)
      : (
          await ctx.db.query("saasPlans").withIndex("by_code", (q) => q.eq("code", code)).collect()
        )[0];
    if (args.planId && !existing) throw new Error("Plan not found.");
    if (existing) {
      await ctx.db.patch(existing._id, {
        code,
        name: args.name.trim().slice(0, 80),
        kind: args.kind,
        priceMinor: args.priceMinor,
        interval: args.interval,
        seatLimit: args.seatLimit,
        storageLimitMb: args.storageLimitMb,
        features: args.features?.map((f) => f.trim().slice(0, 60)).filter(Boolean).slice(0, 12),
        trialDays: args.trialDays,
        active: args.active,
        updatedAt: now(),
      });
      await ctx.db.insert("platformAdminAudit", {
        actorId: admin._id,
        actorName: admin.name ?? admin.email ?? admin._id.slice(-6),
        action: "plan.upsert",
        targetType: "saasPlan",
        targetId: existing._id,
        detail: `${code} — ${args.name}`,
        createdAt: now(),
      });
      return existing._id;
    }
    const id = await ctx.db.insert("saasPlans", {
      code,
      name: args.name.trim().slice(0, 80),
      kind: args.kind,
      priceMinor: args.priceMinor,
      interval: args.interval,
      seatLimit: args.seatLimit,
      storageLimitMb: args.storageLimitMb,
      features: args.features?.map((f) => f.trim().slice(0, 60)).filter(Boolean).slice(0, 12),
      trialDays: args.trialDays,
      active: args.active,
      createdAt: now(),
    });
    await ctx.db.insert("platformAdminAudit", {
      actorId: admin._id,
      actorName: admin.name ?? admin.email ?? admin._id.slice(-6),
      action: "plan.create",
      targetType: "saasPlan",
      targetId: id,
      detail: `${code} — ${args.name}`,
      createdAt: now(),
    });
    return id;
  },
});

export const setPlanActive = mutation({
  args: { planId: v.id("saasPlans"), active: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await getCurrentUser(ctx);
    if (!admin?.isPlatformAdmin) {
      throw new Error("Platform administration access required.");
    }
    const plan = await ctx.db.get(args.planId);
    if (!plan) throw new Error("Plan not found.");
    await ctx.db.patch(args.planId, { active: args.active, updatedAt: now() });
    await ctx.db.insert("platformAdminAudit", {
      actorId: admin._id,
      actorName: admin.name ?? admin.email ?? admin._id.slice(-6),
      action: args.active ? "plan.enable" : "plan.disable",
      targetType: "saasPlan",
      targetId: args.planId,
      detail: plan.code,
      createdAt: now(),
    });
  },
});

// ---------------------------------------------------------------------
// Checkout — start a subscription (trial or paid)
// ---------------------------------------------------------------------

export const startSubscription = mutation({
  args: { planId: v.id("saasPlans") },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    requireCapability(ac, "billing.invoice"); // owners/admins/accountants
    const plan = await ctx.db.get(args.planId);
    if (!plan || !plan.active) throw new Error("That plan is not available.");
    if (plan.kind === "individual" && ac.org.kind === "firm") {
      throw new Error("Individual plans are for single-lawyer chambers.");
    }

    const existing = await getSubForOrg(ctx, ac.org._id);
    if (existing && ["trialing", "active", "past_due", "grace"].includes(existing.status)) {
      throw new Error("This organization already has a live subscription.");
    }

    const t = now();
    const trialEndsAt =
      plan.trialDays && plan.trialDays > 0 ? t + plan.trialDays * DAY : undefined;

    if (existing) {
      // Reactivating after expiry/cancellation: fresh window, new state.
      await ctx.db.patch(existing._id, {
        planId: plan._id,
        interval: plan.interval,
        seatLimit: plan.seatLimit,
        storageLimitMb: plan.storageLimitMb,
        status: trialEndsAt ? "trialing" : "past_due",
        trialEndsAt,
        currentPeriodEnd: trialEndsAt ?? t,
        cancelAt: undefined,
        cancelledAt: undefined,
        endedAt: undefined,
        graceUntil: undefined,
        paymentLinkId: undefined,
        paymentLinkUrl: undefined,
        paymentLinkIdConsumed: undefined,
        updatedAt: t,
      });
      await history(ctx, { ...existing, _id: existing._id } as Doc<"subscriptions">, `Subscription (re)started on ${planLabel(plan, plan.interval)}${trialEndsAt ? ` — trial until ${new Date(trialEndsAt).toISOString().slice(0, 10)}` : ""}.`);
      await ctx.db.patch(ac.org._id, {
        subscription: {
          planId: plan._id,
          status: trialEndsAt ? "trialing" : "past_due",
          trialEndsAt,
          currentPeriodEnd: trialEndsAt ?? t,
        },
      });
      return { subscriptionId: existing._id, needsPayment: !trialEndsAt };
    }

    const subId = await ctx.db.insert("subscriptions", {
      orgId: ac.org._id,
      planId: plan._id,
      status: trialEndsAt ? "trialing" : "past_due",
      interval: plan.interval,
      seatLimit: plan.seatLimit,
      storageLimitMb: plan.storageLimitMb,
      trialEndsAt,
      currentPeriodEnd: trialEndsAt ?? t,
      history: [
        {
          at: t,
          text: `Subscription started on ${planLabel(plan, plan.interval)}${trialEndsAt ? ` — trial until ${new Date(trialEndsAt).toISOString().slice(0, 10)}` : ""}.`,
        },
      ],
      createdAt: t,
    });
    await ctx.db.patch(ac.org._id, {
      subscription: {
        planId: plan._id,
        status: trialEndsAt ? "trialing" : "past_due",
        trialEndsAt,
        currentPeriodEnd: trialEndsAt ?? t,
      },
    });
    return { subscriptionId: subId, needsPayment: !trialEndsAt };
  },
});

/** Generate (or reuse) the payment link for the current period. */
export const requestSubscriptionPayment = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await requireWriteAccess(ctx);
    requireCapability(ac, "billing.invoice");
    const sub = await getSubForOrg(ctx, ac.org._id);
    if (!sub) throw new Error("No subscription to pay for.");
    if (sub.status === "active") throw new Error("This subscription is already paid up.");
    if (sub.paymentLinkUrl && !sub.paymentLinkIdConsumed) {
      return { url: sub.paymentLinkUrl };
    }
    // Reuse an in-flight link; otherwise tell the UI to open checkout
    // (the Node action creates the link and attaches it here).
    return { url: sub.paymentLinkUrl ?? null, openCheckout: !sub.paymentLinkUrl };
  },
});

/** Authorization + payload for the checkout action (runs Node-side). */
export const checkoutPrecheckInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const ac = await requireWriteAccess(ctx);
    if (!ac.permissions.has("billing.invoice")) {
      return { allowed: false as const, reason: "billing capability required" };
    }
    const sub = await getSubForOrg(ctx, ac.org._id);
    if (!sub) return { allowed: false as const, reason: "no subscription" };
    if (sub.status === "active") {
      return { allowed: false as const, reason: "already active" };
    }
    if (sub.paymentLinkUrl && !sub.paymentLinkIdConsumed) {
      return { allowed: true as const, kind: "reuse" as const, url: sub.paymentLinkUrl };
    }
    const plan = await ctx.db.get(sub.planId);
    if (!plan) return { allowed: false as const, reason: "plan missing" };
    return {
      allowed: true as const,
      kind: "new" as const,
      subscriptionId: sub._id,
      orgName: ac.org.name,
      planName: planLabel(plan, sub.interval),
      amountMinor: plan.priceMinor,
      payerEmail: ac.user.email ?? undefined,
      payerName: ac.user.name ?? ac.org.name,
    };
  },
});

// ---------------------------------------------------------------------
// Lifecycle — renew, cancel, resume
// ---------------------------------------------------------------------

export const cancelSubscription = mutation({
  args: { immediately: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    requireCapability(ac, "billing.invoice");
    const sub = await getSubForOrg(ctx, ac.org._id);
    if (!sub) throw new Error("No subscription.");
    if (!["trialing", "active", "past_due"].includes(sub.status)) {
      throw new Error("The subscription is not cancellable in its current state.");
    }
    const t = now();
    if (args.immediately) {
      await ctx.db.patch(sub._id, {
        status: "grace",
        cancelledAt: t,
        graceUntil: t + GRACE_DAYS * DAY,
        updatedAt: t,
      });
      await history(ctx, sub, "Cancelled immediately — grace period started.");
      await ctx.db.patch(ac.org._id, {
        subscription: { planId: sub.planId, status: "grace", graceUntil: t + GRACE_DAYS * DAY },
      });
    } else {
      await ctx.db.patch(sub._id, {
        cancelAt: sub.currentPeriodEnd,
        cancelledAt: t,
        updatedAt: t,
      });
      await history(ctx, sub, `Cancellation scheduled for the end of the current period (${new Date(sub.currentPeriodEnd).toISOString().slice(0, 10)}).`);
    }
  },
});

export const resumeSubscription = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await requireWriteAccess(ctx);
    requireCapability(ac, "billing.invoice");
    const sub = await getSubForOrg(ctx, ac.org._id);
    if (!sub) throw new Error("No subscription.");
    if (!sub.cancelledAt || sub.status === "closed" || sub.status === "read_only") {
      throw new Error("There is no scheduled cancellation to resume.");
    }
    await ctx.db.patch(sub._id, {
      cancelAt: undefined,
      cancelledAt: undefined,
      updatedAt: now(),
    });
    await history(ctx, sub, "Scheduled cancellation withdrawn.");
  },
});

// ---------------------------------------------------------------------
// Expiry engine (internal, driven by crons.ts daily)
// ---------------------------------------------------------------------

export const runExpiryScan = internalMutation({
  args: {},
  handler: async (ctx) => {
    const t = now();
    const subs = await ctx.db.query("subscriptions").collect();
    let changed = 0;
    for (const sub of subs) {
      if (["closed", "read_only"].includes(sub.status)) continue;

      // 1) Trial expiry -> past_due (payment window) 
      if (sub.status === "trialing" && sub.trialEndsAt && t > sub.trialEndsAt) {
        await ctx.db.patch(sub._id, { status: "past_due", updatedAt: t });
        await history(ctx, sub, "Trial ended — payment required.");
        await ctx.db.patch(sub.orgId, {
          subscription: { planId: sub.planId, status: "past_due" },
        });
        changed++;
        continue;
      }

      // 2) Period end:
      if (t > sub.currentPeriodEnd) {
        if (sub.cancelAt && t >= sub.cancelAt) {
          // Cancelled at period end -> grace (read-only afterwards).
          const graceUntil = t + GRACE_DAYS * DAY;
          await ctx.db.patch(sub._id, {
            status: "grace",
            graceUntil,
            updatedAt: t,
          });
          await history(ctx, sub, "Subscription ended at period end — grace period started.");
          await ctx.db.patch(sub.orgId, {
            subscription: { planId: sub.planId, status: "grace", graceUntil },
          });
          changed++;
        } else if (sub.status === "active") {
          // Missed renewal -> past_due, keep working while the provider
          // retries / the chamber pays the link.
          await ctx.db.patch(sub._id, { status: "past_due", updatedAt: t });
          await history(ctx, sub, "Renewal payment not received — subscription is past due.");
          await ctx.db.patch(sub.orgId, {
            subscription: { planId: sub.planId, status: "past_due" },
          });
          changed++;
        } else if (sub.status === "past_due" && (!sub.cancelAt || t >= sub.cancelAt)) {
          // past_due beyond the period + 7 days -> grace.
          const graceUntil = t + GRACE_DAYS * DAY;
          await ctx.db.patch(sub._id, { status: "grace", graceUntil, updatedAt: t });
          await history(ctx, sub, "Payment still outstanding — grace period started.");
          await ctx.db.patch(sub.orgId, {
            subscription: { planId: sub.planId, status: "grace", graceUntil },
          });
          changed++;
        }
      }

      // 3) Grace end -> read_only (data stays viewable/exportable).
      const graceUntil = sub.graceUntil;
      if (sub.status === "grace" && graceUntil && t > graceUntil) {
        await ctx.db.patch(sub._id, { status: "read_only", endedAt: t, updatedAt: t });
        await history(ctx, sub, "Grace period ended — the chamber is now read-only. Export remains available.");
        await ctx.db.patch(sub.orgId, {
          subscription: { planId: sub.planId, status: "read_only", endedAt: t },
        });
        changed++;
      }
    }
    return { changed };
  },
});

// ---------------------------------------------------------------------
// Verified payments — reconcile SaaS events (kind: "saas")
// ---------------------------------------------------------------------

/** Attach the created payment link (called from the Node action). */
export const attachPaymentLinkInternal = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    paymentLinkId: v.string(),
    paymentLinkUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, {
      paymentLinkId: args.paymentLinkId,
      paymentLinkUrl: args.paymentLinkUrl,
      paymentLinkIdConsumed: false,
      updatedAt: now(),
    });
  },
});

/** Record a non-reconciling SaaS webhook event (audit). */
export const recordSaasEventInternal = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    note: v.string(),
    payloadJson: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("saasPaymentEvents")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .first();
    if (existing?.handledAt) return;
    if (existing) {
      await ctx.db.patch(existing._id, { handledAt: now(), note: args.note });
      return;
    }
    await ctx.db.insert("saasPaymentEvents", {
      eventId: args.eventId,
      eventType: args.eventType,
      payload: args.payloadJson.slice(0, 8000),
      note: args.note,
      handledAt: now(),
      createdAt: now(),
    });
  },
});

/** Mark the link attempt consumed so it cannot double-apply. */
export const markLinkConsumed = internalMutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, { paymentLinkIdConsumed: true, updatedAt: now() });
  },
});

export const reconcileSaasPaymentInternal = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    payloadJson: v.string(),
    paymentLinkId: v.optional(v.string()),
    providerPaymentId: v.string(),
    amountMinor: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("saasPaymentEvents")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .first();
    if (existing?.handledAt) return { applied: false, reason: "already-handled" };

    if (!args.paymentLinkId) {
      if (existing) {
        await ctx.db.patch(existing._id, { handledAt: now(), note: "No payment link reference." });
        return { applied: false, reason: "no-target" };
      }
      await ctx.db.insert("saasPaymentEvents", {
        eventId: args.eventId,
        eventType: args.eventType,
        payload: args.payloadJson.slice(0, 8000),
        note: "No payment link reference.",
        handledAt: now(),
        createdAt: now(),
      });
      return { applied: false, reason: "no-target" };
    }

    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_link", (q) => q.eq("paymentLinkId", args.paymentLinkId!))
      .collect();
    const sub = subs[0];
    if (!sub) {
      if (existing) {
        await ctx.db.patch(existing._id, { handledAt: now(), note: "No matching subscription." });
      } else {
        await ctx.db.insert("saasPaymentEvents", {
          eventId: args.eventId,
          eventType: args.eventType,
          payload: args.payloadJson.slice(0, 8000),
          note: "No matching subscription.",
          handledAt: now(),
          createdAt: now(),
        });
      }
      return { applied: false, reason: "no-target" };
    }

    if (!existing) {
      await ctx.db.insert("saasPaymentEvents", {
        eventId: args.eventId,
        eventType: args.eventType,
        payload: args.payloadJson.slice(0, 8000),
        handledAt: now(),
        createdAt: now(),
      });
    } else {
      await ctx.db.patch(existing._id, { handledAt: now() });
    }

    const t = now();
    const isNewPeriod = sub.status !== "active";
    const newPeriodEnd = periodEnd(t, sub.interval);
    const invoiceNumber = `ADV-SUB-${String(sub._id.slice(-6)).toUpperCase()}-${new Date(t).getFullYear()}-${String(await countInvoicesFor(ctx, sub._id) + 1).padStart(4, "0")}`;

    await ctx.db.insert("subscriptionInvoices", {
      number: invoiceNumber,
      subscriptionId: sub._id,
      orgId: sub.orgId,
      orgName: (await ctx.db.get(sub.orgId))?.name ?? "—",
      planCode: (await ctx.db.get(sub.planId))?.code ?? "—",
      planName: (await ctx.db.get(sub.planId))?.name ?? "—",
      interval: sub.interval,
      amountMinor: args.amountMinor,
      status: "paid",
      periodStart: isNewPeriod ? t : sub.currentPeriodEnd,
      periodEnd: newPeriodEnd,
      dueOn: new Date(t).toISOString().slice(0, 10),
      providerPaymentId: args.providerPaymentId,
      paidAt: t,
      createdAt: t,
    });

    await ctx.db.patch(sub._id, {
      status: "active",
      currentPeriodEnd: newPeriodEnd,
      cancelAt: undefined,
      graceUntil: undefined,
      providerPaymentId: args.providerPaymentId,
      paidAt: t,
      lastInvoiceNumber: invoiceNumber,
      paymentLinkIdConsumed: true,
      updatedAt: t,
    });
    await history(
      ctx,
      sub,
      `Payment verified — ${fmtINR(args.amountMinor)} (provider id ${args.providerPaymentId}). Active until ${new Date(newPeriodEnd).toISOString().slice(0, 10)}; invoice ${invoiceNumber}.`,
    );
    await ctx.db.patch(sub.orgId, {
      subscription: {
        planId: sub.planId,
        status: "active",
        currentPeriodEnd: newPeriodEnd,
      },
    });
    return { applied: true, subscriptionId: sub._id };
  },
});

async function countInvoicesFor(ctx: MutationCtx, subscriptionId: Id<"subscriptions">) {
  const rows = await ctx.db
    .query("subscriptionInvoices")
    .withIndex("by_subscription", (q) => q.eq("subscriptionId", subscriptionId))
    .collect();
  return rows.length;
}

// ---------------------------------------------------------------------
// Platform administration of subscriptions
// ---------------------------------------------------------------------

export const adminSetSubscriptionStatus = mutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    status: v.union(
      v.literal("trialing"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("grace"),
      v.literal("read_only"),
      v.literal("cancelled"),
      v.literal("closed"),
    ),
  },
  handler: async (ctx, args) => {
    const admin = await getCurrentUser(ctx);
    if (!admin?.isPlatformAdmin) {
      throw new Error("Platform administration access required.");
    }
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new Error("Subscription not found.");
    const t = now();
    await ctx.db.patch(sub._id, { status: args.status, updatedAt: t });
    await history(ctx, sub, `Status set to ${args.status} by platform administration.`);
    await ctx.db.patch(sub.orgId, {
      subscription: { planId: sub.planId, status: args.status },
    });
    await ctx.db.insert("platformAdminAudit", {
      actorId: admin._id,
      actorName: admin.name ?? admin.email ?? admin._id.slice(-6),
      action: "subscription.status",
      targetType: "subscription",
      targetId: sub._id,
      detail: `${sub.orgId} → ${args.status}`,
      createdAt: t,
    });
  },
});

export const adminSetSeatLimitOverride = mutation({
  args: { subscriptionId: v.id("subscriptions"), seatLimit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const admin = await getCurrentUser(ctx);
    if (!admin?.isPlatformAdmin) {
      throw new Error("Platform administration access required.");
    }
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new Error("Subscription not found.");
    if (args.seatLimit !== undefined && args.seatLimit < 1) {
      throw new Error("Seat limit must be at least 1 when set.");
    }
    await ctx.db.patch(sub._id, { seatLimit: args.seatLimit, updatedAt: now() });
    await history(ctx, sub, `Seat limit ${args.seatLimit ? `set to ${args.seatLimit}` : "reset to plan default"} by platform administration.`);
    await ctx.db.insert("platformAdminAudit", {
      actorId: admin._id,
      actorName: admin.name ?? admin.email ?? admin._id.slice(-6),
      action: "subscription.seat_limit",
      targetType: "subscription",
      targetId: sub._id,
      detail: args.seatLimit ? String(args.seatLimit) : "reset",
      createdAt: now(),
    });
  },
});

// ---------------------------------------------------------------------
// Export before closure — one-time time-boxed tokens
// ---------------------------------------------------------------------

export const createExportToken = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "billing.invoice");
    const prior = await ctx.db
      .query("saasExports")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const unused = prior.filter((r) => !r.usedAt && now() < r.expiresAt);
    if (unused.length >= MAX_EXPORT_TOKENS_PER_ORG) {
      throw new Error(
        `You already have ${MAX_EXPORT_TOKENS_PER_ORG} unused export links. Use one or wait for them to expire.`,
      );
    }
    const raw = `sx_${Math.random().toString(36).slice(2)}${now().toString(36)}`;
    const tokenHash = await hashToken(raw);
    await ctx.db.insert("saasExports", {
      orgId: ac.org._id,
      tokenHash,
      createdBy: ac.user._id,
      expiresAt: now() + 24 * 3600_000,
      createdAt: now(),
    });
    return { token: raw };
  },
});

async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Exchange a one-time token for the org's export bundle. */
export const consumeExportToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await hashToken(args.token.trim());
    const rows = await ctx.db.query("saasExports").collect();
    const row = rows.find((r) => r.tokenHash === tokenHash);
    if (!row) throw new Error("Export link not recognised.");
    if (row.usedAt) throw new Error("This export link has already been used.");
    if (now() > row.expiresAt) throw new Error("This export link has expired.");
    await ctx.db.patch(row._id, { usedAt: now() });

    const org = await ctx.db.get(row.orgId);
    if (!org) throw new Error("Organization not found.");

    const clients = await ctx.db
      .query("clients")
      .filter((q) => q.eq(q.field("orgId"), row.orgId))
      .collect();
    const matters = await ctx.db
      .query("matters")
      .filter((q) => q.eq(q.field("orgId"), row.orgId))
      .collect();
    const sub = await getSubForOrg(ctx, row.orgId);
    const plan = sub ? await ctx.db.get(sub.planId) : null;

    return {
      exportedAt: now(),
      organization: {
        name: org.name,
        kind: org.kind,
        addressLine1: org.addressLine1 ?? null,
        city: org.city ?? null,
        createdAt: org.createdAt,
      },
      subscription: sub
        ? {
            status: sub.status,
            plan: plan?.name ?? null,
            currentPeriodEnd: sub.currentPeriodEnd,
            endedAt: sub.endedAt ?? null,
          }
        : null,
      clients: clients.map((c) => ({
        name: c.name,
        kind: c.kind,
        email: c.email ?? null,
        phone: c.phone ?? null,
        archivedAt: c.archivedAt ?? null,
        createdAt: c.createdAt,
      })),
      matters: matters.map((m) => ({
        reference: m.reference,
        title: m.title,
        status: m.status,
        practiceArea: m.practiceArea,
        court: m.court ?? null,
        caseNumber: m.caseNumber ?? null,
        createdAt: m.createdAt,
      })),
      note:
        "This bundle covers the client and matter registers. Document files, notes and communications remain available for download inside the read-only chamber.",
    };
  },
});
