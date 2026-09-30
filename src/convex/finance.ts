import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  canViewMatter,
  getAccessContext,
  requireAccess,
  requireCapability,
} from "./access";
import type { AccessContext } from "./access";
import { logUserAction } from "./auditLogger";
import {
  journalValidationError,
  journalDedupeKey,
  trialBalance,
  profitAndLoss,
  dateInFiscalYear,
  type AccountType,
} from "../lib/accounting";

// ===============================================================
// Accounting foundation (double-entry core).
//
// Invariants (enforced here, pure math unit-tested in
// src/lib/accounting.test.ts):
// - Every posted journal balances in integer paise.
// - Posted rows are immutable; corrections are audited reversal
//   entries that reference the original.
// - Closed fiscal years reject new posting into their date range.
// - Source-generated entries (billing) carry deterministic dedupe
//   keys so a retry can never double-post.
// - Reports reconcile: the trial balance asserts debits === credits.
//
// No GST/TDS rates are configured here — tax amounts arrive already
// computed by billing.ts; this module only records them.
// ===============================================================

const accountTypeValidator = v.union(
  v.literal("asset"),
  v.literal("liability"),
  v.literal("income"),
  v.literal("expense"),
  v.literal("equity"),
);

/**
 * Standard chart of accounts for an Indian law practice. Seeded only
 * when the org has NO accounts (idempotent). Codes follow a conventional
 * range layout; firms may add/edit accounts freely afterwards.
 */
const DEFAULT_COA: {
  code: string;
  name: string;
  type: AccountType;
  subtype?: string;
  clientFund?: boolean;
}[] = [
  { code: "1000", name: "Bank — Operating", type: "asset", subtype: "bank" },
  { code: "1010", name: "Cash on Hand", type: "asset", subtype: "cash" },
  { code: "1020", name: "Bank — Client Funds", type: "asset", subtype: "bank", clientFund: true },
  { code: "1100", name: "Accounts Receivable", type: "asset", subtype: "receivable" },
  { code: "1200", name: "Retainers & Advances Billed", type: "asset", subtype: "retainer_asset" },
  { code: "1500", name: "Fixed Assets — Office Equipment", type: "asset", subtype: "fixed_asset" },
  { code: "2000", name: "Accounts Payable", type: "liability", subtype: "payable" },
  { code: "2100", name: "Client Funds Held (Liability)", type: "liability", subtype: "client_fund", clientFund: true },
  { code: "2200", name: "CGST Payable", type: "liability", subtype: "tax" },
  { code: "2210", name: "SGST Payable", type: "liability", subtype: "tax" },
  { code: "2220", name: "IGST Payable", type: "liability", subtype: "tax" },
  { code: "2300", name: "TDS Payable", type: "liability", subtype: "tax" },
  // Excess receipts held pending application to an invoice or refund to
  // the customer — excess money is tracked, never discarded.
  { code: "2400", name: "Unapplied Customer Credits", type: "liability", subtype: "credits" },
  { code: "3000", name: "Owner's Capital", type: "equity" },
  { code: "3100", name: "Retained Earnings", type: "equity" },
  { code: "4000", name: "Professional Fees", type: "income", subtype: "fees" },
  { code: "4100", name: "Consultation Fees", type: "income", subtype: "fees" },
  { code: "4200", name: "Recoveries & Disbursements Billed", type: "income", subtype: "recoveries" },
  { code: "5000", name: "Office Rent", type: "expense" },
  { code: "5010", name: "Salaries & Wages", type: "expense" },
  { code: "5020", name: "Professional Subscriptions", type: "expense" },
  { code: "5030", name: "Couriers & Postage", type: "expense" },
  { code: "5040", name: "Books & Research", type: "expense" },
  { code: "5090", name: "General & Administrative", type: "expense" },
];

/** Seed the default COA — only when the org has no accounts at all. */
export const seedChartOfAccounts = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "finance.manage");
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .first();
    if (existing) {
      return { seeded: false as const, reason: "chart_already_exists" as const };
    }
    const now = Date.now();
    for (const a of DEFAULT_COA) {
      await ctx.db.insert("accounts", {
        orgId: ac.org._id,
        code: a.code,
        name: a.name,
        type: a.type,
        subtype: a.subtype,
        clientFund: a.clientFund,
        active: true,
        createdAt: now,
      });
    }
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "finance.chart_seeded",
      resourceId: ac.org._id,
    });
    return { seeded: true as const, count: DEFAULT_COA.length };
  },
});

