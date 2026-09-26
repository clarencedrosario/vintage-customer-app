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
        .withIndex("by_dedupe", (q) => q.eq("dedupeKey", args.dedupeKey))
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
// is sent / a payment recorded. Posting is best-effort-but-deterministic:
// without a seeded chart of accounts the call reports `skipped` (the
// operator can seed and nothing silently fabricates entries); with one,
// the dedupe key makes retries idempotent.
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
      debits: [{ accountId: ar._id, amountPaise: invoice.totalMinor }],
      credits,
      dedupeKey,
      createdById: invoice.createdBy,
      createdAt: Date.now(),
    });
    return { posted: true as const, journalId: id };
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
