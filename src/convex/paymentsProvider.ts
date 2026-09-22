"use node";

// ===============================================================
// Razorpay provider bridge — runs in the Node runtime.
//
// Creating payment links, verifying webhook signatures and issuing
// refunds need Node APIs (the SDK and its crypto). Every state change
// is proxied through internal mutations in billing.ts so invoice data
// only ever changes inside Convex transactions.
//
// Security model: a webhook is reconciled ONLY after its HMAC-SHA256
// signature verifies against RAZORPAY_WEBHOOK_SECRET. Opening a
// payment link or scanning a QR never marks an invoice paid.
// ===============================================================

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import crypto from "crypto";

const API = "https://api.razorpay.com/v1";

function creds(): { keyId: string; keySecret: string } | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

async function rz(path: string, method: "GET" | "POST", body?: unknown) {
  const c = creds();
  if (!c) throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set.");
  const auth = Buffer.from(`${c.keyId}:${c.keySecret}`).toString("base64");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown> & {
    error?: { description?: string };
  };
  if (!res.ok) {
    throw new Error(
      `Razorpay ${path} failed (${res.status}): ${json.error?.description ?? "unknown error"}`,
    );
  }
  return json;
}

// -----------------------------------------------------------------
// Webhook signature verification + reconciliation
// -----------------------------------------------------------------

export const verifyAndReconcileWebhook = internalAction({
  args: {
    rawBody: v.string(),
    signature: v.string(),
  },
  handler: async (_ctx, args) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      return { ok: false, status: 503, body: "Webhook secret not configured." };
    }
    const expected = crypto
      .createHmac("sha256", secret)
      .update(args.rawBody)
      .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(args.signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, status: 400, body: "Invalid signature." };
    }

    let event: {
      event?: string;
      id?: string;
      payload?: {
        payment?: { entity?: Record<string, unknown> };
        payment_link?: { entity?: Record<string, unknown> };
      };
    };
    try {
      event = JSON.parse(args.rawBody);
    } catch {
      return { ok: false, status: 400, body: "Invalid JSON." };
    }

    const eventType = event.event ?? "unknown";
    const eventId = event.id ?? `sig-${expected.slice(0, 24)}`;
    const payment = event.payload?.payment?.entity;
    const link = event.payload?.payment_link?.entity;

    const providerPaymentId =
      payment && typeof payment.id === "string" ? payment.id : "";
    const providerOrderId =
      payment && typeof payment.order_id === "string" ? payment.order_id : undefined;
    const paymentLinkId =
      (link && typeof link.id === "string" ? link.id : undefined) ??
      (payment && typeof payment.payment_link === "string"
        ? payment.payment_link
        : undefined);
    const referenceId =
      (link && typeof link.reference_id === "string" ? link.reference_id : undefined) ??
      (payment && typeof payment.notes === "object" && payment.notes !== null
        ? ((payment.notes as Record<string, unknown>).number as string | undefined)
        : undefined);
    // SaaS subscription payments (section 24) ride the same verified
    // webhook but reconcile in subscriptions.ts — never into the
    // lawyers' client-invoice ledger.
    const notes: Record<string, unknown> | undefined =
      (payment && typeof payment.notes === "object" && payment.notes !== null
        ? (payment.notes as Record<string, unknown>)
        : undefined) ??
      (link && typeof link.notes === "object" && link.notes !== null
        ? (link.notes as Record<string, unknown>)
        : undefined);
    const isSaasPayment = notes?.kind === "saas";
    const amountMinor =
      payment && typeof payment.amount === "number"
        ? payment.amount
        : link && typeof link.amount === "number"
          ? link.amount
          : 0;

    // Only success-ish events reconcile money; everything else is logged.
    const reconciles =
      eventType === "payment.captured" ||
      eventType === "payment_link.paid" ||
      eventType === "order.paid";

    if (isSaasPayment) {
      if (reconciles && providerPaymentId) {
        await _ctx.runMutation(internal.subscriptions.reconcileSaasPaymentInternal, {
          eventId,
          eventType,
          payloadJson: args.rawBody,
          paymentLinkId,
          providerPaymentId,
          amountMinor,
        });
      } else {
        await _ctx.runMutation(internal.subscriptions.recordSaasEventInternal, {
          eventId,
          eventType,
          payloadJson: args.rawBody,
          note: `Received (no reconciliation) — ${eventType}`,
        });
      }
      return { ok: true, status: 200, body: "OK" };
    }

    if (reconciles && providerPaymentId) {
      await _ctx.runMutation(internal.billing.reconcileWebhookInternal, {
        eventId,
        eventType,
        payloadJson: args.rawBody,
        providerPaymentId,
        providerOrderId,
        paymentLinkId,
        referenceId,
        amountMinor,
      });
    } else {
      // Record the event so the audit shows we received it (idempotent).
      await _ctx.runMutation(internal.billing.reconcileWebhookInternal, {
        eventId,
        eventType,
        payloadJson: args.rawBody,
        providerPaymentId: providerPaymentId || "n/a",
        providerOrderId,
        paymentLinkId,
        referenceId,
        amountMinor: 0,
      });
    }

    return { ok: true, status: 200, body: "OK" };
  },
});