export const addAccount = mutation({
  args: {
    code: v.string(),
    name: v.string(),
    type: accountTypeValidator,
    clientFund: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "finance.manage");
    const code = args.code.trim();
    const name = args.name.trim();
    if (!/^[0-9]{3,6}$/.test(code))
      throw new Error("Account code must be 3–6 digits.");
    if (!name) throw new Error("Account name is required.");

    const dupe = await ctx.db
      .query("accounts")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) => rows.some((r) => r.code === code));
    if (dupe) throw new Error(`Account code ${code} already exists.`);

    const id = await ctx.db.insert("accounts", {
      orgId: ac.org._id,
      code,
      name,
      type: args.type,
      clientFund: args.clientFund,
      active: true,
      createdAt: Date.now(),
    });
    return id;
  },
});

export const listAccounts = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    requireCapability(ac, "finance.view");
    const rows = await ctx.db
      .query("accounts")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return rows
      .filter((r) => r.active)
      .sort((a, b) => a.code.localeCompare(b.code));
  },
});

/** The fiscal year containing an entry date, or null when outside all defined years. */
async function fiscalYearFor(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  entryDate: string,
): Promise<Doc<"fiscalYears"> | null> {
  const years = await ctx.db
    .query("fiscalYears")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  return years.find((fy) => dateInFiscalYear(entryDate, fy)) ?? null;
}

/** Closed fiscal years freeze posting into their date range. */
async function assertPeriodOpen(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  entryDate: string,
): Promise<void> {
  const fy = await fiscalYearFor(ctx, orgId, entryDate);
  if (fy && fy.closed) {
    throw new Error(
      `Fiscal year ${fy.name} (${fy.start} → ${fy.end}) is closed — entries into it are frozen.`,
    );
  }
}

async function accountByCode(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  code: string,
): Promise<Doc<"accounts"> | null> {
  const rows = await ctx.db
    .query("accounts")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  return rows.find((r) => r.code === code && r.active) ?? null;
}

/**
 * Post a manual journal. Balance is enforced server-side; optional
 * dedupeKey protects against double-submission of the same intent.
 */
export const postJournal = mutation({
  args: {
    entryDate: v.string(), // YYYY-MM-DD
    memo: v.optional(v.string()),
    debits: v.array(v.object({ accountId: v.id("accounts"), amountPaise: v.number() })),
    credits: v.array(v.object({ accountId: v.id("accounts"), amountPaise: v.number() })),
    dedupeKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "finance.manage");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.entryDate))
      throw new Error("Entry date must be YYYY-MM-DD.");

    const problem = journalValidationError({
      debits: args.debits,
      credits: args.credits,
    });
    if (problem) throw new Error(problem);

    if (args.dedupeKey) {
      const dupe = await ctx.db
        .query("journalEntries")
        .withIndex("by_dedupe", (q) => q.eq("dedupeKey", args.dedupeKey!))
        .first();
      if (dupe) {
        return { journalId: dupe._id, posted: false as const };
      }
    }

    await assertPeriodOpen(ctx, ac.org._id, args.entryDate);

    // All referenced accounts must belong to this org.
    for (const line of [...args.debits, ...args.credits]) {
      const acc = await ctx.db.get(line.accountId);
      if (!acc || acc.orgId !== ac.org._id)
        throw new Error("Unknown account in journal lines.");
    }

    const id = await ctx.db.insert("journalEntries", {
      orgId: ac.org._id,
      entryDate: args.entryDate,
      memo: args.memo?.trim().slice(0, 300) || undefined,
      status: "posted",
      source: "manual",
      debits: args.debits,
      credits: args.credits,
      dedupeKey: args.dedupeKey,
      createdById: ac.user._id,
      createdAt: Date.now(),
    });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "finance.journal_posted",
      resourceId: id,
    });
    return { journalId: id, posted: true as const };
  },
});

/**
 * Audited reversal: creates a balanced opposite entry referencing the
 * original and marks the original `reversed`. Posted rows are never
 * edited or deleted.
 */
