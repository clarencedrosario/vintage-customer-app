import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { FunctionReference } from "convex/server";
import crypto from "node:crypto";

// Typed locally so the file compiles regardless of how fresh the
// generated api snapshot is; runtime resolution is live either way.
const requestRefundRef = (
  internal.billing as unknown as {
    requestRefund: FunctionReference<
      "mutation",
      "internal",
      { paymentRowId: string; amountMinor: number; reason?: string }
    >;
  }
).requestRefund;

const modules: Record<string, () => Promise<unknown>> = (import.meta as unknown as {
  glob: (p: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.ts");

const asUser = (t: ReturnType<typeof convexTest>, userId: string) =>
  t.withIdentity({ subject: userId, tokenIdentifier: `test:${userId}` });

const WEBHOOK_SECRET = "whsec_test_12345";

function signedBody(payload: unknown): { raw: string; signature: string } {
  const raw = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(raw)
    .digest("hex");
  return { raw, signature };
}

async function seedBillingOrg(t: ReturnType<typeof convexTest>) {
  const userId = await asUser(t, "system").run(async (ctx) =>
    ctx.db.insert("users", {
      email: "billing-owner@synthetic.test",
      emailVerified: true,
      isAnonymous: false,
      isPlatformAdmin: false,
    }),
  );
  const { orgId, clientId, matterId, invoiceId } = await asUser(t, "system").run(
    async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Webhook Chamber (synthetic)",
        slug: "webhook-firm",
        kind: "chamber",
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
      const clientId = await ctx.db.insert("clients", {
        orgId,
        kind: "individual",
        name: "Synthetic Webhook Client",
        createdBy: userId,
        createdAt: Date.now(),
      });
      const matterId = await ctx.db.insert("matters", {
        orgId,
        clientId,
        reference: "WH/2026/0001",
        title: "Webhook test matter",
        practiceArea: "criminal",
        status: "open",
        createdBy: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // A sent invoice with nothing paid: ₹500.00 outstanding.
      const invoiceId = await ctx.db.insert("invoices", {
        orgId,
        number: "WH/2026/0001",
        matterId,
        clientId,
        status: "sent",
        subtotalMinor: 50_000,
        taxModel: "none",
        totalMinor: 50_000,
        amountPaidMinor: 0,
        issuedOn: "2026-09-29",
        createdBy: userId,
        createdAt: Date.now(),
      });
      return { orgId, clientId, matterId, invoiceId };
    },
  );
  return { userId, orgId, clientId, matterId, invoiceId };
}

/** Seed the minimal billing-critical chart so journals actually post. */
async function seedChart(
  t: ReturnType<typeof convexTest>,
  orgId: string,
) {
  await t.run(async (ctx) => {
    for (const a of [
      { code: "1000", name: "Bank — Operating", type: "asset" as const, subtype: "bank" },
      { code: "1100", name: "Accounts Receivable", type: "asset" as const, subtype: "receivable" },
      { code: "2400", name: "Unapplied Customer Credits", type: "liability" as const, subtype: "credits" },
    ]) {
      await ctx.db.insert("accounts", {
        orgId,
        ...a,
        active: true,
        createdAt: Date.now(),
      });
    }
  });
}

function capturedEvent(opts: {
  eventId: string;
  paymentId: string;
  amountMinor: number;
  invoiceNumber?: string;
  saas?: boolean;
  linkId?: string;
}) {
  const notes = opts.saas
    ? { kind: "saas", subscriptionId: "sub_synthetic_1" }
    : { number: opts.invoiceNumber ?? "WH/2026/0001" };
  return {
    event: opts.saas ? "payment_link.paid" : "payment.captured",
    id: opts.eventId,
    payload: {
      payment: {
        entity: {
          id: opts.paymentId,
          amount: opts.amountMinor,
          notes,
          payment_link: opts.linkId,
        },
      },
      payment_link: opts.linkId
        ? { entity: { id: opts.linkId, reference_id: opts.invoiceNumber } }
        : undefined,
    },
  };
}

/** A richer success event with order id, currency and method. */
function successEvent(opts: {
  eventId: string;
  eventType: string;
  paymentId: string;
  amountMinor: number;
  invoiceNumber?: string;
  linkId?: string;
  orderId?: string;
  currency?: string;
  method?: string;
  saas?: boolean;
}) {
  const notes = opts.saas
    ? { kind: "saas", subscriptionId: "sub_synthetic_1" }
    : opts.invoiceNumber
      ? { number: opts.invoiceNumber }
      : undefined;
  return {
    event: opts.eventType,
    id: opts.eventId,
    payload: {
      payment: {
        entity: {
          id: opts.paymentId,
          amount: opts.amountMinor,
          currency: opts.currency,
          method: opts.method,
          order_id: opts.orderId,
          notes,
          payment_link: opts.linkId,
        },
      },
      payment_link: opts.linkId
        ? { entity: { id: opts.linkId, reference_id: opts.invoiceNumber } }
        : undefined,
    },
  };
}

async function deliver(
  t: ReturnType<typeof convexTest>,
  payload: unknown,
): Promise<{ ok: boolean; status: number }> {
  const { raw, signature } = signedBody(payload);
  return t.action(internal.paymentsProvider.verifyAndReconcileWebhook, {
    rawBody: raw,
    signature,
  });
}

describe("Razorpay webhook pipeline (signature-verified reconciliation)", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  afterAll(() => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  it("rejects an invalid signature before touching any state", async () => {
    await seedBillingOrg(t);
    const { raw } = signedBody(capturedEvent({ eventId: "evt_bad", paymentId: "pay_bad", amountMinor: 10_000 }));
    const result = await t.action(internal.paymentsProvider.verifyAndReconcileWebhook, {
        rawBody: raw,
        signature: "0".repeat(64),
      });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    const events = await asUser(t, "system").run((ctx) =>
      ctx.db.query("paymentEvents").collect(),
    );
    expect(events).toHaveLength(0);
  });

  it("reports honestly when the webhook secret is not configured", async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const { raw, signature } = signedBody({ event: "payment.captured" });
    const result = await t.action(internal.paymentsProvider.verifyAndReconcileWebhook, {
        rawBody: raw,
        signature,
      });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it("reconciles a captured payment into the invoice, payments ledger and event log", async () => {
    const { invoiceId } = await seedBillingOrg(t);
    const result = await deliver(
      t,
      successEvent({
        eventId: "evt_ok1",
        eventType: "payment.captured",
        paymentId: "pay_ok1",
        amountMinor: 30_000,
        invoiceNumber: "WH/2026/0001",
        currency: "INR",
        method: "upi",
      }),
    );
    expect(result.ok).toBe(true);

    const invoice = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
    expect(invoice!.amountPaidMinor).toBe(30_000);
    expect(invoice!.status).toBe("partially_paid");

    const payments = await asUser(t, "system").run((ctx) =>
      ctx.db.query("payments").collect(),
    );
    expect(payments).toHaveLength(1);
    expect(payments[0]!.source).toBe("razorpay");
    expect(payments[0]!.reference).toBe("pay_ok1");
    // The provider's actual method and currency are recorded, not assumed.
    expect(payments[0]!.mode).toBe("upi");
    expect(payments[0]!.currency).toBe("INR");

    const events = await asUser(t, "system").run((ctx) =>
      ctx.db.query("paymentEvents").collect(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.handled).toBe(true);
  });

  it("is idempotent on provider redelivery of the same event id", async () => {
    const { invoiceId } = await seedBillingOrg(t);
    const first = await deliver(
      t,
      capturedEvent({ eventId: "evt_dup", paymentId: "pay_dup", amountMinor: 50_000 }),
    );
    expect(first.ok).toBe(true);
    const second = await deliver(
      t,
      capturedEvent({ eventId: "evt_dup", paymentId: "pay_dup", amountMinor: 50_000 }),
    );
    expect(second.ok).toBe(true);

    const invoice = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
    expect(invoice!.amountPaidMinor).toBe(50_000); // not 100_000
    expect(invoice!.status).toBe("paid");
    const payments = await asUser(t, "system").run((ctx) =>
      ctx.db.query("payments").collect(),
    );
    expect(payments).toHaveLength(1);
  });

  it("deduplicates three distinct event types naming the SAME payment", async () => {
    const { invoiceId } = await seedBillingOrg(t);
    await seedChart(t, (await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId)))!.orgId);

    const first = await deliver(
      t,
      capturedEvent({ eventId: "evt_cap", paymentId: "pay_one", amountMinor: 30_000 }),
    );
    expect(first.ok).toBe(true);

    // The same underlying payment announced by the other two event types.
    const second = await deliver(
      t,
      successEvent({
        eventId: "evt_link",
        eventType: "payment_link.paid",
        paymentId: "pay_one",
        amountMinor: 30_000,
        invoiceNumber: "WH/2026/0001",
        linkId: "link_one",
      }),
    );
    expect(second.ok).toBe(true);

    const third = await deliver(
      t,
      successEvent({
        eventId: "evt_order",
        eventType: "order.paid",
        paymentId: "pay_one",
        amountMinor: 30_000,
        invoiceNumber: "WH/2026/0001",
        linkId: "link_one",
        orderId: "order_one",
      }),
    );
    expect(third.ok).toBe(true);

    // Exactly one payment record, one allocation, one journal.
    const invoice = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
    expect(invoice!.amountPaidMinor).toBe(30_000);
    expect(invoice!.status).toBe("partially_paid");

    const payments = await asUser(t, "system").run((ctx) =>
      ctx.db.query("payments").collect(),
    );
    expect(payments).toHaveLength(1);

    const journals = await asUser(t, "system").run(async (ctx) =>
      (await ctx.db.query("journalEntries").collect()).filter(
        (j) => j.dedupeKey?.includes("payment_received"),
      ),
    );
    expect(journals).toHaveLength(1);

    // Every event is still visible in the audit log.
    const events = await asUser(t, "system").run((ctx) =>
      ctx.db.query("paymentEvents").collect(),
    );
    expect(events).toHaveLength(3);
  });

  it("applies exactly once regardless of event arrival order", async () => {
    const { invoiceId } = await seedBillingOrg(t);

    // order.paid-style event (with link) arrives FIRST…
    const first = await deliver(
      t,
      successEvent({
        eventId: "evt_ooo1",
        eventType: "payment_link.paid",
        paymentId: "pay_ooo",
        amountMinor: 50_000,
        invoiceNumber: "WH/2026/0001",
        linkId: "link_ooo",
        orderId: "order_ooo",
      }),
    );
    expect(first.ok).toBe(true);

    // …and payment.captured for the same payment arrives afterwards
    // (link notes propagate to the payment in real Razorpay payloads).
    const second = await deliver(
      t,
      successEvent({
        eventId: "evt_ooo2",
        eventType: "payment.captured",
        paymentId: "pay_ooo",
        amountMinor: 50_000,
        invoiceNumber: "WH/2026/0001",
      }),
    );
    expect(second.ok).toBe(true);

    const invoice = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
    expect(invoice!.amountPaidMinor).toBe(50_000);
    expect(invoice!.status).toBe("paid");

    const payments = await asUser(t, "system").run((ctx) =>
      ctx.db.query("payments").collect(),
    );
    expect(payments).toHaveLength(1);

    const events = await asUser(t, "system").run((ctx) =>
      ctx.db.query("paymentEvents").collect(),
    );
    expect(events).toHaveLength(2);
  });

  it("does not let a valid signature authorize an arbitrary invoice reference", async () => {
    const { invoiceId } = await seedBillingOrg(t);

    // A legitimately-linked payment is fine (the invoice has no stored
    // link yet, so the reference number is the only association).
    const ok = await deliver(
      t,
      successEvent({
        eventId: "evt_assoc1",
        eventType: "payment.captured",
        paymentId: "pay_assoc",
        amountMinor: 10_000,
        invoiceNumber: "WH/2026/0001",
      }),
    );
    expect(ok.ok).toBe(true);

    // Now the invoice records WHICH link it created. A later event naming
    // the same invoice but a DIFFERENT link id must not move money.
    await asUser(t, "system").run(async (ctx) => {
      await ctx.db.patch(invoiceId, { paymentLinkId: "link_created_by_us" });
    });
    const tampered = await deliver(
      t,
      successEvent({
        eventId: "evt_assoc2",
        eventType: "payment_link.paid",
        paymentId: "pay_attacker",
        amountMinor: 40_000,
        invoiceNumber: "WH/2026/0001",
        linkId: "link_attacker",
      }),
    );
    expect(tampered.ok).toBe(true);

    const invoice = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
    expect(invoice!.amountPaidMinor).toBe(10_000); // unchanged

    const payments = await asUser(t, "system").run((ctx) =>
      ctx.db.query("payments").collect(),
    );
    expect(payments).toHaveLength(1);
  });

  it("refuses to apply money in a currency the organization does not bill in", async () => {
    const { invoiceId } = await seedBillingOrg(t);
    const result = await deliver(
      t,
      successEvent({
        eventId: "evt_usd",
        eventType: "payment.captured",
        paymentId: "pay_usd",
        amountMinor: 30_000,
        invoiceNumber: "WH/2026/0001",
        currency: "USD",
      }),
    );
    expect(result.ok).toBe(true);

    const invoice = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
    expect(invoice!.amountPaidMinor).toBe(0);
    const payments = await asUser(t, "system").run((ctx) =>
      ctx.db.query("payments").collect(),
    );
    expect(payments).toHaveLength(0);
  });

  it("caps the invoice allocation but RECORDS the excess as a tracked customer credit", async () => {
    const { invoiceId } = await seedBillingOrg(t);
    await seedChart(t, (await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId)))!.orgId);

    const result = await deliver(
      t,
      capturedEvent({ eventId: "evt_cap", paymentId: "pay_cap", amountMinor: 90_000 }),
    );
    expect(result.ok).toBe(true);

    const invoice = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
    expect(invoice!.amountPaidMinor).toBe(50_000);
    expect(invoice!.status).toBe("paid");

    // The payment row records the amount actually applied to the invoice;
    // the excess beyond the balance is its own tracked credit row.
    const payments = await asUser(t, "system").run((ctx) =>
      ctx.db.query("payments").collect(),
    );
    expect(payments).toHaveLength(1);
    expect(payments[0]!.amountMinor).toBe(50_000);

    const credits = await asUser(t, "system").run((ctx) =>
      ctx.db.query("unappliedCredits").collect(),
    );
    expect(credits).toHaveLength(1);
    expect(credits[0]!.amountMinor).toBe(40_000);
    expect(credits[0]!.status).toBe("excess_received");
    expect(credits[0]!.providerPaymentId).toBe("pay_cap");

    // The held excess is a liability posting (bank Dr / credits Cr) — the
    // customer's money is on the books, never discarded.
    const excessJournals = await asUser(t, "system").run(async (ctx) =>
      (await ctx.db.query("journalEntries").collect()).filter((j) =>
        j.dedupeKey?.includes("excess_held"),
      ),
    );
    expect(excessJournals).toHaveLength(1);

    // The audit trail names the credit explicitly.
    expect(
      (invoice!.audit ?? []).some((a: { text: string }) =>
        a.text.includes("unapplied customer credit"),
      ),
    ).toBe(true);

    // A further event for a DIFFERENT payment after full settlement is
    // recorded as a full unapplied credit — still never discarded.
    const again = await deliver(
      t,
      capturedEvent({ eventId: "evt_cap2", paymentId: "pay_cap2", amountMinor: 10_000 }),
    );
    expect(again.ok).toBe(true);
    const invoice2 = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
    expect(invoice2!.amountPaidMinor).toBe(50_000);
    const credits2 = await asUser(t, "system").run((ctx) =>
      ctx.db.query("unappliedCredits").collect(),
    );
    expect(credits2).toHaveLength(2);
    expect(credits2[1]!.amountMinor).toBe(10_000);
  });

  it("routes SaaS subscription payments away from the client-invoice ledger", async () => {
    const { invoiceId } = await seedBillingOrg(t);
    const result = await deliver(
      t,
      capturedEvent({
        eventId: "evt_saas1",
        paymentId: "pay_saas1",
        amountMinor: 99_000,
        saas: true,
        linkId: "link_saas1",
      }),
    );
    expect(result.ok).toBe(true);

    // No invoice money moved.
    const invoice = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
    expect(invoice!.amountPaidMinor).toBe(0);

    // The event is recorded in the SaaS event log (no matching
    // subscription exists in this synthetic deployment → honest no-target).
    const saas = await asUser(t, "system").run((ctx) =>
      ctx.db.query("saasPaymentEvents").collect(),
    );
    expect(saas).toHaveLength(1);
    expect(saas[0]!.eventId).toBe("evt_saas1");
    expect(saas[0]!.note).toMatch(/No matching subscription/);
  });

  it("renews a SaaS subscription exactly once across the three event types", async () => {
    // A real subscription row so the SaaS path has a target.
    const subId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "saas-owner@synthetic.test",
        emailVerified: true,
        isAnonymous: false,
        isPlatformAdmin: false,
      });
      const planId = await ctx.db.insert("saasPlans", {
        code: "firm_pro",
        name: "Firm Pro",
        kind: "firm",
        priceMinor: 199_000,
        interval: "monthly",
        active: true,
        createdAt: Date.now(),
      });
      const orgId = await ctx.db.insert("organizations", {
        name: "SaaS Chamber (synthetic)",
        slug: "saas-firm",
        kind: "chamber",
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
      return ctx.db.insert("subscriptions", {
        orgId,
        planId,
        status: "read_only",
        interval: "monthly",
        currentPeriodEnd: 0,
        paymentLinkId: "link_saas_x",
        paymentLinkIdConsumed: false,
        createdAt: Date.now(),
      });
    });

    const kinds = [
      { eventId: "evt_saas_cap", eventType: "payment.captured" },
      { eventId: "evt_saas_link", eventType: "payment_link.paid" },
      { eventId: "evt_saas_order", eventType: "order.paid" },
    ];
    for (const k of kinds) {
      const r = await deliver(
        t,
        successEvent({
          eventId: k.eventId,
          eventType: k.eventType,
          paymentId: "pay_saas_x",
          amountMinor: 199_000,
          linkId: "link_saas_x",
          saas: true,
        }),
      );
      expect(r.ok).toBe(true);
    }

    const invoices = await asUser(t, "system").run((ctx) =>
      ctx.db.query("subscriptionInvoices").collect(),
    );
    expect(invoices).toHaveLength(1); // one renewal, not three

    const sub = await asUser(t, "system").run((ctx) => ctx.db.get(subId));
    expect(sub!.status).toBe("active");
    const periodAfterFirst = invoices[0]!.periodEnd;
    expect(sub!.currentPeriodEnd).toBe(periodAfterFirst); // not extended thrice

    const saas = await asUser(t, "system").run((ctx) =>
      ctx.db.query("saasPaymentEvents").collect(),
    );
    expect(saas).toHaveLength(3);
  });

  it("logs non-money events (payment.failed) without touching invoice state", async () => {
    const { invoiceId } = await seedBillingOrg(t);
    const result = await deliver(
      t,
      successEvent({
        eventId: "evt_failed",
        eventType: "payment.failed",
        paymentId: "pay_failed",
        amountMinor: 30_000,
        invoiceNumber: "WH/2026/0001",
      }),
    );
    expect(result.ok).toBe(true);

    const invoice = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
    expect(invoice!.amountPaidMinor).toBe(0);
    const payments = await asUser(t, "system").run((ctx) =>
      ctx.db.query("payments").collect(),
    );
    expect(payments).toHaveLength(0);
    const events = await asUser(t, "system").run((ctx) =>
      ctx.db.query("paymentEvents").collect(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("payment.failed");
    expect(events[0]!.note).toContain("no reconciliation");
  });
});

describe("Refund lifecycle (requested → processed | failed)", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    // The refund request gate checks that the provider is configured;
    // the HTTP call itself is mocked below.
    process.env.RAZORPAY_KEY_ID = "rzp_test_mock";
    process.env.RAZORPAY_KEY_SECRET = "mock_secret";
  });

  afterAll(() => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    vi.unstubAllGlobals();
  });

  it("moves money and books only when the provider confirms; failures move nothing", async () => {
    const { userId, orgId, invoiceId } = await seedBillingOrg(t);
    await seedChart(t, (await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId)))!.orgId);
    // requestRefund resolves the org through the user's activeOrgId.
    await asUser(t, "system").run(async (ctx) => {
      await ctx.db.patch(userId as never, { activeOrgId: orgId });
    });
    await deliver(
      t,
      capturedEvent({ eventId: "evt_rf1", paymentId: "pay_rf", amountMinor: 50_000 }),
    );
    const paymentRow = (
      await asUser(t, "system").run((ctx) => ctx.db.query("payments").collect())
    )[0]!;

    // Mock the provider HTTP call: Razorpay accepts the refund.
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "rfnd_mock_1", status: "processed" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    try {
      // 1. Partial refund request — state is "requested" BEFORE the call.
      const { refundRequestId } = await asUser(t, userId).mutation(
        requestRefundRef,
        { paymentRowId: paymentRow._id, amountMinor: 20_000, reason: "partial service credit" },
      );
      let req = (
        await asUser(t, "system").run((ctx) => ctx.db.query("refundRequests").collect())
      )[0]!;
      expect(req.status).toBe("requested");
      const paymentMid = await asUser(t, "system").run((ctx) => ctx.db.get(paymentRow._id));
      expect(paymentMid!.status).toBe("refund_pending");

      // 2. The scheduled provider call confirms → books move.
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      req = (await asUser(t, "system").run((ctx) => ctx.db.get(refundRequestId)))!;
      expect(req.status).toBe("processed");
      expect(req.providerRefundId).toBe("rfnd_mock_1");

      const payment1 = await asUser(t, "system").run((ctx) => ctx.db.get(paymentRow._id));
      expect(payment1!.status).toBe("partially_refunded");
      expect(payment1!.refundedMinor).toBe(20_000);
      const invoice1 = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
      expect(invoice1!.amountPaidMinor).toBe(30_000);
      expect(invoice1!.status).toBe("partially_paid");
      const refundJournals1 = await asUser(t, "system").run(async (ctx) =>
        (await ctx.db.query("journalEntries").collect()).filter((j) =>
          j.dedupeKey?.includes("refund:"),
        ),
      );
      expect(refundJournals1).toHaveLength(1);

      // 3. Second partial refund completes it.
      await asUser(t, userId).mutation(requestRefundRef, {
        paymentRowId: paymentRow._id,
        amountMinor: 20_000,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const payment2 = await asUser(t, "system").run((ctx) => ctx.db.get(paymentRow._id));
      // 40_000 of the 50_000 payment refunded → still partially refunded.
      expect(payment2!.status).toBe("partially_refunded");
      expect(payment2!.refundedMinor).toBe(40_000);
      const invoice2 = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
      expect(invoice2!.amountPaidMinor).toBe(10_000);
      expect(invoice2!.status).toBe("partially_paid");

      // 4. Retrying beyond the refundable remainder is refused.
      await expect(
        asUser(t, userId).mutation(requestRefundRef, {
          paymentRowId: paymentRow._id,
          amountMinor: 20_000,
        }),
      ).rejects.toThrow(/Refund must be between/);

      const refundJournals = await asUser(t, "system").run(async (ctx) =>
        (await ctx.db.query("journalEntries").collect()).filter((j) =>
          j.dedupeKey?.includes("refund:"),
        ),
      );
      expect(refundJournals).toHaveLength(2); // one per processed refund
    } finally {
      vi.unstubAllGlobals();
    }

    // 5. A provider rejection (fetch fails) records "failed" and moves
    //    nothing — requested ≠ processed.
    const fetchFail = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchFail);
    try {
      await asUser(t, userId).mutation(requestRefundRef, {
        paymentRowId: paymentRow._id,
        amountMinor: 10_000,
        reason: "should fail",
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const requests = await asUser(t, "system").run((ctx) =>
        ctx.db.query("refundRequests").collect(),
      );
      const failed = requests.find((r) => r.status === "failed");
      expect(failed).toBeDefined();
      expect(failed!.failureReason).toContain("network down");

      const paymentAfter = await asUser(t, "system").run((ctx) =>
        ctx.db.get(paymentRow._id),
      );
      expect(paymentAfter!.refundedMinor).toBe(40_000); // unchanged
      const invoiceAfter = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
      expect(invoiceAfter!.amountPaidMinor).toBe(10_000); // unchanged
      const refundJournals = await asUser(t, "system").run(async (ctx) =>
        (await ctx.db.query("journalEntries").collect()).filter((j) =>
          j.dedupeKey?.includes("refund:"),
        ),
      );
      expect(refundJournals).toHaveLength(2); // no journal for the failure
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