// -----------------------------------------------------------------
// Payment link creation (invoice + consultation)
// -----------------------------------------------------------------

export const createInvoicePaymentLink = internalAction({
  args: {
    invoiceNumber: v.string(),
    amountMinor: v.number(),
    clientName: v.string(),
    clientEmail: v.optional(v.string()),
    clientPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const body = await rz("/payment_links", "POST", {
      amount: args.amountMinor,
      currency: "INR",
      accept_partial: false,
      reference_id: args.invoiceNumber,
      description: `Invoice ${args.invoiceNumber}`,
      customer: {
        name: args.clientName,
        email: args.clientEmail,
        contact: args.clientPhone,
      },
      notify: { sms: false, email: false },
      notes: { number: args.invoiceNumber },
      // UPI QR + every enabled checkout method come with the link.
    });
    const id = String(body.id);
    const shortUrl = typeof body.short_url === "string" ? body.short_url : "";
    await ctx.runMutation(internal.billing.attachPaymentLinkInternal, {
      invoiceNumber: args.invoiceNumber,
      paymentLinkId: id,
      paymentLinkUrl: shortUrl,
    });
    return { id, shortUrl };
  },
});

export const createConsultationPaymentLink = internalAction({
  args: {
    consultationId: v.id("consultations"),
    clientName: v.string(),
    clientEmail: v.optional(v.string()),
    clientPhone: v.optional(v.string()),
    amountMinor: v.number(),
  },
  handler: async (ctx, args) => {
    const referenceId = `consult-${Date.now()}`;
    const body = await rz("/payment_links", "POST", {
      amount: args.amountMinor,
      currency: "INR",
      accept_partial: false,
      reference_id: referenceId,
      description: `Consultation — ${args.clientName}`,
      customer: {
        name: args.clientName,
        email: args.clientEmail,
        contact: args.clientPhone,
      },
      notify: { sms: false, email: false },
      notes: { kind: "consultation", reference: referenceId },
    });
    const id = String(body.id);
    const shortUrl = typeof body.short_url === "string" ? body.short_url : "";
    await ctx.runMutation(internal.billing.attachConsultationLinkInternal, {
      consultationId: args.consultationId,
      paymentLinkId: id,
      paymentLinkUrl: shortUrl,
    });
    return { id, shortUrl, referenceId };
  },
});

/**
 * Public checkout entry: verifies a signed-in, billing-capable member
 * against the current subscription state BEFORE creating any payment
 * link, then creates it. Runs in the Node runtime so the client never
 * handles provider calls.
 */
type CheckoutPrecheck =
  | { allowed: false; reason: string }
  | { allowed: true; reuseUrl?: string }
  | {
      allowed: true;
      subscriptionId: string;
      orgName: string;
      planName: string;
      amountMinor: number;
      payerEmail?: string;
      payerName: string;
    };