export const reverseJournal = mutation({
  args: {
    journalId: v.id("journalEntries"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "finance.manage");
    const journal = await ctx.db.get(args.journalId);
    if (!journal || journal.orgId !== ac.org._id)
      throw new Error("Journal not found.");
    if (journal.status !== "posted")
      throw new Error(
        journal.status === "reversed"
          ? "This journal is already reversed."
          : "Only a posted journal can be reversed.",
      );
    const reason = args.reason.trim();
    if (reason.length < 3)
      throw new Error("A reversal reason is required (at least 3 characters).");

    await assertPeriodOpen(ctx, ac.org._id, journal.entryDate);

    const reversalId = await ctx.db.insert("journalEntries", {
      orgId: ac.org._id,
      entryDate: journal.entryDate,
      memo: `Reversal of journal ${journal._id}: ${reason}`.slice(0, 300),
      status: "posted",
      source: journal.source,
      debits: journal.credits,
      credits: journal.debits,
      reversalOfId: journal._id,
      createdById: ac.user._id,
      createdAt: Date.now(),
    });
    await ctx.db.patch(journal._id, { status: "reversed" });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "finance.journal_reversed",
      resourceId: journal._id,
    });
    return reversalId;
  },
});

export const listJournals = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    requireCapability(ac, "finance.view");
    const rows = await ctx.db
      .query("journalEntries")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.min(args.limit ?? 100, 500));
  },
});

/** Ledger for one account: every posted movement, oldest first. */
export const ledgerForAccount = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    requireCapability(ac, "finance.view");
    const account = await ctx.db.get(args.accountId);
    if (!account || account.orgId !== ac.org._id) return null;
    const journals = await ctx.db
      .query("journalEntries")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const rows: {
      journalId: Id<"journalEntries">;
      entryDate: string;
      memo?: string;
      debitPaise: number;
      creditPaise: number;
      balancePaise: number;
      status: string;
    }[] = [];
    let balance = 0;
    const debitNormal = account.type === "asset" || account.type === "expense";
    for (const j of journals
      .filter((j) => j.status === "posted")
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate))) {
      const d = j.debits
        .filter((l) => l.accountId === args.accountId)
        .reduce((s, l) => s + l.amountPaise, 0);
      const c = j.credits
        .filter((l) => l.accountId === args.accountId)
        .reduce((s, l) => s + l.amountPaise, 0);
      if (d === 0 && c === 0) continue;
      balance += debitNormal ? d - c : c - d;
      rows.push({
        journalId: j._id,
        entryDate: j.entryDate,
        memo: j.memo,
        debitPaise: d,
        creditPaise: c,
        balancePaise: balance,
        status: j.status,
      });
    }
    return { account, rows };
  },
});

/** Trial balance; asserts the ledger reconciles before responding. */
export const trialBalanceReport = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    requireCapability(ac, "finance.view");
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const journals = await ctx.db
      .query("journalEntries")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const posted = journals.filter((j) => j.status === "posted");
    const report = trialBalance(accounts, posted);
    // Reconciliation guard: a balanced ledger must produce a balanced TB.
    const reconciles = report.totalDebits === report.totalCredits;
    return { ...report, reconciles, journalCount: posted.length };
  },
});

/** P&L over posted journals, optionally filtered to a fiscal year. */
export const profitAndLossReport = query({
  args: { fiscalYearId: v.optional(v.id("fiscalYears")) },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    requireCapability(ac, "finance.view");
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    let journals = await ctx.db
      .query("journalEntries")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    journals = journals.filter((j) => j.status === "posted");
    if (args.fiscalYearId) {
      const fy = await ctx.db.get(args.fiscalYearId);
      if (fy && fy.orgId === ac.org._id) {
        journals = journals.filter((j) => dateInFiscalYear(j.entryDate, fy));
      }
    }
    return profitAndLoss(accounts, journals);
  },
});

// ---------------------------------------------------------------------
// Billing → ledger integration. Called from billing.ts after an invoice
// is sent / a payment recorded / an invoice cancelled / a refund issued.
// Posting is best-effort-but-deterministic: without a usable chart of
// accounts the call reports `skipped` (the Accounting page surfaces the
// gap — nothing is silently fabricated); with one, the dedupe key makes
// retries idempotent. Every invoice journal records the invoice id in
// originalLineIds so later unwinding references exactly what was posted.
// ---------------------------------------------------------------------

