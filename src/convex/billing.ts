import { v } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import { getOrCreateChamber } from "./chamber";
import { INVOICE_STATUSES } from "./schema";

async function requireUser(ctx: QueryCtx) {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("You must be signed in.");
  return user;
}

async function logEvent(
  ctx: MutationCtx,
  matterId: any,
  kind: string,
  detail: string,
) {
  await ctx.db.insert("matterEvents", {
    matterId,
    kind,
    detail,
    createdAt: Date.now(),
  });
}

/** Invoice numbers like ADV/2026-27/0001 based on financial year. */
async function nextInvoiceNumber(ctx: MutationCtx, prefix: string, fyStart: string) {
  const today = new Date();
  const [sm, sd] = fyStart.split("-").map(Number);
  const year =
    today.getMonth() + 1 > sm || (today.getMonth() + 1 === sm && today.getDate() >= sd)
      ? today.getFullYear()
      : today.getFullYear() - 1;
  const fyLabel = `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
  const all = await ctx.db.query("invoices").collect();
  const fyPrefix = `${prefix}/${fyLabel}/`;
  const count = all.filter((i) => i.number.startsWith(fyPrefix)).length;
  return `${prefix}/${fyLabel}/${String(count + 1).padStart(4, "0")}`;
}

/** All invoices with matter and client joined, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const invoices = await ctx.db.query("invoices").collect();
    const sorted = invoices.sort((a, b) => b.createdAt - a.createdAt);
    return Promise.all(
      sorted.map(async (i) => ({
        ...i,
        matter: await ctx.db.get(i.matterId),
        client: await ctx.db.get(i.clientId),
      })),
    );
  },
});

/** One invoice with its matter, client, time lines, expenses and payments. */
export const get = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) return null;

    const [time, exps, pays] = await Promise.all([
      ctx.db
        .query("timeEntries")
        .withIndex("by_uninvoiced", (q) =>
          q.eq("matterId", invoice.matterId).eq("invoiceId", invoice._id),
        )
        .collect(),
      ctx.db
        .query("expenses")
        .withIndex("by_uninvoiced", (q) =>
          q.eq("matterId", invoice.matterId).eq("invoiceId", invoice._id),
        )
        .collect(),
      ctx.db
        .query("payments")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
        .collect(),
    ]);

    return {
      ...invoice,
      matter: await ctx.db.get(invoice.matterId),
      client: await ctx.db.get(invoice.clientId),
      time,
      expenses: exps,
      payments: pays.sort((a, b) => a.receivedOn.localeCompare(b.receivedOn)),
    };
  },
});

/**
 * Draft an invoice on a matter from its uninvoiced time entries and
 * expenses. Applies the chamber's tax settings; line amounts derive from
 * recorded time and disbursements.
 */
export const createFromMatter = mutation({
  args: {
    matterId: v.id("matters"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const matter = await ctx.db.get(args.matterId);
    if (!matter) throw new Error("Matter not found.");

    const time = await ctx.db
      .query("timeEntries")
      .withIndex("by_uninvoiced", (q) =>
        q.eq("matterId", args.matterId).eq("invoiceId", undefined),
      )
      .collect();
    const exps = await ctx.db
      .query("expenses")
      .withIndex("by_uninvoiced", (q) =>
        q.eq("matterId", args.matterId).eq("invoiceId", undefined),
      )
      .collect();

    if (time.length === 0 && exps.length === 0) {
      throw new Error(
        "Nothing to invoice — record time or expenses on this matter first.",
      );
    }

    const timeTotal = time.reduce(
      (sum, t) => sum + Math.round((t.minutes / 60) * t.ratePerHour),
      0,
    );
    const expenseTotal = exps.reduce((sum, e) => sum + e.amount, 0);
    const subtotal = timeTotal + expenseTotal;

    const chamber = await getOrCreateChamber(ctx);
    const taxPercent = chamber?.taxPercent ?? 0;
    const taxAmount = Math.round((subtotal * taxPercent) / 100);
    const total = subtotal + taxAmount;

    const number = await nextInvoiceNumber(
      ctx,
      chamber?.invoicePrefix ?? "ADV",
      chamber?.financialYearStart ?? "04-01",
    );

    const today = new Date().toISOString().slice(0, 10);
    const invoiceId = await ctx.db.insert("invoices", {
      number,
      matterId: args.matterId,
      clientId: matter.clientId,
      status: INVOICE_STATUSES.DRAFT,
      subtotal,
      taxPercent,
      taxAmount,
      total,
      amountPaid: 0,
      notes: args.notes?.trim() || undefined,
      issuedOn: today,
      createdBy: user._id,
      createdAt: Date.now(),
    });

    // Link the line items to this invoice.
    for (const t of time) {
      await ctx.db.patch(t._id, { invoiceId });
    }
    for (const e of exps) {
      await ctx.db.patch(e._id, { invoiceId });
    }

    await logEvent(
      ctx,
      args.matterId,
      "invoice",
      `Invoice ${number} drafted — ₹${total.toLocaleString("en-IN")}.`,
    );

    return invoiceId;
  },
});

export const setStatus = mutation({
  args: {
    invoiceId: v.id("invoices"),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("partially_paid"),
      v.literal("paid"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    await ctx.db.patch(args.invoiceId, { status: args.status });
    await logEvent(
      ctx,
      invoice.matterId,
      "invoice",
      `Invoice ${invoice.number} marked ${args.status.replace("_", " ")}.`,
    );
  },
});

/** Record a payment against an invoice and keep balances in sync. */
export const recordPayment = mutation({
  args: {
    invoiceId: v.id("invoices"),
    amount: v.number(),
    mode: v.union(
      v.literal("upi"),
      v.literal("neft"),
      v.literal("cash"),
      v.literal("cheque"),
      v.literal("other"),
    ),
    reference: v.optional(v.string()),
    receivedOn: v.string(),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);

    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    if (args.amount <= 0) throw new Error("Payment amount must be positive.");

    const totalDue = invoice.total - invoice.amountPaid;
    if (args.amount > totalDue) {
      throw new Error(
        `Payment exceeds the balance due (₹${totalDue.toLocaleString("en-IN")}).`,
      );
    }

    await ctx.db.insert("payments", {
      invoiceId: args.invoiceId,
      amount: args.amount,
      mode: args.mode,
      reference: args.reference?.trim() || undefined,
      receivedOn: args.receivedOn,
      createdAt: Date.now(),
    });

    const amountPaid = invoice.amountPaid + args.amount;
    const status =
      amountPaid >= invoice.total
        ? INVOICE_STATUSES.PAID
        : INVOICE_STATUSES.PARTIALLY_PAID;

    await ctx.db.patch(args.invoiceId, { amountPaid, status });

    await logEvent(
      ctx,
      invoice.matterId,
      "payment",
      `Payment received — ₹${args.amount.toLocaleString("en-IN")} against ${invoice.number}.`,
    );
  },
});

/** Outstanding (unpaid, non-cancelled) invoices for the dashboard. */
export const outstanding = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const invoices = await ctx.db.query("invoices").collect();
    return invoices
      .filter(
        (i) =>
          i.status !== "paid" &&
          i.status !== "cancelled" &&
          i.status !== "draft",
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Chamber revenue snapshot. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    const [invoices, payments] = await Promise.all([
      ctx.db.query("invoices").collect(),
      ctx.db.query("payments").collect(),
    ]);

    const billed = invoices
      .filter((i) => i.status !== "cancelled" && i.status !== "draft")
      .reduce((s, i) => s + i.total, 0);
    const collected = payments.reduce((s, p) => s + p.amount, 0);
    const outstandingAmount = invoices
      .filter((i) => i.status !== "paid" && i.status !== "cancelled")
      .reduce((s, i) => s + (i.total - i.amountPaid), 0);

    return { billed, collected, outstandingAmount };
  },
});