export const startSubscriptionCheckout = action({
  args: {},
  handler: async (ctx): Promise<{ url: string; reused: boolean }> => {
    const pre = (await ctx.runQuery(
      internal.subscriptions.checkoutPrecheckInternal,
      {},
    )) as CheckoutPrecheck;
    if (!pre.allowed) {
      throw new Error(pre.reason ?? "Checkout is not available right now.");
    }
    if ("reuseUrl" in pre && pre.reuseUrl) {
      return { url: pre.reuseUrl, reused: true };
    }
    const body = await rz("/payment_links", "POST", {
      amount: pre.amountMinor,
      currency: "INR",
      accept_partial: false,
      reference_id: `sub-${pre.subscriptionId.slice(-8)}`,
      description: `Advokate subscription — ${pre.planName} (${pre.orgName})`,
      customer: {
        name: pre.payerName,
        email: pre.payerEmail,
      },
      notify: { sms: false, email: false },
      notes: { kind: "saas", subscriptionId: pre.subscriptionId },
    });
    const id = String(body.id);
    const shortUrl = typeof body.short_url === "string" ? body.short_url : "";
    await ctx.runMutation(internal.subscriptions.attachPaymentLinkInternal, {
      subscriptionId: pre.subscriptionId,
      paymentLinkId: id,
      paymentLinkUrl: shortUrl,
    });
    return { url: shortUrl, reused: false };
  },
});

/** Payment link for a SaaS subscription period (section 24). */
export const createSubscriptionPaymentLink = internalAction({
  args: {
    subscriptionId: v.id("subscriptions"),
    orgName: v.string(),
    planName: v.string(),
    amountMinor: v.number(),
    payerEmail: v.optional(v.string()),
    payerName: v.string(),
  },
  handler: async (ctx, args) => {
    const referenceId = `sub-${args.subscriptionId.slice(-8)}-${Date.now()}`;
    const body = await rz("/payment_links", "POST", {
      amount: args.amountMinor,
      currency: "INR",
      accept_partial: false,
      reference_id: referenceId,
      description: `Advokate subscription — ${args.planName} (${args.orgName})`,
      customer: {
        name: args.payerName,
        email: args.payerEmail,
      },
      notify: { sms: false, email: false },
      notes: { kind: "saas", subscriptionId: args.subscriptionId },
    });
    const id = String(body.id);
    const shortUrl = typeof body.short_url === "string" ? body.short_url : "";
    await ctx.runMutation(internal.subscriptions.attachPaymentLinkInternal, {
      subscriptionId: args.subscriptionId,
      paymentLinkId: id,
      paymentLinkUrl: shortUrl,
    });
    return { id, shortUrl, referenceId };
  },
});

/** Payment link for a promotion purchase (section 23). */
export const createPromotionPaymentLink = internalAction({
  args: {
    promotionId: v.id("promotions"),
    orgId: v.id("organizations"),
    packageName: v.string(),
    amountMinor: v.number(),
    payerEmail: v.optional(v.string()),
    payerName: v.string(),
    orgName: v.string(),
  },
  handler: async (ctx, args) => {
    const referenceId = `promo-${args.promotionId.slice(-8)}-${Date.now()}`;
    const body = await rz("/payment_links", "POST", {
      amount: args.amountMinor,
      currency: "INR",
      accept_partial: false,
      reference_id: referenceId,
      description: `${args.packageName} — ${args.orgName}`,
      customer: {
        name: args.payerName,
        email: args.payerEmail,
      },
      notify: { sms: false, email: false },
      notes: { kind: "promotion", promotionId: args.promotionId },
    });
    const id = String(body.id);
    const shortUrl = typeof body.short_url === "string" ? body.short_url : "";
    await ctx.runMutation(internal.promotions.attachPaymentLinkInternal, {
      promotionId: args.promotionId,
      paymentLinkId: id,
      paymentLinkUrl: shortUrl,
    });
    return { id, shortUrl, referenceId };
  },
});

// -----------------------------------------------------------------
// Refunds
// -----------------------------------------------------------------

export const refundPayment = internalAction({
  args: {
    paymentRowId: v.id("payments"),
    providerPaymentId: v.string(),
    amountMinor: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const body = await rz(
      `/payments/${args.providerPaymentId}/refund`,
      "POST",
      {
        amount: args.amountMinor,
        speed: "normal",
        notes: args.reason ? { reason: args.reason.slice(0, 200) } : undefined,
      },
    );
    const refundId = String(body.id);
    await ctx.runMutation(internal.billing.attachRefundInternal, {
      paymentRowId: args.paymentRowId,
      refundId,
    });
    return { refundId };
  },
});