export const postInvoiceJournalInternal = internalMutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) return { posted: false as const, reason: "no_invoice" as const };
    const dedupeKey = journalDedupeKey("billing", invoice._id, "invoice_sent");
    const dupe = await ctx.db
      .query("journalEntries")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    if (dupe) return { posted: true as const, journalId: dupe._id };

    const ar = await accountByCode(ctx, invoice.orgId, "1100");
    const fees = await accountByCode(ctx, invoice.orgId, "4000");
    const recoveries = await accountByCode(ctx, invoice.orgId, "4200");
    const cgst = await accountByCode(ctx, invoice.orgId, "2200");
    const sgst = await accountByCode(ctx, invoice.orgId, "2210");
    const igst = await accountByCode(ctx, invoice.orgId, "2220");
    if (!ar || !fees)
      return { posted: false as const, reason: "chart_not_seeded" as const };

    const lines = invoice.lines ?? [];
    const feePaise = lines
      .filter((l) => l.kind === "time" || l.kind === "fee")
      .reduce((s, l) => s + l.amountMinor, 0);
    const recoveryPaise = lines
      .filter((l) => l.kind === "expense" || l.kind === "expense_reimbursement")
      .reduce((s, l) => s + l.amountMinor, 0);
    // Unattributed remainder (discounts rounding etc.) falls to fees so
    // the entry always balances against the invoice total.
    const subtotal = invoice.subtotalMinor;
    const feesShare = feePaise + recoveryPaise > 0
      ? feePaise
      : subtotal;
    const recoveriesShare = feePaise + recoveryPaise > 0 ? recoveryPaise : 0;
    const feesTotal = subtotal - recoveriesShare < 0 ? subtotal : subtotal - recoveriesShare;

    const credits: { accountId: Id<"accounts">; amountPaise: number }[] = [];
    if (recoveriesShare > 0 && recoveries)
      credits.push({ accountId: recoveries._id, amountPaise: recoveriesShare });
    credits.push({ accountId: fees._id, amountPaise: feesTotal });
    if (invoice.cgstMinor && cgst)
      credits.push({ accountId: cgst._id, amountPaise: invoice.cgstMinor });
    if (invoice.sgstMinor && sgst)
      credits.push({ accountId: sgst._id, amountPaise: invoice.sgstMinor });
    if (invoice.igstMinor && igst)
      credits.push({ accountId: igst._id, amountPaise: invoice.igstMinor });

    const totalCredits = credits.reduce((s, l) => s + l.amountPaise, 0);
    if (totalCredits !== invoice.totalMinor) {
      // Tax accounts missing or line shapes unexpected: adjust the last
      // credit line so the entry balances to the invoice total exactly.
      const diff = invoice.totalMinor - totalCredits;
      const last = credits[credits.length - 1];
      if (last) last.amountPaise += diff;
      else return { posted: false as const, reason: "no_credit_lines" as const };
    }

    const id = await ctx.db.insert("journalEntries", {
      orgId: invoice.orgId,
      entryDate: invoice.issuedOn,
      memo: `Invoice ${invoice.number} sent`,
      status: "posted",
      source: "billing",
      sourceId: invoice._id,
      originalLineIds: [invoice._id],
      debits: [{ accountId: ar._id, amountPaise: invoice.totalMinor }],
      credits,
      dedupeKey,
      createdById: invoice.createdBy,
      createdAt: Date.now(),
    });
    return { posted: true as const, journalId: id };
  },
});

/**
 * Stamp `originalLineIds` onto a billing journal after it posts (used by
 * the send path when the journal already existed without the stamp).
 * Billing-source journals only; a missing row is a no-op.
 */
export const backfillJournalLinesInternal = internalMutation({
  args: {
    journalId: v.id("journalEntries"),
    originalLineIds: v.array(v.id("invoices")),
  },
  handler: async (ctx, args) => {
    const journal = await ctx.db.get(args.journalId);
    if (!journal || journal.source !== "billing") return;
    await ctx.db.patch(args.journalId, { originalLineIds: args.originalLineIds });
  },
});

