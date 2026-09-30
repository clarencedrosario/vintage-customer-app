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
import {
  action,
  internalAction,
  internalMutation,
} from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import crypto from "crypto";

const API = "https://api.razorpay.com/v1";

/** CJ GLOBAL's platform account — ONLY for CJ GLOBAL's own revenue. */
function deploymentCreds(): { keyId: string; keySecret: string } | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret };
}

/**
 * Merchant credentials for a call. Firm-money flows pass an orgId and
 * use THE FIRM's connected account (encrypted at rest in orgMerchants);
 * platform-money flows (subscriptions, promotions) use the deployment
 * keys. Firm money can never flow through the platform account.
 */
async function credsFor(
  ctx: ActionCtx,
  orgId?: Id<"organizations">,
): Promise<{ keyId: string; keySecret: string; orgId?: Id<"organizations"> }> {
  if (orgId) {
    const firm = await ctx.runQuery(internal.orgMerchants.getCredentialInternal, {
      orgId,
    });
    if (!firm) {
      throw new Error(
        "This firm has no connected Razorpay merchant account. Connect it in Billing — the platform account never collects client money.",
      );
    }
    return { keyId: firm.keyId, keySecret: firm.keySecret, orgId };
  }
  const c = deploymentCreds();
  if (!c) throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set.");
  return c;
}

