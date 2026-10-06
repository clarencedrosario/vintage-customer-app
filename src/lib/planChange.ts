// =====================================================================
// Plan-change disclosure math — PURE functions (no I/O), so the exact
// figures the billing UI shows before confirmation are test-pinned.
//
// BILLING EXPLICITNESS RULES (commercial release):
//  - Proration is NOT implemented in this release. The supported change
//    policy is therefore NEXT-BILLING-PERIOD: an immediate switch keeps
//    the current period's charge as paid, and the NEXT payment covers
//    the new plan's full price at the existing period end. Nothing is
//    charged at the moment of switching.
//  - Renewal is MANUAL: at period end the operator issues a payment
//    link; the subscription renews when that link is paid. No automatic
//    card charge is advertised, because none is implemented/verified.
//  - Every confirm dialog shows the effective date and the next charge
//    amount BEFORE the user confirms.
// =====================================================================

export type PlanChangeTiming = "immediately" | "period_end";

export type PlanChangeFacts = {
  /** Name shown in the confirm dialog. */
  planName: string;
  /** "monthly" | "yearly" — the new plan's billing cycle. */
  interval: "monthly" | "yearly";
  /** Full price of the new plan (minor units). */
  priceMinor: number;
  /** Epoch ms of the current period's end (the next billing date). */
  currentPeriodEnd: number;
  timing: PlanChangeTiming;
};

export type PlanChangeDisclosure = {
  /** Human date (en-IN) the change takes effect. */
  effectiveDate: string;
  /** Amount of the NEXT charge (minor units) — never prorated. */
  nextChargeMinor: number;
  /** What is charged TODAY (minor units) — always 0 in this release. */
  chargedTodayMinor: number;
  /** One-line policy label, shown verbatim in the confirm dialog. */
  policyLabel: string;
  /** What happens if the renewal payment is not received by the due date. */
  ifUnpaid: string;
};

function fmtDate(at: number): string {
  return new Date(at).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtINR(minor: number): string {
  return `₹${(minor / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPlanCharge(minor: number): string {
  return fmtINR(minor);
}

export function formatPlanDate(at: number): string {
  return fmtDate(at);
}

/**
 * The single disclosure used by both switch buttons. `now` is injectable
 * for tests; production passes Date.now().
 */
export function describePlanChange(
  facts: PlanChangeFacts,
  now: number = Date.now(),
): PlanChangeDisclosure {
  const periodEndAt = Math.max(0, facts.currentPeriodEnd);
  const nextChargeMinor = Math.max(0, Math.round(facts.priceMinor));

  if (facts.timing === "period_end") {
    return {
      effectiveDate: fmtDate(periodEndAt),
      nextChargeMinor,
      chargedTodayMinor: 0,
      policyLabel:
        "Next-billing-period change — no proration. Nothing is charged today; the new plan's full price is charged when the next payment link is paid.",
      ifUnpaid: `If the renewal payment is not received by ${fmtDate(periodEndAt + 7 * 86_400_000)}, the subscription moves to a 7-day grace period and then becomes read-only — your files stay viewable and exportable throughout.`,
    };
  }
  return {
    effectiveDate: fmtDate(Math.max(now, 0)),
    nextChargeMinor,
    chargedTodayMinor: 0,
    policyLabel:
      "Next-billing-period change — no proration. The switch applies now, nothing is charged today, and the next payment (due by the current period's end) covers the new plan's full price.",
    ifUnpaid: `If the next payment is not received by ${fmtDate(periodEndAt + 7 * 86_400_000)}, the subscription moves to a 7-day grace period and then becomes read-only — your files stay viewable and exportable throughout.`,
  };
}

/** The confirm-dialog sentence for a timing, with real figures inline. */
export function planChangeConfirmText(
  facts: PlanChangeFacts,
  now: number = Date.now(),
): string {
  const d = describePlanChange(facts, now);
  const when =
    facts.timing === "period_end"
      ? `at the end of the current period (${d.effectiveDate})`
      : `now (${d.effectiveDate})`;
  return [
    `Switch to ${facts.planName} (${facts.interval === "yearly" ? "annual" : "monthly"}) ${when}?`,
    `Charged today: ${fmtINR(0)}. Next charge: ${fmtINR(d.nextChargeMinor)} (${facts.interval === "yearly" ? "annual" : "monthly"}), due by the current period's end (${fmtDate(facts.currentPeriodEnd)}).`,
    d.policyLabel,
    d.ifUnpaid,
    "Renewal is manual: at each period end we issue a payment link; the subscription renews when the link is paid. No automatic card charge is made.",
  ].join(" ");
}