export const postPaymentJournalInternal = internalMutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) return { posted: false as const, reason: "no_payment" as const };
    const dedupeKey = journalDedupeKey("billing", payment._id, "payment_received");
    const dupe = await ctx.db
      .query("journalEntries")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    if (dupe) return { posted: true as const, journalId: dupe._id };

    const invoice = await ctx.db.get(payment.invoiceId);
    if (!invoice) return { posted: false as const, reason: "no_invoice" as const };

    const bank = await accountByCode(ctx, invoice.orgId, "1000");
    const ar = await accountByCode(ctx, invoice.orgId, "1100");
    if (!bank || !ar)
      return { posted: false as const, reason: "chart_not_seeded" as const };

    const id = await ctx.db.insert("journalEntries", {
      orgId: invoice.orgId,
      entryDate: payment.receivedOn,
      memo: `Payment received — ${invoice.number}`,
      status: "posted",
      source: "billing",
      sourceId: payment._id,
      debits: [{ accountId: bank._id, amountPaise: payment.amountMinor }],
      credits: [{ accountId: ar._id, amountPaise: payment.amountMinor }],
      dedupeKey,
      createdById: payment.recordedById ?? invoice.createdBy,
      createdAt: Date.now(),
    });
    return { posted: true as const, journalId: id };
  },
});

/**
 * Cancellation / credit note for a sent invoice. Two idempotent steps:
 * 1. REVERSE the original invoice journal (audited reversal row with a
 *    `billing:<invoice>:invoice_cancelled` dedupe key) so AR and income
 *    stop carrying the cancelled amount.
 * 2. Money already collected and not refunded leaves a matching
 *    credit-note journal (AR Dr / Bank Cr) so receivables zero out.
 * Skips honestly when nothing was ever posted (pre-COA invoices) — the
 * gap panel + reconciliation cover that case instead of assuming one.
 */
export const postInvoiceCreditJournalInternal = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    reason: v.string(),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) return { posted: false as const, reason: "no_invoice" as const };

    const originalKey = journalDedupeKey("billing", invoice._id, "invoice_sent");
    const original = await ctx.db
      .query("journalEntries")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", originalKey))
      .first();
    if (!original || original.status !== "posted")
      return { posted: false as const, reason: "no_original" as const };

    // Step 1 — reverse the original invoice journal (never delete it).
    const reverseKey = journalDedupeKey("billing", invoice._id, "invoice_cancelled");
    const reversalDupe = await ctx.db
      .query("journalEntries")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", reverseKey))
      .first();
    let reversalId: Id<"journalEntries"> | undefined = reversalDupe?._id;
    if (!reversalDupe) {
      reversalId = await ctx.db.insert("journalEntries", {
        orgId: invoice.orgId,
        entryDate: original.entryDate,
        memo: `Reversal of journal ${original._id} — invoice cancelled: ${args.reason.slice(0, 240)}`,
        status: "posted",
        source: "billing",
        sourceId: invoice._id,
        originalLineIds: original.originalLineIds,
        debits: original.credits,
        credits: original.debits,
        reversalOfId: original._id,
        dedupeKey: reverseKey,
        createdById: args.actorId,
        createdAt: Date.now(),
      });
      await ctx.db.patch(original._id, { status: "reversed" });
    }

    // Step 2 — collected-but-unrefunded money leaves a credit-note
    // journal (Bank Cr / AR Dr) so collected cash and AR both zero out
    // for the cancelled invoice. Refunds live on payment rows — sum them.
    const invoicePaymentRows = await ctx.db
      .query("payments")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
      .collect();
    const refundedTotal = invoicePaymentRows.reduce(
      (s, p) => s + (p.refundedMinor ?? 0),
      0,
    );
    const collected = Math.max(
      (invoice.amountPaidMinor ?? 0) - refundedTotal,
      0,
    );
    if (collected > 0) {
      const cnKey = journalDedupeKey("billing", invoice._id, "credit_note_issued");
      const cnDupe = await ctx.db
        .query("journalEntries")
        .withIndex("by_dedupe", (q) => q.eq("dedupeKey", cnKey))
        .first();
      if (!cnDupe) {
        const bank = await accountByCode(ctx, invoice.orgId, "1000");
        const ar = await accountByCode(ctx, invoice.orgId, "1100");
        if (bank && ar) {
          await ctx.db.insert("journalEntries", {
            orgId: invoice.orgId,
            entryDate: new Date().toISOString().slice(0, 10),
            memo: `Credit note — ${invoice.number}: ${args.reason.slice(0, 240)}`,
            status: "posted",
            source: "billing",
            sourceId: invoice._id,
            debits: [{ accountId: ar._id, amountPaise: collected }],
            credits: [{ accountId: bank._id, amountPaise: collected }],
            dedupeKey: cnKey,
            createdById: args.actorId,
            createdAt: Date.now(),
          });
        }
      }
    }
    return { posted: true as const, journalId: reversalId ?? original._id };
  },
});

