import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  getAccessContext,
  requireAccess,
  requireCapability,
  requireMatter,
  canViewMatter,
  can,
} from "./access";
import { INVOICE_STATUSES } from "./schema";
import type { Doc, Id } from "./_generated/dataModel";

// ===============================================================
// Billing — time, expenses, invoices, payments.
//
// MONEY IS STORED IN INTEGER PAISE (minor units) everywhere. All
// arithmetic is integer arithmetic; tax splits round half-up at the
// final step and the remainder reconciles on the larger half so the
// CGST + SGST always re-adds to the tax amount exactly.
//
// Every invoice mutation derives totals from the line items
// transactionally (Convex mutations are ACID per document) and
// appends to the invoice's audit trail.
// ===============================================================

type InvoiceLine = NonNullable<Doc<"invoices">["lines"]>[number];

const MAX_LINES = 60;
const MAX_AUDIT = 60;

async function logEvent(
  ctx: MutationCtx,
  matterId: Id<"matters">,
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

async function audit(
  invoice: Doc<"invoices">,
  byName: string,
  byId: Id<"users"> | undefined,
  text: string,
): Promise<{ audit: { at: number; byId?: Id<"users">; byName: string; text: string }[] }> {
  const entry = {
    at: Date.now(),
    byId: byId,
    byName,
    text,
  };
  return {
    audit: [...(invoice.audit ?? []), entry].slice(-MAX_AUDIT),
  };
}

/** Unique invoice number per organisation + financial year. */
async function nextInvoiceNumber(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  prefix: string,
  fyStart: string,
): Promise<string> {
  const now = new Date();
  const [sm, sd] = fyStart.split("-").map(Number);
  const year =
    now.getMonth() + 1 > sm || (now.getMonth() + 1 === sm && now.getDate() >= sd)
      ? now.getFullYear()
      : now.getFullYear() - 1;
  const fyLabel = `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const fyPrefix = `${prefix}/${fyLabel}/`;
  const max = invoices
    .filter((i) => i.number.startsWith(fyPrefix))
    .reduce((m, i) => {
      const n = Number(i.number.slice(fyPrefix.length));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
  return `${prefix}/${fyLabel}/${String(max + 1).padStart(4, "0")}`;
}

/**
 * Recalculate an invoice's totals from its lines + tax model.
 * Integer-only; the intra-state split reconciles rounding so
 * CGST + SGST == total tax exactly.
 */
function computeTotals(
  lines: InvoiceLine[],
  discountPercentBps: number | undefined,
  discountAmountMinor: number | undefined,
  taxModel: "none" | "intra_state" | "inter_state",
  taxRateBps: number | undefined,
) {
  const subtotal = lines.reduce((s, l) => s + l.amountMinor, 0);

  let discount = 0;
  if (discountAmountMinor !== undefined && discountAmountMinor > 0) {
    discount = Math.min(discountAmountMinor, subtotal);
  } else if (discountPercentBps !== undefined && discountPercentBps > 0) {
    discount = Math.round((subtotal * discountPercentBps) / 10000);
  }
  const taxable = subtotal - discount;

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (taxModel !== "none" && taxRateBps !== undefined && taxRateBps > 0) {
    const totalTax = Math.round((taxable * taxRateBps) / 10000);
    if (taxModel === "inter_state") {
      igst = totalTax;
    } else {
      // Split with half-up rounding; remainder lands on the larger half.
      cgst = Math.round(totalTax / 2);
      sgst = totalTax - cgst;
      if (sgst < cgst) [cgst, sgst] = [sgst, cgst];
    }
  }

  return {
    subtotalMinor: subtotal,
    discountAmountMinor: discount,
    cgstMinor: cgst,
    sgstMinor: sgst,
    igstMinor: igst,
    totalMinor: taxable + cgst + sgst + igst,
  };
}

function assertLineAmounts(lines: InvoiceLine[]) {
  if (lines.length > MAX_LINES) {
    throw new Error(`An invoice can hold at most ${MAX_LINES} lines.`);
  }
  for (const l of lines) {
    if (!l.description.trim()) throw new Error("Every line needs a description.");
    if (!Number.isInteger(l.amountMinor) || l.amountMinor < 0) {
      throw new Error("Line amounts are whole paise and cannot be negative.");
    }
  }
}

function fmtINR(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------

/** Invoices of the active org the caller may see, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const sorted = invoices.sort((a, b) => b.createdAt - a.createdAt);
    return Promise.all(
      sorted.map(async (i) => ({
        ...i,
        balanceMinor: i.totalMinor - i.amountPaidMinor,
        overdue:
          i.status !== "draft" &&
          i.status !== "paid" &&
          i.status !== "cancelled" &&
          i.status !== "credited" &&
          !!i.dueOn &&
          i.dueOn < new Date().toISOString().slice(0, 10),
        matter: await ctx.db.get(i.matterId),
        client: await ctx.db.get(i.clientId),
      })),
    );
  },
});

/** One invoice with matter, client, lines and payments. */
export const get = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.orgId !== ac.org._id) return null;
    if (!can(ac, "billing.invoice") && !can(ac, "billing.payment")) {
      const matter = await ctx.db.get(invoice.matterId);
      if (!matter || !canViewMatter(ac, matter)) return null;
    }

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
      balanceMinor: invoice.totalMinor - invoice.amountPaidMinor,
      overdue:
        invoice.status !== "draft" &&
        invoice.status !== "paid" &&
        invoice.status !== "cancelled" &&
        invoice.status !== "credited" &&
        !!invoice.dueOn &&
        invoice.dueOn < new Date().toISOString().slice(0, 10),
      matter: await ctx.db.get(invoice.matterId),
      client: await ctx.db.get(invoice.clientId),
      time,
      expenses: exps,
      payments: pays.sort((a, b) => a.receivedOn.localeCompare(b.receivedOn)),
    };
  },
});

/**
 * Billable work on a matter: uninvoiced time and expenses with computed
 * minor-unit line amounts, ready for invoice drafting.
 */
export const billable = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    await requireMatter(ctx, ac, args.matterId);

    const [time, exps] = await Promise.all([
      ctx.db
        .query("timeEntries")
        .withIndex("by_uninvoiced", (q) =>
          q.eq("matterId", args.matterId).eq("invoiceId", undefined),
        )
        .collect(),
      ctx.db
        .query("expenses")
        .withIndex("by_uninvoiced", (q) =>
          q.eq("matterId", args.matterId).eq("invoiceId", undefined),
        )
        .collect(),
    ]);

    return {
      time: time.map((t) => ({
        _id: t._id,
        description: t.description,
        minutes: t.minutes,
        ratePerHourMinor: Math.round(t.ratePerHour * 100),
        amountMinor: Math.round((t.minutes / 60) * t.ratePerHour * 100),
        date: t.date,
        billable: t.billable ?? true,
        startedAt: t.startedAt ?? null,
        endedAt: t.endedAt ?? null,
      })),
      expenses: exps.map((e) => ({
        _id: e._id,
        description: e.description,
        amountMinor: Math.round(e.amount * 100),
        date: e.date,
        category: e.category ?? null,
        receiptStorageId: e.receiptStorageId ?? null,
        billable: e.billable ?? true,
      })),
    };
  },
});

/** Consultation payment sessions for the org (billing capability only). */
export const consultationList = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    if (!can(ac, "billing.invoice") && !can(ac, "billing.payment")) return [];
    return ctx.db
      .query("consultations")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30));
  },
});

// ---------------------------------------------------------------------
// Mutations — invoices
// ---------------------------------------------------------------------

/**
 * Draft an invoice on a matter from its uninvoiced time entries and
 * expenses (billable-work conversion), or empty for a fees-only
 * invoice the chamber edits by hand.
 */
export const createFromMatter = mutation({
  args: {
    matterId: v.id("matters"),
    notes: v.optional(v.string()),
    arrangement: v.optional(
      v.union(v.literal("hourly"), v.literal("fixed_fee"), v.literal("retainer")),
    ),
    includeBillable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "billing.invoice");
    const matter = await requireMatter(ctx, ac, args.matterId);

    const lines: InvoiceLine[] = [];
    if (args.includeBillable) {
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

      for (const t of time) {
        const rateMinor = Math.round(t.ratePerHour * 100);
        const amountMinor = Math.round((t.minutes / 60) * rateMinor);
        lines.push({
          description: t.description,
          amountMinor,
          kind: "time",
          minutes: t.minutes,
          ratePerHourMinor: rateMinor,
          linkedTimeEntryId: t._id,
        });
      }
      for (const e of exps) {
        lines.push({
          description: e.description,
          amountMinor: Math.round(e.amount * 100),
          kind: "expense",
          linkedExpenseId: e._id,
        });
      }
    }

    if (lines.length === 0 && args.includeBillable) {
      throw new Error(
        "Nothing billable to convert — record time or expenses first, or start from blank lines.",
      );
    }
    assertLineAmounts(lines);

    const totals = computeTotals(
      lines,
      undefined,
      undefined,
      ac.org.taxLabel.toLowerCase().includes("none") ? "none" : "none",
      undefined,
    );

    const number = await nextInvoiceNumber(
      ctx,
      ac.org._id,
      ac.org.invoicePrefix,
      ac.org.financialYearStart,
    );

    const today = new Date().toISOString().slice(0, 10);
    const invoiceId = await ctx.db.insert("invoices", {
      orgId: ac.org._id,
      number,
      matterId: args.matterId,
      clientId: matter.clientId,
      status: INVOICE_STATUSES.DRAFT,
      arrangement: args.arrangement,
      lines,
      subtotalMinor: totals.subtotalMinor,
      taxModel: "none",
      totalMinor: totals.totalMinor,
      amountPaidMinor: 0,
      notes: args.notes?.trim() || undefined,
      issuedOn: today,
      audit: [
        {
          at: Date.now(),
          byId: ac.user._id,
          byName: ac.user.name ?? ac.user.email ?? "Member",
          text: `Drafted from ${lines.length} line(s) — ${fmtINR(totals.totalMinor)}.`,
        },
      ],
      createdBy: ac.user._id,
      createdAt: Date.now(),
    });

    for (const l of lines) {
      if (l.linkedTimeEntryId) {
        await ctx.db.patch(l.linkedTimeEntryId, { invoiceId });
      }
      if (l.linkedExpenseId) {
        await ctx.db.patch(l.linkedExpenseId, { invoiceId });
      }
    }

    await logEvent(
      ctx,
      args.matterId,
      "invoice",
      `Invoice ${number} drafted — ${fmtINR(totals.totalMinor)}.`,
    );
    return invoiceId;
  },
});

/** Edit the lines / tax model / discount of a draft invoice. */
export const updateDraft = mutation({
  args: {
    invoiceId: v.id("invoices"),
    lines: v.array(
      v.object({
        description: v.string(),
        amountMinor: v.number(),
        kind: v.string(),
        minutes: v.optional(v.number()),
        ratePerHourMinor: v.optional(v.number()),
        linkedTimeEntryId: v.optional(v.id("timeEntries")),
        linkedExpenseId: v.optional(v.id("expenses")),
      }),
    ),
    taxModel: v.union(
      v.literal("none"),
      v.literal("intra_state"),
      v.literal("inter_state"),
    ),
    taxRateBps: v.optional(v.number()),
    discountPercentBps: v.optional(v.number()),
    discountAmountMinor: v.optional(v.number()),
    notes: v.optional(v.string()),
    dueOn: v.optional(v.string()),
    arrangement: v.optional(
      v.union(v.literal("hourly"), v.literal("fixed_fee"), v.literal("retainer")),
    ),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "billing.invoice");
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.orgId !== ac.org._id) {
      throw new Error("Invoice not found.");
    }
    if (invoice.status !== "draft") {
      throw new Error(
        "Only a draft can be edited. Cancel it and raise a fresh invoice for changes this fundamental.",
      );
    }
    assertLineAmounts(args.lines);
    if (
      args.taxRateBps !== undefined &&
      (args.taxRateBps < 0 || args.taxRateBps > 5000)
    ) {
      throw new Error("Tax rate must be between 0% and 50%.");
    }
    if (
      args.discountPercentBps !== undefined &&
      (args.discountPercentBps < 0 || args.discountPercentBps > 10000)
    ) {
      throw new Error("Discount percentage must be between 0% and 100%.");
    }

    const totals = computeTotals(
      args.lines,
      args.discountPercentBps,
      args.discountAmountMinor,
      args.taxModel,
      args.taxRateBps,
    );

    await ctx.db.patch(args.invoiceId, {
      lines: args.lines,
      taxModel: args.taxModel,
      taxRateBps: args.taxRateBps,
      discountPercentBps: args.discountPercentBps,
      discountAmountMinor: totals.discountAmountMinor,
      subtotalMinor: totals.subtotalMinor,
      cgstMinor: totals.cgstMinor,
      sgstMinor: totals.sgstMinor,
      igstMinor: totals.igstMinor,
      totalMinor: totals.totalMinor,
      notes: args.notes?.trim() || undefined,
      dueOn: args.dueOn || undefined,
      arrangement: args.arrangement ?? invoice.arrangement,
      updatedAtHint: undefined,
      ...{},
      ...(await audit(
        invoice,
        ac.user.name ?? ac.user.email ?? "Member",
        ac.user._id,
        `Draft edited — ${args.lines.length} line(s), ${fmtINR(totals.totalMinor)} after tax.`,
      )),
    } as never);
  },
});

/** Send an invoice (locks editing, makes the balance collectible). */
export const send = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "billing.invoice");
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.orgId !== ac.org._id) {
      throw new Error("Invoice not found.");
    }
    if (invoice.status !== "draft") throw new Error("Only a draft can be sent.");
    if (invoice.totalMinor <= 0) {
      throw new Error("Add at least one line before sending.");
    }
    await ctx.db.patch(args.invoiceId, {
      status: INVOICE_STATUSES.SENT,
      ...(await audit(
        invoice,
        ac.user.name ?? ac.user.email ?? "Member",
        ac.user._id,
        "Sent to the client.",
      )),
    });
    // Ledger integration (Phase: accounting foundation). Best-effort with
    // a deterministic dedupe key — without a seeded chart of accounts the
    // call reports `skipped` and nothing is fabricated (the Accounting
    // page surfaces the gap until reconciled); with one, AR/fees tax
    // postings are recorded idempotently. Once posted, the journal is
    // linked back to its source lines so cancellation can unwind
    // exactly what was posted (never more than what exists).
    const posting = await ctx.runMutation(internal.finance.postInvoiceJournalInternal, {
      invoiceId: args.invoiceId,
    });
    if (posting.posted) {
      await ctx.runMutation(internal.finance.backfillJournalLinesInternal, {
        journalId: posting.journalId,
        originalLineIds: [args.invoiceId],
      });
    }
    await logEvent(
      ctx,
      invoice.matterId,
      "invoice",
      `Invoice ${invoice.number} sent — ${fmtINR(invoice.totalMinor)}.`,
    );
  },
});

/**
 * Record a manual payment (audited). Always available even when the
 * online provider is not configured.
 */
export const recordPayment = mutation({
  args: {
    invoiceId: v.id("invoices"),
    amountMinor: v.number(),
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
    const ac = await requireAccess(ctx);
    requireCapability(ac, "billing.payment");
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.orgId !== ac.org._id) {
      throw new Error("Invoice not found.");
    }
    if (invoice.status === "draft") {
      throw new Error("Send the invoice before recording payments.");
    }
    if (invoice.status === "cancelled" || invoice.status === "credited") {
      throw new Error("This invoice is cancelled/credited — payments are closed.");
    }
    if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0) {
      throw new Error("Payment amount must be a positive number of paise.");
    }
    const balance = invoice.totalMinor - invoice.amountPaidMinor;
    if (args.amountMinor > balance) {
      throw new Error(`Payment exceeds the balance due (${fmtINR(balance)}).`);
    }

    const paymentId = await ctx.db.insert("payments", {
      invoiceId: args.invoiceId,
      orgId: ac.org._id,
      amountMinor: args.amountMinor,
      mode: args.mode,
      source: "manual",
      reference: args.reference?.trim() || undefined,
      receivedOn: args.receivedOn,
      status: "captured",
      recordedById: ac.user._id,
      createdAt: Date.now(),
    });
    // Ledger integration: bank Dr / AR Cr, idempotent per payment row.
    // Posts by the INSERTED row id — never "latest row by invoice", so a
    // concurrent payment cannot make this journal describe the wrong row.
    await ctx.runMutation(internal.finance.postPaymentJournalInternal, {
      paymentId,
    });

    const amountPaid = invoice.amountPaidMinor + args.amountMinor;
    const status =
      amountPaid >= invoice.totalMinor
        ? INVOICE_STATUSES.PAID
        : INVOICE_STATUSES.PARTIALLY_PAID;

    await ctx.db.patch(args.invoiceId, {
      amountPaidMinor: amountPaid,
      status,
      ...(await audit(
        invoice,
        ac.user.name ?? ac.user.email ?? "Member",
        ac.user._id,
        `Manual payment recorded — ${fmtINR(args.amountMinor)} (${args.mode})${args.reference ? `, ref ${args.reference.trim()}` : ""}.`,
      )),
    });

    await logEvent(
      ctx,
      invoice.matterId,
      "payment",
      `Payment received — ${fmtINR(args.amountMinor)} against ${invoice.number}.`,
    );
  },
});

/**
 * Cancel an unpaid invoice or convert it (or its balance) to a credit
 * note after partial payment. Cancellation never deletes history.
 */
export const cancelOrCredit = mutation({
  args: {
    invoiceId: v.id("invoices"),
    creditRemaining: v.boolean(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "billing.invoice");
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.orgId !== ac.org._id) {
      throw new Error("Invoice not found.");
    }
    if (invoice.status === "paid") {
      throw new Error(
        "This invoice is fully paid — use a refund through the provider or record a credit instead.",
      );
    }
    if (!args.reason.trim()) {
      throw new Error("A cancellation/credit must carry a reason for the audit trail.");
    }
    const balance = invoice.totalMinor - invoice.amountPaidMinor;
    if (invoice.amountPaidMinor > 0 && !args.creditRemaining) {
      throw new Error(
        "Part-paid invoices keep their balance as a credit note — pass creditRemaining.",
      );
    }

    const credited = invoice.amountPaidMinor > 0 && args.creditRemaining;
    await ctx.db.patch(args.invoiceId, {
      status: credited ? "credited" : "cancelled",
      amountCreditedMinor: credited ? balance : undefined,
      ...(await audit(
        invoice,
        ac.user.name ?? ac.user.email ?? "Member",
        ac.user._id,
        credited
          ? `Balance ${fmtINR(balance)} converted to a credit note — ${args.reason.trim()}`
          : `Invoice cancelled — ${args.reason.trim()}`,
      )),
    });
    // Ledger unwinding. The invoice journal (AR Dr / income+tax Cr) is
    // REVERSED (never deleted, immutability rule), and any collected-but-
    // unrefunded money leaves a matching credit-note journal (Bank/AR
    // movement), so income and receivables end the day understated by
    // exactly the cancelled amount — never inflated. Skips silently when
    // nothing was ever posted (pre-COA invoices) — the gap panel shows
    // the reconciliation state instead of assuming one.
    await ctx.runMutation(internal.finance.postInvoiceCreditJournalInternal, {
      invoiceId: args.invoiceId,
      reason: args.reason.trim(),
      actorId: ac.user._id,
    });
    await logEvent(
      ctx,
      invoice.matterId,
      "invoice",
      `Invoice ${invoice.number} ${credited ? "credited" : "cancelled"} — ${args.reason.trim()}`,
    );
  },
});

/** Release billable work back to the matter (un-invoice a draft). */
export const deleteDraft = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "billing.invoice");
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.orgId !== ac.org._id) {
      throw new Error("Invoice not found.");
    }
    if (invoice.status !== "draft") {
      throw new Error("Only a draft can be deleted — cancel sent invoices instead.");
    }
    for (const l of invoice.lines ?? []) {
      if (l.linkedTimeEntryId) {
        await ctx.db.patch(l.linkedTimeEntryId, { invoiceId: undefined });
      }
      if (l.linkedExpenseId) {
        await ctx.db.patch(l.linkedExpenseId, { invoiceId: undefined });
      }
    }
    await ctx.db.delete(args.invoiceId);
  },
});

// ---------------------------------------------------------------------
// Time & expenses
// ---------------------------------------------------------------------

export const addTime = mutation({
  args: {
    matterId: v.id("matters"),
    description: v.string(),
    minutes: v.number(),
    ratePerHourMinor: v.number(),
    date: v.string(),
    // Timer-based entry: the measured window is preserved for the record.
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    billable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "time.log");
    await requireMatter(ctx, ac, args.matterId);
    if (!args.description.trim()) throw new Error("Describe the work.");
    if (!Number.isInteger(args.minutes) || args.minutes <= 0) {
      throw new Error("Duration must be a positive whole number of minutes.");
    }
    if (!Number.isInteger(args.ratePerHourMinor) || args.ratePerHourMinor < 0) {
      throw new Error("Rate must be whole paise per hour.");
    }
    if (args.startedAt !== undefined && args.endedAt !== undefined && args.endedAt < args.startedAt) {
      throw new Error("The timer end is before its start.");
    }
    await ctx.db.insert("timeEntries", {
      matterId: args.matterId,
      userId: ac.user._id,
      description: args.description.trim().slice(0, 300),
      minutes: args.minutes,
      ratePerHour: args.ratePerHourMinor / 100, // legacy rupees field
      date: args.date,
      startedAt: args.startedAt,
      endedAt: args.endedAt,
      billable: args.billable ?? true,
      createdAt: Date.now(),
    });
  },
});

export const addExpense = mutation({
  args: {
    matterId: v.id("matters"),
    description: v.string(),
    amountMinor: v.number(),
    date: v.string(),
    // Vault-era fields: receipt image and classification.
    category: v.optional(
      v.union(
        v.literal("court_fee"),
        v.literal("filing"),
        v.literal("travel"),
        v.literal("printing"),
        v.literal("courier"),
        v.literal("misc"),
      ),
    ),
    receiptStorageId: v.optional(v.id("_storage")),
    billable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "expense.log");
    await requireMatter(ctx, ac, args.matterId);
    if (!args.description.trim()) throw new Error("Describe the expense.");
    if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0) {
      throw new Error("Amount must be a positive number of paise.");
    }
    await ctx.db.insert("expenses", {
      matterId: args.matterId,
      description: args.description.trim().slice(0, 300),
      amount: args.amountMinor / 100, // legacy rupees field
      date: args.date,
      category: args.category,
      receiptStorageId: args.receiptStorageId,
      billable: args.billable ?? true,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------
// Razorpay — payment links (via the Node-runtime provider bridge)
// ---------------------------------------------------------------------

function providerConfigured() {
  return !!process.env.RAZORPAY_KEY_ID && !!process.env.RAZORPAY_KEY_SECRET;
}

/**
 * Online-collection status for THIS org. `configured` means the firm's
 * OWN merchant connection is active — the platform account never
 * collects client money, so platform keys alone do not flip this.
 */
export const providerStatus = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) {
      return {
        configured: false,
        platformConfigured: providerConfigured(),
        merchantConnected: false,
        mode: null as string | null,
        keyIdLast4: null as string | null,
      };
    }
    const rows = await ctx.db
      .query("orgMerchants")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const active = rows.find((r) => r.active);
    return {
      configured: !!active,
      platformConfigured: providerConfigured(),
      merchantConnected: !!active,
      mode: (active?.mode as string | undefined) ?? null,
      keyIdLast4: active?.keyIdLast4 ?? null,
    };
  },
});

/**
 * Create a Razorpay payment link for the outstanding balance of a sent
 * invoice. Opening the link never marks anything paid — only a verified
 * webhook (signature-checked, idempotent by event id) reconciles.
 */
export const createPaymentLink = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "billing.payment");
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.orgId !== ac.org._id) {
      throw new Error("Invoice not found.");
    }
    if (invoice.status === "draft") {
      throw new Error("Send the invoice before creating a payment link.");
    }
    if (invoice.status === "cancelled" || invoice.status === "credited") {
      throw new Error("This invoice is closed.");
    }
    const balance = invoice.totalMinor - invoice.amountPaidMinor;
    if (balance <= 0) throw new Error("Nothing outstanding on this invoice.");
    // Client money collects through THE FIRM'S OWN Razorpay account
    // (owner decision, 30 Sep 2026) — never the platform account.
    const merchant = await ctx.runQuery(internal.orgMerchants.getActiveInternal, {
      orgId: ac.org._id,
    });
    if (!merchant) {
      throw new Error(
        "Connect your firm's own Razorpay account in Billing to create payment links — client payments are never collected through the platform account. Manual payment recording stays available.",
      );
    }

    const clientDoc = await ctx.db.get(invoice.clientId);
    const link = await ctx.scheduler.runAfter(
      0,
      internal.paymentsProvider.createInvoicePaymentLink,
      {
        invoiceNumber: invoice.number,
        amountMinor: balance,
        clientName: clientDoc?.name ?? "Client",
        clientEmail: clientDoc?.email,
        clientPhone: clientDoc?.phone,
        orgId: ac.org._id,
      },
    );

    // The scheduled action result lands via a follow-up patch; store the
    // intent now so the audit trail is immediate.
    await ctx.db.patch(args.invoiceId, {
      ...(await audit(
        invoice,
        ac.user.name ?? ac.user.email ?? "Member",
        ac.user._id,
        `Payment link requested for ${fmtINR(balance)} (Razorpay).`,
      )),
    });
    void link;
    return { requested: true };
  },
});

/** Internal: store the created payment link on the invoice. */
export const attachPaymentLinkInternal = internalMutation({
  args: {
    invoiceNumber: v.string(),
    paymentLinkId: v.string(),
    paymentLinkUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db
      .query("invoices")
      .filter((q) => q.eq(q.field("number"), args.invoiceNumber))
      .first();
    if (!invoice) return;
    await ctx.db.patch(invoice._id, {
      paymentLinkId: args.paymentLinkId,
      paymentLinkUrl: args.paymentLinkUrl,
    });
  },
});

/** Create a consultation payment session (pay-before-appointment). */
export const createConsultation = mutation({
  args: {
    clientName: v.string(),
    clientEmail: v.optional(v.string()),
    clientPhone: v.optional(v.string()),
    matterSummary: v.optional(v.string()),
    amountMinor: v.number(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "billing.payment");
    if (!args.clientName.trim()) throw new Error("Who is the consultation for?");
    if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0) {
      throw new Error("Amount must be a positive number of paise.");
    }
    // Consultation fees are the firm's revenue: the FIRM'S OWN Razorpay
    // account collects them (owner decision, 30 Sep 2026).
    const merchant = await ctx.runQuery(internal.orgMerchants.getActiveInternal, {
      orgId: ac.org._id,
    });
    if (!merchant) {
      throw new Error(
        "Connect your firm's own Razorpay account in Billing to charge consultation fees — client payments are never collected through the platform account.",
      );
    }

    const id = await ctx.db.insert("consultations", {
      orgId: ac.org._id,
      clientName: args.clientName.trim().slice(0, 200),
      clientEmail: args.clientEmail?.trim() || undefined,
      clientPhone: args.clientPhone?.trim() || undefined,
      matterSummary: args.matterSummary?.trim().slice(0, 500) || undefined,
      amountMinor: args.amountMinor,
      status: "pending",
      createdById: ac.user._id,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.paymentsProvider.createConsultationPaymentLink,
      {
        consultationId: id,
        clientName: args.clientName.trim(),
        clientEmail: args.clientEmail?.trim(),
        clientPhone: args.clientPhone?.trim(),
        amountMinor: args.amountMinor,
        orgId: ac.org._id,
      },
    );
    return { id, requested: true };
  },
});

/** Internal: store the created link on the consultation. */
export const attachConsultationLinkInternal = internalMutation({
  args: {
    consultationId: v.id("consultations"),
    paymentLinkId: v.string(),
    paymentLinkUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.consultationId, {
      paymentLinkId: args.paymentLinkId,
      paymentLinkUrl: args.paymentLinkUrl,
    });
  },
});

// ---------------------------------------------------------------------
// Internal functions — webhook reconciliation (called from http.ts)
// ---------------------------------------------------------------------

/**
 * Idempotently apply a verified payment.captured / payment_link.paid /
 * order.paid event. Two dedupe layers:
 *   1. Per provider EVENT id — a redelivered event never applies twice
 *      (paymentEvents.by_event).
 *   2. Per provider PAYMENT id — payment.captured, payment_link.paid and
 *      order.paid can all name the same underlying payment; exactly one
 *      payments row may ever exist for it (payments.by_provider_payment),
 *      whichever event arrives first. Cross-event duplicates are logged
 *      in the invoice audit, never re-applied.
 *
 * A valid signature alone never authorizes invoice association: the
 * stored payment link / order ids must agree with the event, the event
 * amount must agree with the already-recorded payment for that id, and
 * the provider currency must match the organization's billing currency.
 * Association is accepted only through server-side records (reference_id
 * invoice number, or a stored paymentLinkId) — never from the event
 * payload alone.
 */
export const reconcileWebhookInternal = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    payloadJson: v.string(),
    providerPaymentId: v.string(),
    providerOrderId: v.optional(v.string()),
    paymentLinkId: v.optional(v.string()),
    referenceId: v.optional(v.string()), // invoice number or consult ref
    amountMinor: v.number(),
    currency: v.optional(v.string()),
    method: v.optional(v.string()),
    logOnly: v.optional(v.boolean()), // non-money event: audit only
    // Set ONLY by the firm-webhook verifier after signature verification
    // against that firm's own secret: the event must belong to this org.
    orgId: v.optional(v.id("organizations")),
    // The verified merchant row the event arrived for (firm webhooks).
    merchantId: v.optional(v.id("orgMerchants")),
    merchantRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("paymentEvents")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .first();
    if (existing?.handled) return { applied: false, reason: "already-handled" };

    // Locate the target: invoice via reference_id (number) or paymentLinkId.
    let invoice: Doc<"invoices"> | null = null;
    let consultation: Doc<"consultations"> | null = null;
    let promotion: Doc<"promotions"> | null = null;
    if (args.referenceId) {
      const candidates = await ctx.db
        .query("invoices")
        .filter((q) => q.eq(q.field("number"), args.referenceId))
        .take(2);
      if (candidates.length > 0) {
        invoice = candidates[0] ?? null;
      }
    }
    if (!invoice && args.paymentLinkId) {
      const byLink = await ctx.db
        .query("invoices")
        .filter((q) => q.eq(q.field("paymentLinkId"), args.paymentLinkId))
        .take(2);
      if (byLink.length > 0) {
        invoice = byLink[0] ?? null;
      } else {
        const consults = await ctx.db
          .query("consultations")
          .filter((q) => q.eq(q.field("paymentLinkId"), args.paymentLinkId))
          .take(2);
        consultation = consults[0] ?? null;
      }
    }
    if (!invoice && !consultation && args.paymentLinkId) {
      const promos = await ctx.db
        .query("promotions")
        .filter((q) => q.eq(q.field("paymentLinkId"), args.paymentLinkId))
        .take(2);
      promotion = promos[0] ?? null;
    }

    const orgId = invoice?.orgId ?? consultation?.orgId ?? promotion?.orgId;
    // Firm-webhook events carry the org they verified against; a target
    // in ANY other org is a cross-tenant forgery attempt — log it on the
    // claimed org and apply nothing.
    if (args.orgId && orgId && orgId !== args.orgId) {
      await ctx.db.insert("paymentEvents", {
        orgId: args.orgId,
        eventId: args.eventId,
        eventType: args.eventType,
        payload: args.payloadJson.slice(0, 8000),
        handled: true,
        handledAt: Date.now(),
        note: "RECONCILIATION EXCEPTION — verified firm event does not belong to this firm. Nothing applied.",
        createdAt: Date.now(),
      });
      return { applied: false, reason: "cross-tenant" };
    }
    if (!orgId) {
      if (existing) {
        await ctx.db.patch(existing._id, {
          handled: true,
          handledAt: Date.now(),
          note: "No matching invoice/consultation found.",
        });
        return { applied: false, reason: "no-target" };
      }
      return { applied: false, reason: "no-target" };
    }

    // Non-money events (payment.failed, refunds, etc.): audit only, never
    // touch invoices. They still land in the event log so the audit shows
    // everything the provider sent.
    if (args.logOnly) {
      if (existing) {
        await ctx.db.patch(existing._id, { handled: true, handledAt: Date.now() });
      } else {
        await ctx.db.insert("paymentEvents", {
          orgId,
          eventId: args.eventId,
          eventType: args.eventType,
          payload: args.payloadJson.slice(0, 8000),
          handled: true,
          handledAt: Date.now(),
          note: "Received — no reconciliation.",
          createdAt: Date.now(),
        });
      }
      return { applied: false, reason: "log-only" };
    }

    // ---- Cross-event-type dedupe: one provider payment, one money record.
    // payment.captured, payment_link.paid and order.paid often all name the
    // same payment; whichever event arrives first applies it once.
    const samePayment = args.providerPaymentId
      ? await ctx.db
          .query("payments")
          .withIndex("by_provider_payment", (q) =>
            q.eq("providerPaymentId", args.providerPaymentId),
          )
          .first()
      : null;
    if (samePayment) {
      const inv = await ctx.db.get(samePayment.invoiceId);
      const amountDiscrepancy = samePayment.amountMinor !== args.amountMinor;
      let excessCovered = false;
      if (amountDiscrepancy && inv) {
        const credits = await ctx.db
          .query("unappliedCredits")
          .withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id))
          .collect();
        excessCovered = credits.some(
          (c) => c.providerPaymentId === args.providerPaymentId,
        );
      }
      if (inv) {
        await ctx.db.patch(inv._id, {
          ...(await audit(
            inv,
            "Razorpay webhook",
            undefined,
            amountDiscrepancy
              ? excessCovered
                ? `Event ${args.eventType} (${args.eventId}) names payment ${args.providerPaymentId} — already recorded (applied ${fmtINR(samePayment.amountMinor)} + unapplied customer credit); no double application.`
                : `RECONCILIATION EXCEPTION — event ${args.eventType} (${args.eventId}) reports ${fmtINR(args.amountMinor)} but payment ${args.providerPaymentId} was recorded as ${fmtINR(samePayment.amountMinor)}. No double application; review before acting.`
              : `Event ${args.eventType} (${args.eventId}) names payment ${args.providerPaymentId} — already recorded; no double application.`,
          )),
        });
      }
      const dupNote = `Duplicate across event types for payment ${args.providerPaymentId}.`;
      if (existing) {
        await ctx.db.patch(existing._id, {
          handled: true,
          handledAt: Date.now(),
          note: dupNote,
        });
      } else {
        await ctx.db.insert("paymentEvents", {
          orgId,
          eventId: args.eventId,
          eventType: args.eventType,
          payload: args.payloadJson.slice(0, 8000),
          handled: true,
          handledAt: Date.now(),
          note: dupNote,
          createdAt: Date.now(),
        });
      }
      return { applied: false, reason: "payment-already-recorded" };
    }

    // Server-side association validation: a stored payment link or order
    // id must agree with the event. A mismatched reference never moves
    // money — it is logged as a reconciliation exception.
    if (invoice) {
      const storedLink = invoice.paymentLinkId;
      const storedOrder = invoice.paymentOrderId;
      const linkMismatch =
        !!args.paymentLinkId && !!storedLink && args.paymentLinkId !== storedLink;
      const orderMismatch =
        !!args.providerOrderId &&
        !!storedOrder &&
        args.providerOrderId !== storedOrder;
      if (linkMismatch || orderMismatch) {
        await ctx.db.patch(invoice._id, {
          ...(await audit(
            invoice,
            "Razorpay webhook",
            undefined,
            `RECONCILIATION EXCEPTION — event ${args.eventType} (${args.eventId}) for ${fmtINR(args.amountMinor)} names link/order ${args.paymentLinkId ?? "—"}/${args.providerOrderId ?? "—"} but invoice ${invoice.number} stores ${storedLink ?? "—"}/${storedOrder ?? "—"}. Money NOT applied; review before acting.`,
          )),
        });
        const mismatchNote = "Association mismatch — not applied.";
        if (existing) {
          await ctx.db.patch(existing._id, {
            handled: true,
            handledAt: Date.now(),
            note: mismatchNote,
          });
        } else {
          await ctx.db.insert("paymentEvents", {
            orgId,
            eventId: args.eventId,
            eventType: args.eventType,
            payload: args.payloadJson.slice(0, 8000),
            handled: true,
            handledAt: Date.now(),
            note: mismatchNote,
            createdAt: Date.now(),
          });
        }
        return { applied: false, reason: "association-mismatch" };
      }
    }

    if (!existing) {
      await ctx.db.insert("paymentEvents", {
        orgId,
        eventId: args.eventId,
        eventType: args.eventType,
        payload: args.payloadJson.slice(0, 8000),
        handled: true,
        handledAt: Date.now(),
        createdAt: Date.now(),
      });
    } else {
      await ctx.db.patch(existing._id, { handled: true, handledAt: Date.now() });
    }

    if (invoice) {
      // Currency must match the organization's billing currency.
      if (args.currency) {
        const org = await ctx.db.get(invoice.orgId);
        if (org && args.currency !== org.currency) {
          await ctx.db.patch(invoice._id, {
            ...(await audit(
              invoice,
              "Razorpay webhook",
              undefined,
              `RECONCILIATION EXCEPTION — event ${args.eventType} (${args.eventId}) reports currency ${args.currency} but this organization bills in ${org.currency}. Money NOT applied.`,
            )),
          });
          return { applied: false, reason: "currency-mismatch" };
        }
      }

      const balance = invoice.totalMinor - invoice.amountPaidMinor;
      const applied = Math.min(args.amountMinor, Math.max(balance, 0));
      const excess = args.amountMinor - applied;
      if (applied <= 0) {
        // Nothing outstanding: the full captured amount is recorded and
        // held as an explicitly tracked unapplied customer credit — never
        // discarded, refundable on request.
        const registryId = await ctx.db.insert("payments", {
          invoiceId: invoice._id,
          orgId: invoice.orgId,
          amountMinor: args.amountMinor,
          mode: "upi",
          source: "razorpay",
          reference: args.providerPaymentId,
          receivedOn: new Date().toISOString().slice(0, 10),
          status: "captured",
          providerPaymentId: args.providerPaymentId,
          providerOrderId: args.providerOrderId,
          currency: args.currency,
          merchantId: args.merchantId,
          capturedMerchantRef: args.merchantRef,
          createdAt: Date.now(),
        });
        await ctx.db.insert("unappliedCredits", {
          orgId: invoice.orgId,
          invoiceId: invoice._id,
          paymentId: registryId,
          providerPaymentId: args.providerPaymentId,
          clientId: invoice.clientId,
          amountMinor: args.amountMinor,
          status: "excess_received",
          note: `Full over-payment — invoice ${invoice.number} was already settled.`,
          createdAt: Date.now(),
        });
        await ctx.runMutation(internal.finance.postExcessJournalInternal, {
          paymentId: registryId,
          amountMinor: args.amountMinor,
          kind: "unapplied_full",
        });
        await ctx.db.patch(invoice._id, {
          ...(await audit(
            invoice,
            "Razorpay webhook",
            undefined,
            `Webhook ${args.eventType} for ${fmtINR(args.amountMinor)} recorded as an unapplied customer credit — nothing was outstanding.`,
          )),
        });
        return { applied: false, reason: "nothing-outstanding" };
      }
      const amountPaid = invoice.amountPaidMinor + applied;
      const status =
        amountPaid >= invoice.totalMinor
          ? INVOICE_STATUSES.PAID
          : INVOICE_STATUSES.PARTIALLY_PAID;
      await ctx.db.patch(invoice._id, {
        amountPaidMinor: amountPaid,
        status,
        ...(await audit(
          invoice,
          "Razorpay webhook",
          undefined,
          `Online payment captured — ${fmtINR(applied)} (provider id ${args.providerPaymentId})${excess > 0 ? `; ${fmtINR(excess)} held as an unapplied customer credit` : ""}.`,
        )),
      });      const webhookPaymentId = await ctx.db.insert("payments", {
        invoiceId: invoice._id,
        orgId: invoice.orgId,
        amountMinor: applied,
        mode: "upi",
        source: "razorpay",
        reference: args.providerPaymentId,
        receivedOn: new Date().toISOString().slice(0, 10),
        status: "captured",
        providerPaymentId: args.providerPaymentId,
        providerOrderId: args.providerOrderId,
        currency: args.currency,
        merchantId: args.merchantId,
        capturedMerchantRef: args.merchantRef,
        createdAt: Date.now(),
      });
      // Excess money is never discarded from the records: the invoice
      // allocation is capped, and the remainder is an explicitly tracked
      // customer credit (held funds pending application or refund).
      if (excess > 0) {
        await ctx.db.insert("unappliedCredits", {
          orgId: invoice.orgId,
          invoiceId: invoice._id,
          paymentId: webhookPaymentId,
          providerPaymentId: args.providerPaymentId,
          clientId: invoice.clientId,
          amountMinor: excess,
          status: "excess_received",
          note: `Excess beyond invoice ${invoice.number} balance — ${fmtINR(args.amountMinor)} captured, ${fmtINR(applied)} applied.`,
          createdAt: Date.now(),
        });
        await ctx.runMutation(internal.finance.postExcessJournalInternal, {
          paymentId: webhookPaymentId,
          amountMinor: excess,
          kind: "excess_held",
        });
      }
      // Ledger integration for provider payments (same as manual ones):
      // posts by the inserted row id, and the per-payment dedupe key
      // makes webhook redelivery a no-op.
      await ctx.runMutation(internal.finance.postPaymentJournalInternal, {
        paymentId: webhookPaymentId,
      });
      await logEvent(
        ctx,
        invoice.matterId,
        "payment",
        `Online payment — ${fmtINR(applied)} against ${invoice.number}.${excess > 0 ? ` ${fmtINR(excess)} recorded as unapplied customer credit.` : ""}`,
      );
      return { applied: true, appliedMinor: applied, excessMinor: excess };
    }

    if (promotion) {
      await ctx.runMutation(internal.promotions.activateOnPaymentInternal, {
        promotionId: promotion._id,
        providerPaymentId: args.providerPaymentId,
      });
      return { applied: true };
    }

    if (
      consultation &&
      (consultation.status === "pending" || consultation.status === "accepted")
    ) {
      const wasAccepted = consultation.status === "accepted";
      await ctx.db.patch(consultation._id, {
        status: wasAccepted ? "scheduled" : "paid",
        paidAt: Date.now(),
        providerPaymentId: args.providerPaymentId,
        ...(wasAccepted
          ? {
              history: [
                ...(consultation.history ?? []),
                { at: Date.now(), text: "Fee payment received — consultation confirmed." },
              ],
            }
          : {}),
      });
      if (wasAccepted) {
        await ctx.scheduler.runAfter(
          0,
          internal.consultRequests.notifyRequesterInternal,
          {
            consultationId: consultation._id,
            text: "Payment received — your consultation is confirmed. See you at the appointed time.",
          },
        );
      }
      return { applied: true };
    }
    return { applied: false, reason: "not-pending" };
  },
});

/**
 * Request a refund of a provider payment (chamber-authorized, normal
 * speed). Local state changes FIRST, inside this transaction:
 *   - a refundRequests row is created with status "requested";
 *   - the payments row shows "refund_pending" so nobody double-requests
 *     while the provider call is in flight;
 *   - invoice money, payment status and the refund journal move ONLY on
 *     provider confirmation (markRefundProcessedInternal), so the books
 *     move exactly when the refund actually happens.
 * The provider call is scheduled after commit; failure is reported back
 * by the Node action and recorded as "failed" with nothing moved.
 */
export const requestRefund = mutation({
  args: {
    paymentRowId: v.id("payments"),
    amountMinor: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "billing.payment");
    const payment = await ctx.db.get(args.paymentRowId);
    if (!payment || payment.orgId !== ac.org._id) {
      throw new Error("Payment not found.");
    }
    if (payment.source !== "razorpay" || !payment.providerPaymentId) {
      throw new Error("Only provider payments can be refunded here — adjust manual payments with a credit note.");
    }
    if (payment.merchantId) {
      // Firm money: the refund depends on the CAPTURING merchant account
      // being resolvable — platform keys are irrelevant here.
      const m = await ctx.runQuery(
        internal.orgMerchants.getCredentialByMerchantInternal,
        { merchantId: payment.merchantId },
      );
      if (!m) {
        throw new Error(
          "The merchant account that captured this payment is no longer available — the refund is refused rather than sent through any other account. Record the adjustment manually and reconcile with the firm.",
        );
    }
    } else if (!providerConfigured()) {
      // Platform money (subscriptions/promotions): deployment keys.
      throw new Error("Payment provider is not configured.");
    }
    if (payment.status === "refund_pending") {
      throw new Error("A refund is already in progress for this payment.");
    }
    const already = payment.refundedMinor ?? 0;
    const refundable = payment.amountMinor - already;
    if (args.amountMinor <= 0 || args.amountMinor > refundable) {
      throw new Error(`Refund must be between 1 and ${fmtINR(refundable)}.`);
    }

    const requestId = await ctx.db.insert("refundRequests", {
      orgId: ac.org._id,
      paymentId: args.paymentRowId,
      invoiceId: payment.invoiceId,
      providerPaymentId: payment.providerPaymentId,
      // Frozen at request time: the refund must go back through the
      // account that CAPTURED the money — never "whatever is connected
      // now" (owner requirement: an old refund must never be sent to a
      // newly connected, different account).
      merchantId: payment.merchantId,
      amountMinor: args.amountMinor,
      reason: args.reason?.trim() || undefined,
      status: "requested",
      requestedById: ac.user._id,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.paymentRowId, { status: "refund_pending" });

    // The provider call happens after this transaction commits; the
    // refund id (or failure) is attached by the follow-up mutation.
    await ctx.scheduler.runAfter(0, internal.paymentsProvider.refundPayment, {
      paymentRowId: args.paymentRowId,
      refundRequestId: requestId,
      providerPaymentId: payment.providerPaymentId,
      amountMinor: args.amountMinor,
      reason: args.reason,
    });
    return { refundRequestId: requestId };
  },
});

/** Internal: provider accepted the refund — apply money + books now. */
export const markRefundProcessedInternal = internalMutation({
  args: {
    refundRequestId: v.id("refundRequests"),
    refundId: v.string(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.refundRequestId);
    if (!request || request.status !== "requested") {
      return { applied: false, reason: "not-open" };
    }
    const t = Date.now();
    await ctx.db.patch(args.refundRequestId, {
      status: "processed",
      providerRefundId: args.refundId,
      processedAt: t,
    });

    const payment = await ctx.db.get(request.paymentId);
    if (!payment) return { applied: false, reason: "no_payment" };
    const refunded = (payment.refundedMinor ?? 0) + request.amountMinor;
    await ctx.db.patch(payment._id, {
      refundedMinor: refunded,
      status: refunded >= payment.amountMinor ? "refunded" : "partially_refunded",
    });

    const invoice = await ctx.db.get(payment.invoiceId);
    if (invoice) {
      const newPaid = Math.max(invoice.amountPaidMinor - request.amountMinor, 0);
      await ctx.db.patch(invoice._id, {
        amountPaidMinor: newPaid,
        status:
          newPaid >= invoice.totalMinor
            ? INVOICE_STATUSES.PAID
            : newPaid > 0
              ? INVOICE_STATUSES.PARTIALLY_PAID
              : INVOICE_STATUSES.SENT,
        ...(await audit(
          invoice,
          "Razorpay webhook",
          undefined,
          `Refund processed by provider — ${fmtINR(request.amountMinor)} (refund id ${args.refundId})${request.reason ? ` — ${request.reason}` : ""}.`,
        )),
      });
      await logEvent(
        ctx,
        invoice.matterId,
        "payment",
        `Refund processed — ${fmtINR(request.amountMinor)} on ${invoice.number}.`,
      );
      // Ledger: unwind collected money exactly — AR is re-debited and
      // bank credited for the refunded amount (the mirror of the original
      // payment journal), dedupe-keyed per refund so a retry never
      // double-posts.
      await ctx.runMutation(internal.finance.postRefundJournalInternal, {
        paymentId: payment._id,
        amountMinor: request.amountMinor,
        reason: request.reason?.trim() || "Provider refund",
        actorId: request.requestedById ?? invoice.createdBy,
        refundRequestId: args.refundRequestId,
      });
    }
    return { applied: true };
  },
});

/** Internal: provider rejected the refund — record the failure, move nothing. */
export const markRefundFailedInternal = internalMutation({
  args: {
    refundRequestId: v.id("refundRequests"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.refundRequestId);
    if (!request || request.status !== "requested") {
      return { applied: false, reason: "not-open" };
    }
    await ctx.db.patch(args.refundRequestId, {
      status: "failed",
      failedAt: Date.now(),
      failureReason: args.reason.slice(0, 500),
    });
    // Release the in-flight lock so a corrected retry is possible.
    const payment = await ctx.db.get(request.paymentId);
    if (payment && payment.status === "refund_pending") {
      const stillRequested = await ctx.db
        .query("refundRequests")
        .withIndex("by_payment", (q) => q.eq("paymentId", request.paymentId))
        .collect();
      if (!stillRequested.some((r) => r.status === "requested")) {
        await ctx.db.patch(payment._id, {
          status: (payment.refundedMinor ?? 0) >= payment.amountMinor
            ? "refunded"
            : (payment.refundedMinor ?? 0) > 0
              ? "partially_refunded"
              : "captured",
        });
      }
    }
    const invoice = request.invoiceId ? await ctx.db.get(request.invoiceId) : null;
    if (invoice) {
      await ctx.db.patch(invoice._id, {
        ...(await audit(
          invoice,
          "Razorpay webhook",
          undefined,
          `Refund attempt FAILED at the provider (${fmtINR(request.amountMinor)}) — ${args.reason.slice(0, 200)}. Nothing was refunded; retry from the payment once corrected.`,
        )),
      });
    }
    return { applied: true };
  },
});

/** Internal: attach the provider refund id after the API call (legacy path). */
export const attachRefundInternal = internalMutation({
  args: {
    paymentRowId: v.id("payments"),
    refundId: v.string(),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentRowId);
    if (!payment) return;
    await ctx.db.patch(args.paymentRowId, {
      refundIds: [...(payment.refundIds ?? []), args.refundId],
    });
  },
});

/** Internal: one payments row by id (merchant routing for refunds). */
export const getPaymentRowInternal = internalQuery({
  args: { paymentRowId: v.id("payments") },
  handler: async (ctx, args) => {
    return (await ctx.db.get(args.paymentRowId)) ?? null;
  },
});

/** Internal: one refund request by id (refund merchant routing). */
export const getRefundRequestInternal = internalQuery({
  args: { refundRequestId: v.id("refundRequests") },
  handler: async (ctx, args) => {
    return (await ctx.db.get(args.refundRequestId)) ?? null;
  },
});

/** Outstanding (unpaid, non-cancelled) invoices for the dashboard. */
export const outstanding = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return invoices
      .filter(
        (i) =>
          i.status !== "paid" &&
          i.status !== "cancelled" &&
          i.status !== "credited" &&
          i.status !== "draft",
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Org revenue snapshot (billing capabilities only). */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    if (!can(ac, "billing.invoice") && !can(ac, "billing.payment")) {
      return null;
    }

    const [invoices, payments] = await Promise.all([
      ctx.db
        .query("invoices")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect(),
      ctx.db.query("payments").collect(),
    ]);

    const orgInvoiceIds = new Set(invoices.map((i) => i._id));
    const billed = invoices
      .filter((i) => i.status !== "cancelled" && i.status !== "draft" && i.status !== "credited")
      .reduce((s, i) => s + i.totalMinor, 0);
    const collected = payments
      .filter((p) => orgInvoiceIds.has(p.invoiceId))
      .reduce((s, p) => s + p.amountMinor, 0);
    const refunds = payments
      .filter((p) => orgInvoiceIds.has(p.invoiceId))
      .reduce((s, p) => s + (p.refundedMinor ?? 0), 0);
    const outstandingAmount = invoices
      .filter((i) => i.status !== "paid" && i.status !== "cancelled" && i.status !== "credited")
      .reduce((s, i) => s + (i.totalMinor - i.amountPaidMinor), 0);
    const overdueAmount = invoices
      .filter(
        (i) =>
          i.status !== "paid" &&
          i.status !== "cancelled" &&
          i.status !== "credited" &&
          i.status !== "draft" &&
          !!i.dueOn &&
          i.dueOn < new Date().toISOString().slice(0, 10),
      )
      .reduce((s, i) => s + (i.totalMinor - i.amountPaidMinor), 0);

    return {
      billed,
      collected: collected - refunds,
      outstandingAmount,
      overdueAmount,
    };
  },
});
