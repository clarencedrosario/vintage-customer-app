/**
 * Accounting — pure double-entry math and validation.
 *
 * Extracted so the server (`src/convex/finance.ts`) enforces exactly what
 * these functions decide, and the unit suite can exercise the rules
 * without a deployment. All amounts are integer paise (the billing.ts
 * convention). Nothing here touches Convex or I/O.
 */

export type AccountType =
  | "asset"
  | "liability"
  | "income"
  | "expense"
  | "equity";

export type LedgerLine<IdType = string> = {
  accountId: IdType;
  amountPaise: number;
};

export type PostedSide<IdType = string> = {
  debits: LedgerLine<IdType>[];
  credits: LedgerLine<IdType>[];
};

/** Whole-paise, non-negative line amounts. */
export function lineIsValid(line: LedgerLine): boolean {
  return Number.isInteger(line.amountPaise) && line.amountPaise > 0;
}

/** Sum of paise on one side. */
export function sideTotal(lines: LedgerLine[]): number {
  return lines.reduce((sum, l) => sum + l.amountPaise, 0);
}

/**
 * A journal balances when debits === credits in whole paise, there is
 * at least one line on each side, and every line is a positive integer
 * of paise. Zero-amount lines are rejected (they carry no information
 * and would allow silently padded entries).
 */
export function journalBalances(side: PostedSide): boolean {
  if (side.debits.length === 0 || side.credits.length === 0) return false;
  if (!side.debits.every(lineIsValid) || !side.credits.every(lineIsValid))
    return false;
  return sideTotal(side.debits) === sideTotal(side.credits);
}

/** Descriptive validation errors for the server to surface verbatim. */
export function journalValidationError(side: PostedSide): string | null {
  if (side.debits.length === 0 || side.credits.length === 0)
    return "A journal needs at least one debit line and one credit line.";
  const badLine = [...side.debits, ...side.credits].find((l) => !lineIsValid(l));
  if (badLine)
    return "Line amounts must be positive whole paise (no floats, no zeros).";
  const d = sideTotal(side.debits);
  const c = sideTotal(side.credits);
  if (d !== c) return `Journal does not balance: debits ${d}ₚ vs credits ${c}ₚ.`;
  return null;
}

/** Assets and expenses grow with debits; the rest with credits. */
export function normalBalance(type: AccountType): "debit" | "credit" {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

/** Movement of one journal side against an account's normal balance. */
export function signedMovement(
  type: AccountType,
  debitPaise: number,
  creditPaise: number,
): number {
  return normalBalance(type) === "debit"
    ? debitPaise - creditPaise
    : creditPaise - debitPaise;
}

export type AccountBalance<IdType = string> = {
  accountId: IdType;
  type: AccountType;
  /** Signed balance in the account's normal direction (never negative). */
  balancePaise: number;
};

/** Aggregate posted movement per account from journal rows. */
export function accountBalances<IdType = string>(
  accounts: { _id: IdType; type: AccountType }[],
  journals: {
    debits: LedgerLine<IdType>[];
    credits: LedgerLine<IdType>[];
  }[],
): AccountBalance<IdType>[] {
  const debitBy = new Map<IdType, number>();
  const creditBy = new Map<IdType, number>();
  for (const j of journals) {
    for (const l of j.debits)
      debitBy.set(l.accountId, (debitBy.get(l.accountId) ?? 0) + l.amountPaise);
    for (const l of j.credits)
      creditBy.set(l.accountId, (creditBy.get(l.accountId) ?? 0) + l.amountPaise);
  }
  return accounts.map((a) => {
    const d = debitBy.get(a._id) ?? 0;
    const c = creditBy.get(a._id) ?? 0;
    return {
      accountId: a._id,
      type: a.type,
      balancePaise: signedMovement(a.type, d, c),
    };
  });
}

export type TrialBalanceRow<IdType = string> = {
  accountId: IdType;
  code: string;
  name: string;
  type: AccountType;
  debitPaise: number;
  creditPaise: number;
};

/**
 * Trial balance in classic two-column form: each account shows its NET
 * ending balance — on the debit side if debits exceed credits, on the
 * credit side otherwise. Zero-balance accounts are omitted. Because
 * every included journal balances, totalDebits === totalCredits must
 * hold for any set of journals; the server asserts it before responding.
 */
export function trialBalance<IdType = string>(
  accounts: { _id: IdType; code: string; name: string; type: AccountType }[],
  journals: {
    debits: LedgerLine<IdType>[];
    credits: LedgerLine<IdType>[];
  }[],
): { rows: TrialBalanceRow<IdType>[]; totalDebits: number; totalCredits: number } {
  const debitBy = new Map<IdType, number>();
  const creditBy = new Map<IdType, number>();
  for (const j of journals) {
    for (const l of j.debits)
      debitBy.set(l.accountId, (debitBy.get(l.accountId) ?? 0) + l.amountPaise);
    for (const l of j.credits)
      creditBy.set(l.accountId, (creditBy.get(l.accountId) ?? 0) + l.amountPaise);
  }
  const rows: TrialBalanceRow<IdType>[] = [];
  let totalDebits = 0;
  let totalCredits = 0;
  for (const a of [...accounts].sort((x, y) => x.code.localeCompare(y.code))) {
    const d = debitBy.get(a._id) ?? 0;
    const c = creditBy.get(a._id) ?? 0;
    const net = d - c;
    if (net === 0) continue;
    const row: TrialBalanceRow<IdType> = {
      accountId: a._id,
      code: a.code,
      name: a.name,
      type: a.type,
      debitPaise: net > 0 ? net : 0,
      creditPaise: net < 0 ? -net : 0,
    };
    rows.push(row);
    totalDebits += row.debitPaise;
    totalCredits += row.creditPaise;
  }
  return { rows, totalDebits, totalCredits };
}

/** P&L: income minus expenses over the journals supplied (already filtered by period). */
export function profitAndLoss<IdType = string>(
  accounts: { _id: IdType; code: string; name: string; type: AccountType }[],
  journals: {
    debits: LedgerLine<IdType>[];
    credits: LedgerLine<IdType>[];
  }[],
): { incomePaise: number; expensePaise: number; netPaise: number } {
  const balances = accountBalances(accounts, journals);
  let income = 0;
  let expense = 0;
  const byId = new Map(accounts.map((a) => [a._id, a]));
  for (const b of balances) {
    const type = byId.get(b.accountId)?.type;
    if (type === "income") income += b.balancePaise;
    if (type === "expense") expense += b.balancePaise;
  }
  return { incomePaise: income, expensePaise: expense, netPaise: income - expense };
}

/** Is an entry date inside a fiscal year (inclusive, YYYY-MM-DD strings)? */
export function dateInFiscalYear(
  entryDate: string,
  fy: { start: string; end: string },
): boolean {
  return entryDate >= fy.start && entryDate <= fy.end;
}

/**
 * Dedupe key for source-generated journals so a retry can never
 * double-post. Shape: <source>:<sourceId>:<slot> — deterministic per
 * business event.
 */
export function journalDedupeKey(
  source: "billing" | "payroll" | "manual",
  sourceId: string,
  slot: string,
): string {
  return `${source}:${sourceId}:${slot}`;
}