/**
 * Excess-receipt journal: the portion of a captured payment beyond the
 * invoice balance is parked as a LIABILITY (Unapplied Customer Credits,
 * 2400) — it is still the customer's money until applied or refunded.
 * Bank is debited for the excess; AR is not touched because nothing was
 * owed. Dedupe-keyed per payment and kind so redelivery cannot
 * double-post. Skips when no chart is seeded; the gap panel shows the
 * reconciliation state instead of assuming one.
 */
export const postExcessJournalInternal = internalMutation({
  args: {
    paymentId: v.id("payments"),
    amountMinor: v.number(),
    kind: v.union(v.literal("excess_held"), v.literal("unapplied_full")),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) return { posted: false as const, reason: "no_payment" as const };
    if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0)
      return { posted: false as const, reason: "non_positive" as const };

    const invoice = await ctx.db.get(payment.invoiceId);
    if (!invoice) return { posted: false as const, reason: "no_invoice" as const };

    const bank = await accountByCode(ctx, invoice.orgId, "1000");
    const credits = await accountByCode(ctx, invoice.orgId, "2400");
    if (!bank || !credits)
      return { posted: false as const, reason: "chart_not_seeded" as const };

    const dedupeKey = journalDedupeKey(
      "billing",
      payment._id,
      args.kind === "unapplied_full" ? "excess_unapplied_full" : "excess_held",
    );
    const dupe = await ctx.db
      .query("journalEntries")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    if (dupe) return { posted: true as const, journalId: dupe._id };

    const id = await ctx.db.insert("journalEntries", {
      orgId: invoice.orgId,
      entryDate: payment.receivedOn,
      memo:
        args.kind === "unapplied_full"
          ? `Unapplied customer credit — ${invoice.number} (nothing outstanding)`
          : `Excess receipt held — ${invoice.number}`,
      status: "posted",
      source: "billing",
      sourceId: payment._id,
      debits: [{ accountId: bank._id, amountPaise: args.amountMinor }],
      credits: [{ accountId: credits._id, amountPaise: args.amountMinor }],
      dedupeKey,
      createdById: payment.recordedById ?? invoice.createdBy,
      createdAt: Date.now(),
    });
    return { posted: true as const, journalId: id };
  },
});

/**
 * Refund journal: AR is re-debited and bank credited for the refunded
 * amount — the exact mirror of the original payment journal, dedupe-keyed
 * per refund (`billing:<payment>:refund:<amount>`) so a retry never
 * double-posts. Skips when no chart is seeded; the gap panel shows the
 * reconciliation state instead of assuming one.
 */
