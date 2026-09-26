import { describe, expect, it } from "vitest";
import {
  accountBalances,
  dateInFiscalYear,
  journalBalances,
  journalDedupeKey,
  journalValidationError,
  lineIsValid,
  normalBalance,
  profitAndLoss,
  sideTotal,
  signedMovement,
  trialBalance,
  type PostedSide,
} from "./accounting";

const ACC = {
  bank: "acc_bank",
  ar: "acc_ar",
  retainer: "acc_retainer",
  fees: "acc_fees",
  rent: "acc_rent",
  capital: "acc_capital",
};

const ACCOUNTS = [
  { _id: ACC.bank, code: "1000", name: "Bank — Operating", type: "asset" as const },
  { _id: ACC.ar, code: "1100", name: "Accounts Receivable", type: "asset" as const },
  { _id: ACC.retainer, code: "2100", name: "Client Retainers Held", type: "liability" as const },
  { _id: ACC.fees, code: "4000", name: "Professional Fees", type: "income" as const },
  { _id: ACC.rent, code: "5000", name: "Office Rent", type: "expense" as const },
  { _id: ACC.capital, code: "3000", name: "Capital", type: "equity" as const },
];

function posted(debits: [string, number][], credits: [string, number][]): PostedSide {
  return {
    debits: debits.map(([accountId, amountPaise]) => ({ accountId, amountPaise })),
    credits: credits.map(([accountId, amountPaise]) => ({ accountId, amountPaise })),
  };
}

describe("line validation", () => {
  it("accepts positive whole paise only", () => {
    expect(lineIsValid({ accountId: "a", amountPaise: 1 })).toBe(true);
    expect(lineIsValid({ accountId: "a", amountPaise: 12345 })).toBe(true);
    expect(lineIsValid({ accountId: "a", amountPaise: 0 })).toBe(false);
    expect(lineIsValid({ accountId: "a", amountPaise: -5 })).toBe(false);
    expect(lineIsValid({ accountId: "a", amountPaise: 10.5 })).toBe(false);
  });

  it("sums sides", () => {
    expect(
      sideTotal([
        { accountId: "a", amountPaise: 100 },
        { accountId: "b", amountPaise: 250 },
      ]),
    ).toBe(350);
  });
});

describe("journalBalances", () => {
  it("accepts a balanced journal", () => {
    expect(
      journalBalances(
        posted(
          [[ACC.bank, 118000]],
          [[ACC.fees, 100000], [ACC.ar, 18000]],
        ),
      ),
    ).toBe(true);
  });

  it("rejects unbalanced journals", () => {
    expect(
      journalBalances(
        posted([[ACC.bank, 100]], [[ACC.fees, 99]]),
      ),
    ).toBe(false);
  });

  it("rejects one-sided journals", () => {
    expect(journalBalances(posted([[ACC.bank, 100]], []))).toBe(false);
    expect(journalBalances(posted([], [[ACC.fees, 100]]))).toBe(false);
  });

  it("rejects zero or fractional lines even when balanced", () => {
    expect(
      journalBalances(
        posted(
          [[ACC.bank, 100], [ACC.ar, 0]],
          [[ACC.fees, 100]],
        ),
      ),
    ).toBe(false);
    expect(
      journalBalances(
        posted([[ACC.bank, 100.5]], [[ACC.fees, 100.5]]),
      ),
    ).toBe(false);
  });
});

describe("journalValidationError", () => {
  it("describes imbalance with exact paise", () => {
    expect(
      journalValidationError(posted([[ACC.bank, 1000]], [[ACC.fees, 999]])),
    ).toBe("Journal does not balance: debits 1000ₚ vs credits 999ₚ.");
  });

  it("describes missing sides", () => {
    expect(journalValidationError(posted([[ACC.bank, 100]], []))).toMatch(
      /at least one debit/,
    );
  });

  it("returns null for a valid journal", () => {
    expect(
      journalValidationError(posted([[ACC.bank, 500]], [[ACC.fees, 500]])),
    ).toBeNull();
  });
});

describe("normal balance and signed movement", () => {
  it("classifies account types", () => {
    expect(normalBalance("asset")).toBe("debit");
    expect(normalBalance("expense")).toBe("debit");
    expect(normalBalance("liability")).toBe("credit");
    expect(normalBalance("income")).toBe("credit");
    expect(normalBalance("equity")).toBe("credit");
  });

  it("moves balances in the normal direction", () => {
    // Bank: debit 1000, credit 400 → debit-normal balance 600.
    expect(signedMovement("asset", 1000, 400)).toBe(600);
    // Fees: credit 1000, debit 100 → credit-normal balance 900.
    expect(signedMovement("income", 100, 1000)).toBe(900);
  });
});