async function rz(
  auth: { keyId: string; keySecret: string },
  path: string,
  method: "GET" | "POST",
  body?: unknown,
) {
  const basic = Buffer.from(`${auth.keyId}:${auth.keySecret}`).toString("base64");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${basic}`,
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
    } | null = null;
    try {
      event = JSON.parse(args.rawBody);
    } catch {
      return { ok: false, status: 400, body: "Invalid JSON." };
    }
    try {
      event = JSON.parse(args.rawBody);
    } catch {
      return { ok: false, status: 400, body: "Invalid JSON." };
    }

    const eventType = event?.event ?? "unknown";
    const eventId = event?.id ?? `sig-${expected.slice(0, 24)}`;
    const payment = event?.payload?.payment?.entity;
    const link = event?.payload?.payment_link?.entity;

    // The provider's own currency and method travel with the payment —
    // the reconciler validates currency against the organization and
    // records the actual method instead of assuming UPI.
    const currency =
      payment && typeof payment.currency === "string" ? payment.currency : undefined;
    const method =
      payment && typeof payment.method === "string" && payment.method
        ? payment.method
        : undefined;
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

    // Only success-ish events reconcile money; everything else (including
    // refund.* and payment.failed) is logged in the audit trail and never
    // touches invoice state.
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
        currency,
        method,
      });
    } else {
      // Record the event so the audit shows we received it (idempotent);
      // non-money events never touch invoice state.
      await _ctx.runMutation(internal.billing.reconcileWebhookInternal, {
        eventId,
        eventType,
        payloadJson: args.rawBody,
        providerPaymentId: providerPaymentId || "n/a",
        providerOrderId,
        paymentLinkId,
        referenceId,
        amountMinor: 0,
        logOnly: true,
      });
    }

    return { ok: true, status: 200, body: "OK" };
  },
});

/**
 * Reconcile a FIRM-merchant webhook: the signature is checked against
 * the specific firm's own webhook secret (orgMerchants), and every
 * money event carries the orgId so reconciliation can enforce
 * tenant association server-side. The deployment webhook secret never
 * verifies a firm event.
 */
export const verifyAndReconcileFirmWebhook = internalAction({
  args: {
    rawBody: v.string(),
    signature: v.string(),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const cred = await ctx.runQuery(internal.orgMerchants.getCredentialInternal, {
      orgId: args.orgId,
    });
    if (!cred?.webhookSecret) {
      return {
        ok: false,
        status: 503,
        body: "Firm webhook secret not configured.",
      };
    }
    const expected = crypto
      .createHmac("sha256", cred.webhookSecret)
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
    } | null = null;
    try {
      event = JSON.parse(args.rawBody);
    } catch {
      return { ok: false, status: 400, body: "Invalid JSON." };
    }

    const eventType = event?.event ?? "unknown";
    const eventId = event?.id ?? `sig-${expected.slice(0, 24)}`;
    const payment = event?.payload?.payment?.entity;
    const link = event?.payload?.payment_link?.entity;

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
    const currency =
      payment && typeof payment.currency === "string" ? payment.currency : undefined;
    const method =
      payment && typeof payment.method === "string" && payment.method
        ? payment.method
        : undefined;

    const reconciles =
      eventType === "payment.captured" ||
      eventType === "payment_link.paid" ||
      eventType === "order.paid";

    // No SaaS routing here by construction: firm webhooks can never
    // touch CJ GLOBAL's subscription ledger — notes.kind is ignored.
    if (reconciles && providerPaymentId) {
      await ctx.runMutation(internal.billing.reconcileWebhookInternal, {
        eventId,
        eventType,
        payloadJson: args.rawBody,
        providerPaymentId,
        providerOrderId,
        paymentLinkId,
        referenceId,
        amountMinor: typeof payment?.amount === "number" ? payment.amount : 0,
        currency,
        method,
        orgId: args.orgId,
      });
    } else {
      await ctx.runMutation(internal.billing.reconcileWebhookInternal, {
        eventId,
        eventType,
        payloadJson: args.rawBody,
        providerPaymentId: providerPaymentId || "n/a",
        providerOrderId,
        paymentLinkId,
        referenceId,
        amountMinor: 0,
        orgId: args.orgId,
        logOnly: true,
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
    // Firm-money flow: ALWAYS the firm's own account. Omitted only by
    // platform-money callers (subscriptions/promotions), which use
    // dedicated actions.
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const auth = await credsFor(ctx, args.orgId);
    const body = await rz(auth, "/payment_links", "POST", {
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
      notes: {
        number: args.invoiceNumber,
        ...(args.orgId ? { orgId: args.orgId } : {}),
      },
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
    // Firm-money flow: ALWAYS the firm's own account.
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const referenceId = `consult-${Date.now()}`;
    const auth = await credsFor(ctx, args.orgId);
    const body = await rz(auth, "/payment_links", "POST", {
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
      notes: {
        kind: "consultation",
        reference: referenceId,
        ...(args.orgId ? { orgId: args.orgId } : {}),
      },
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
  | { allowed: true; kind: "reuse"; url: string }
  | {
      allowed: true;
      kind: "new";
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
    if (pre.kind === "reuse") {
      if (!pre.url) {
        throw new Error("Payment link could not be prepared. Please try again.");
      }
      return { url: pre.url, reused: true };
    }
    const body = await rz(deploymentCreds() ?? (() => { throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set."); })(), "/payment_links", "POST", {
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
      subscriptionId: pre.subscriptionId as Id<"subscriptions">,
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
    const auth = deploymentCreds();
    if (!auth) throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set.");
    const body = await rz(auth, "/payment_links", "POST", {
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
    // Platform revenue: the buying org pays CJ GLOBAL, so this uses the
    // DEPLOYMENT account on purpose — the orgId arg identifies the
    // buyer, not the merchant.
    const auth = deploymentCreds();
    if (!auth) throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set.");
    const body = await rz(auth, "/payment_links", "POST", {
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

/**
 * Issue a refund through Razorpay and classify the outcome.
 *
 * The refund state machine lives in billing.ts: a refundRequests row is
 * created as "requested" before this call and ONLY moves to "processed"
 * when Razorpay accepts (books move then), or to "failed" when it
 * rejects — nothing is ever applied on an unconfirmed attempt.
 */
export const refundPayment = internalAction({
  args: {
    paymentRowId: v.id("payments"),
    refundRequestId: v.optional(v.id("refundRequests")),
    providerPaymentId: v.string(),
    amountMinor: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Credential resolution sits INSIDE the try: a firm that has
    // disconnected (or was never connected) must produce an honestly
    // FAILED refund request — never a request stuck as "requested".
    try {
      const payment = await ctx.runQuery(internal.billing.getPaymentRowInternal, {
        paymentRowId: args.paymentRowId,
      });
      const auth = await credsFor(ctx, payment?.orgId);
      const body = await rz(
        auth,
        `/payments/${args.providerPaymentId}/refund`,
        "POST",
        {
          amount: args.amountMinor,
          speed: "normal",
          notes: args.reason ? { reason: args.reason.slice(0, 200) } : undefined,
        },
      );
      const refundId = String(body.id);
      const status = typeof body.status === "string" ? body.status : "processed";
      if (args.refundRequestId) {
        await ctx.runMutation(internal.billing.markRefundProcessedInternal, {
          refundRequestId: args.refundRequestId,
          refundId,
        });
      } else {
        // Legacy path (no state-machine request): record the id only.
        await ctx.runMutation(internal.billing.attachRefundInternal, {
          paymentRowId: args.paymentRowId,
          refundId,
        });
      }
      return { refundId, providerStatus: status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (args.refundRequestId) {
        await ctx.runMutation(internal.billing.markRefundFailedInternal, {
          refundRequestId: args.refundRequestId,
          reason: message,
        });
      }
      return { refundId: null, failed: true, error: message.slice(0, 300) };
    }
  },
});