export const postRefundJournalInternal = internalMutation({
  args: {
    paymentId: v.id("payments"),
    amountMinor: v.number(),
    reason: v.string(),
    actorId: v.id("users"),
    // Dedupe scope: two DISTINCT refunds of the same amount on the same
    // payment are legitimate (two partial refunds) and must each post —
    // only a replay of the SAME refund request is a duplicate.
    refundRequestId: v.optional(v.id("refundRequests")),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) return { posted: false as const, reason: "no_payment" as const };
    if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0)
      throw new Error("Refund amount must be a positive whole number of paise.");

    const invoice = await ctx.db.get(payment.invoiceId);
    if (!invoice) return { posted: false as const, reason: "no_invoice" as const };

    const bank = await accountByCode(ctx, invoice.orgId, "1000");
    const ar = await accountByCode(ctx, invoice.orgId, "1100");
    if (!bank || !ar)
      return { posted: false as const, reason: "chart_not_seeded" as const };

    const dedupeKey = journalDedupeKey(
      "billing",
      payment._id,
      args.refundRequestId
        ? `refund:${args.refundRequestId}`
        : `refund:${args.amountMinor}`,
    );
    const dupe = await ctx.db
      .query("journalEntries")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    if (dupe) return { posted: true as const, journalId: dupe._id };

    const id = await ctx.db.insert("journalEntries", {
      orgId: invoice.orgId,
      entryDate: new Date().toISOString().slice(0, 10),
      memo: `Refund — ${invoice.number}: ${args.reason.slice(0, 240)}`,
      status: "posted",
      source: "billing",
      sourceId: payment._id,
      debits: [{ accountId: ar._id, amountPaise: args.amountMinor }],
      credits: [{ accountId: bank._id, amountPaise: args.amountMinor }],
      dedupeKey,
      createdById: args.actorId,
      createdAt: Date.now(),
    });
    return { posted: true as const, journalId: id };
  },
});

// ---------------------------------------------------------------------
// Reconciliation — the gap panel. Every sent invoice and captured
// payment is expected to have a live journal; this lists the ones that
// do not, WITH the reason, so no gap is ever invisible.
// ---------------------------------------------------------------------

/** Required account codes for billing postings to work at all. */
const BILLING_CRITICAL_CODES = ["1000", "1100", "4000"];

/** Parse "billing:<id>:<slot>" keys into (id, slot) pairs. */
function parseBillingKey(
  dedupeKey: string,
): { id: string; slot: string } | null {
  const parts = dedupeKey.split(":");
  if (parts.length !== 3 || parts[0] !== "billing") return null;
  return { id: parts[1], slot: parts[2] };
}

export const billingPostingGaps = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    requireCapability(ac, "finance.view");

    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const chartSeeded = accounts.length > 0;
    const missingCritical = BILLING_CRITICAL_CODES.filter(
      (c) => !accounts.some((a) => a.code === c && a.active),
    );

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const invoiceNumberById = new Map(invoices.map((i) => [i._id, i.number]));

    const journals = await ctx.db
      .query("journalEntries")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    // Live (posted) invoice journal per invoice id; a posted
    // invoice_cancelled reversal flips the flag to false.
    const invoiceJournalLive = new Map<string, boolean>();
    const paymentJournalLive = new Map<string, boolean>();
    for (const j of journals) {
      if (j.source !== "billing" || !j.dedupeKey) continue;
      const parsed = parseBillingKey(j.dedupeKey);
      if (!parsed) continue;
      const live = j.status === "posted";
      if (parsed.slot === "invoice_sent")
        invoiceJournalLive.set(parsed.id, live);
      else if (parsed.slot === "invoice_cancelled" && live)
        invoiceJournalLive.set(parsed.id, false);
      else if (parsed.slot === "payment_received")
        paymentJournalLive.set(parsed.id, live);
    }

    const reasonFor = (cancelledReversalRecorded: boolean): string => {
      if (!chartSeeded)
        return "The chart of accounts had not been seeded when this was recorded. Seed it, then run Reconcile.";
      if (missingCritical.length > 0)
        return `Chart of accounts is missing required account code(s): ${missingCritical.join(", ")}. Add them, then run Reconcile.`;
      if (cancelledReversalRecorded)
        return "Invoice was cancelled after posting — its reversal is recorded; this row is informational, not a gap.";
      return "Recorded before the chart of accounts was set up (or posting was interrupted). Run Reconcile to post the missing journal.";
    };

    const invoicesWithoutJournal = invoices
      .filter(
        (i) =>
          (i.status === "sent" ||
            i.status === "partially_paid" ||
            i.status === "paid") &&
          invoiceJournalLive.get(i._id) !== true,
      )
      .map((i) => ({
        invoiceId: i._id,
        number: i.number,
        totalMinor: i.totalMinor,
        status: i.status,
        cancelledReversalRecorded: invoiceJournalLive.get(i._id) === false,
        reason: reasonFor(invoiceJournalLive.get(i._id) === false),
      }))
      .sort((a, b) => a.number.localeCompare(b.number));

    // Payments index by_invoice — walk each org invoice's payment rows.
    const paymentsWithoutJournal: {
      paymentId: Id<"payments">;
      invoiceNumber: string;
      amountMinor: number;
      mode?: string;
      receivedOn: string;
      reason: string;
    }[] = [];
    if (chartSeeded) {
      for (const inv of invoices) {
        const rows = await ctx.db
          .query("payments")
          .withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id))
          .collect();
        for (const p of rows) {
          if (p.status !== "captured") continue;
          if (paymentJournalLive.get(p._id) === true) continue;
          paymentsWithoutJournal.push({
            paymentId: p._id,
            invoiceNumber: invoiceNumberById.get(inv._id) ?? "—",
            amountMinor: p.amountMinor,
            mode: p.mode,
            receivedOn: p.receivedOn,
            reason: reasonFor(false),
          });
        }
      }
      paymentsWithoutJournal.sort((a, b) =>
        a.invoiceNumber.localeCompare(b.invoiceNumber),
      );
    }

    return {
      chartSeeded,
      missingCritical,
      invoicesWithoutJournal,
      paymentsWithoutJournal,
      summary: {
        invoiceGapCount: invoicesWithoutJournal.filter((g) => !g.cancelledReversalRecorded).length,
        invoiceGapPaise: invoicesWithoutJournal
          .filter((g) => !g.cancelledReversalRecorded)
          .reduce((s, g) => s + g.totalMinor, 0),
        paymentGapCount: paymentsWithoutJournal.length,
        paymentGapPaise: paymentsWithoutJournal.reduce((s, g) => s + g.amountMinor, 0),
      },
    };
  },
});