describe("accountBalances", () => {
  it("aggregates posted journals per account", () => {
    const journals = [
      posted([[ACC.bank, 500000]], [[ACC.capital, 500000]]), // capital introduced
      posted([[ACC.bank, 118000]], [[ACC.fees, 100000], [ACC.ar, 18000]]), // invoice
      posted([[ACC.ar, 18000]], [[ACC.bank, 18000]]), // client pays
    ];
    const balances = accountBalances(ACCOUNTS, journals);
    const byId = new Map(balances.map((b) => [b.accountId, b.balancePaise]));
    expect(byId.get(ACC.bank)).toBe(600000);
    expect(byId.get(ACC.ar)).toBe(0);
    expect(byId.get(ACC.capital)).toBe(500000);
    expect(byId.get(ACC.fees)).toBe(100000);
  });
});

describe("trialBalance", () => {
  it("balances: total debits equal total credits", () => {
    const journals = [
      posted([[ACC.bank, 500000]], [[ACC.capital, 500000]]), // capital introduced
      posted([[ACC.ar, 100000]], [[ACC.fees, 100000]]), // invoice on account
      posted([[ACC.bank, 100000]], [[ACC.ar, 100000]]), // client pays in full
      posted([[ACC.rent, 25000]], [[ACC.bank, 25000]]), // rent paid
    ];
    const tb = trialBalance(ACCOUNTS, journals);
    expect(tb.totalDebits).toBe(tb.totalCredits);
    expect(tb.totalDebits).toBe(600000);
    // AR nets to zero → omitted from the report.
    expect(tb.rows.find((r) => r.accountId === ACC.ar)).toBeUndefined();
  });

  it("balances even when an asset account ends in an unusual position", () => {
    // Legal but odd: the client overpays by 18000ₚ. AR ends with a net
    // CREDIT balance. The report still balances — the whole point.
    const journals = [
      posted([[ACC.ar, 100000]], [[ACC.fees, 100000]]), // invoice on account
      posted([[ACC.bank, 118000]], [[ACC.ar, 118000]]), // client pays 1180 instead of 1000
    ];
    const tb = trialBalance(ACCOUNTS, journals);
    expect(tb.totalDebits).toBe(tb.totalCredits);
    const ar = tb.rows.find((r) => r.accountId === ACC.ar);
    expect(ar?.creditPaise).toBe(18000); // shown on the credit side
  });

  it("keeps balancing rows on their normal side", () => {
    const tb = trialBalance(
      ACCOUNTS,
      [posted([[ACC.bank, 500000]], [[ACC.capital, 500000]])],
    );
    const bank = tb.rows.find((r) => r.accountId === ACC.bank)!;
    const capital = tb.rows.find((r) => r.accountId === ACC.capital)!;
    expect(bank.debitPaise).toBe(500000);
    expect(bank.creditPaise).toBe(0);
    expect(capital.creditPaise).toBe(500000);
    expect(capital.debitPaise).toBe(0);
  });

  it("sorts rows by account code", () => {
    const tb = trialBalance(
      ACCOUNTS,
      [
        posted([[ACC.bank, 10]], [[ACC.fees, 10]]),
        posted([[ACC.rent, 5]], [[ACC.bank, 5]]),
      ],
    );
    const codes = tb.rows.map((r) => r.code);
    expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
  });
});

describe("profitAndLoss", () => {
  it("computes income, expense and net", () => {
    const journals = [
      posted([[ACC.ar, 100000]], [[ACC.fees, 100000]]),
      posted([[ACC.ar, 50000]], [[ACC.fees, 50000]]),
      posted([[ACC.rent, 30000]], [[ACC.bank, 30000]]),
    ];
    const pl = profitAndLoss(ACCOUNTS, journals);
    expect(pl.incomePaise).toBe(150000);
    expect(pl.expensePaise).toBe(30000);
    expect(pl.netPaise).toBe(120000);
  });
});

describe("dateInFiscalYear", () => {
  it("checks inclusive YYYY-MM-DD bounds", () => {
    const fy = { start: "2026-04-01", end: "2027-03-31" };
    expect(dateInFiscalYear("2026-04-01", fy)).toBe(true);
    expect(dateInFiscalYear("2026-12-15", fy)).toBe(true);
    expect(dateInFiscalYear("2027-03-31", fy)).toBe(true);
    expect(dateInFiscalYear("2027-04-01", fy)).toBe(false);
    expect(dateInFiscalYear("2026-03-31", fy)).toBe(false);
  });
});

describe("journalDedupeKey", () => {
  it("is deterministic per source event and slot", () => {
    expect(journalDedupeKey("billing", "inv123", "invoice_posted")).toBe(
      "billing:inv123:invoice_posted",
    );
    expect(journalDedupeKey("billing", "inv123", "invoice_posted")).toBe(
      journalDedupeKey("billing", "inv123", "invoice_posted"),
    );
    expect(journalDedupeKey("billing", "inv123", "payment_received")).not.toBe(
      journalDedupeKey("billing", "inv123", "invoice_posted"),
    );
  });
});
