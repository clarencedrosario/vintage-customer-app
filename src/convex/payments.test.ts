import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import crypto from "node:crypto";

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
    const { raw, signature } = signedBody(
      capturedEvent({ eventId: "evt_ok1", paymentId: "pay_ok1", amountMinor: 30_000 }),
    );
    const result = await t.action(internal.paymentsProvider.verifyAndReconcileWebhook, {
        rawBody: raw,
        signature,
      });
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

    const events = await asUser(t, "system").run((ctx) =>
      ctx.db.query("paymentEvents").collect(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.handled).toBe(true);
  });

  it("is idempotent on provider redelivery of the same event id", async () => {
    const { invoiceId } = await seedBillingOrg(t);
    const { raw, signature } = signedBody(
      capturedEvent({ eventId: "evt_dup", paymentId: "pay_dup", amountMinor: 50_000 }),
    );
    const first = await t.action(internal.paymentsProvider.verifyAndReconcileWebhook, {
        rawBody: raw,
        signature,
      });
    expect(first.ok).toBe(true);
    const second = await t.action(internal.paymentsProvider.verifyAndReconcileWebhook, {
        rawBody: raw,
        signature,
      });
    expect(second.ok).toBe(true);

    const invoice = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
    expect(invoice!.amountPaidMinor).toBe(50_000); // not 100_000
    expect(invoice!.status).toBe("paid");
    const payments = await asUser(t, "system").run((ctx) =>
      ctx.db.query("payments").collect(),
    );
    expect(payments).toHaveLength(1);
  });

  it("caps an over-paying event at the outstanding balance", async () => {
    const { invoiceId } = await seedBillingOrg(t);
    const { raw, signature } = signedBody(
      capturedEvent({ eventId: "evt_cap", paymentId: "pay_cap", amountMinor: 90_000 }),
    );
    await t.action(internal.paymentsProvider.verifyAndReconcileWebhook, {
        rawBody: raw,
        signature,
      });
    const invoice = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
    expect(invoice!.amountPaidMinor).toBe(50_000);
    expect(invoice!.status).toBe("paid");

    // A second distinct event after full payment is ignored honestly.
    const again = signedBody(
      capturedEvent({ eventId: "evt_cap2", paymentId: "pay_cap2", amountMinor: 10_000 }),
    );
    await t.action(internal.paymentsProvider.verifyAndReconcileWebhook, {
        rawBody: again.raw,
        signature: again.signature,
      });
    const invoice2 = await asUser(t, "system").run((ctx) => ctx.db.get(invoiceId));
    expect(invoice2!.amountPaidMinor).toBe(50_000);
  });

  it("routes SaaS subscription payments away from the client-invoice ledger", async () => {
    const { invoiceId } = await seedBillingOrg(t);
    const { raw, signature } = signedBody(
      capturedEvent({
        eventId: "evt_saas1",
        paymentId: "pay_saas1",
        amountMinor: 99_000,
        saas: true,
        linkId: "link_saas1",
      }),
    );
    const result = await t.action(internal.paymentsProvider.verifyAndReconcileWebhook, {
        rawBody: raw,
        signature,
      });
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
});