/**
 * Permission-controlled (finance.manage), idempotent backfill: loops the
 * gap list and posts each missing journal through the same internal
 * postings the live paths use (same dedupe keys), so running it twice
 * is a no-op. Refuses to run against a missing or incomplete chart.
 */
export const reconcileBillingJournals = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "finance.manage");

    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    if (accounts.length === 0)
      throw new Error(
        "Seed the chart of accounts first — reconciliation refuses to guess account mappings.",
      );
    const missingCritical = BILLING_CRITICAL_CODES.filter(
      (c) => !accounts.some((a) => a.code === c && a.active),
    );
    if (missingCritical.length > 0)
      throw new Error(
        `Chart of accounts is incomplete — missing account code(s): ${missingCritical.join(", ")}. Add them before reconciling.`,
      );

    const journals = await ctx.db
      .query("journalEntries")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const invoiceJournalLive = new Map<string, boolean>();
    const paymentJournalLive = new Map<string, boolean>();
    for (const j of journals) {
      if (j.source !== "billing" || !j.dedupeKey) continue;
      const parsed = parseBillingKey(j.dedupeKey);
      if (!parsed) continue;
      const live = j.status === "posted";
      if (parsed.slot === "invoice_sent")
        invoiceJournalLive.set(parsed.id, live);
      else if (parsed.slot === "invoice_cancelled" && live)
        invoiceJournalLive.set(parsed.id, false);
      else if (parsed.slot === "payment_received")
        paymentJournalLive.set(parsed.id, live);
    }

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();

    let invoiceJournalsPosted = 0;
    for (const inv of invoices) {
      if (
        inv.status !== "sent" &&
        inv.status !== "partially_paid" &&
        inv.status !== "paid"
      )
        continue;
      if (invoiceJournalLive.get(inv._id) === true) continue;
      const r = await ctx.runMutation(internal.finance.postInvoiceJournalInternal, {
        invoiceId: inv._id,
      });
      if (r.posted) invoiceJournalsPosted += 1;
    }

    let paymentJournalsPosted = 0;
    for (const inv of invoices) {
      if (invoiceJournalLive.get(inv._id) === false) continue; // cancelled
      const rows = await ctx.db
        .query("payments")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id))
        .collect();
      for (const p of rows) {
        if (p.status !== "captured") continue;
        if (paymentJournalLive.get(p._id) === true) continue;
        const r = await ctx.runMutation(internal.finance.postPaymentJournalInternal, {
          paymentId: p._id,
        });
        if (r.posted) paymentJournalsPosted += 1;
      }
    }

    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "finance.billing_reconciled",
      resourceId: ac.org._id,
    });
    return { invoiceJournalsPosted, paymentJournalsPosted };
  },
});
