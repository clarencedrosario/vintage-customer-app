// =====================================================================
// APPROVED PRICING — the ONE authoritative pure configuration for the
// six subscription plans (approved 12 Oct 2026).
//
// Every rupee the pricing page displays, the checkout precheck charges,
// and the tests assert comes from THIS module or from `saasPlans` rows
// created to match it — prices are never hard-coded in the UI nor
// re-derived ad hoc at call sites.
//
// MINOR UNITS: all amounts are paise (₹1 = 100), matching `priceMinor`
// elsewhere in the app.
//
// ENFORCEMENT NOTE: the seat functions here are the exact math the
// SERVER (checkout precheck) uses — the client renders with the same
// module so display and charge can never drift.
// =====================================================================

/** Amounts in paise. */
export const MINOR = {
  free: 0,
  solo: 49_900, // ₹499
  advocateAi: 99_900, // ₹999
  chamberAi: 399_900, // ₹3,999 (includes up to 4 users)
  chamberNoAi: 199_900, // ₹1,999 (includes up to 4 users)
  enterprisePerUser: 89_900, // ₹899 per paid user
} as const;

/** Included billable users beyond which the extra-user rate applies. */
export const CHAMBER_INCLUDED_USERS = 4;

/** Enterprise minimum paid users (also the invoice floor). */
export const ENTERPRISE_MIN_USERS = 10;

/** ₹8,990/month minimum before taxes (899 ₹ × 10). */
export const ENTERPRISE_MIN_MONTHLY_MINOR =
  MINOR.enterprisePerUser * ENTERPRISE_MIN_USERS; // 899_000

// ---------------------------------------------------------------------
// Plan identity codes — the `saasPlans.code` values the catalog rows
// carry. Keep stable; tests and the checkout map read them.
// ---------------------------------------------------------------------
export type ApprovedPlanCode =
  | "free"
  | "solo"
  | "advocate_ai"
  | "chamber_ai"
  | "chamber_noai"
  | "enterprise";

export type ApprovedPlanCategory =
  | "practice"
  | "practice_ai"
  | "firm_ai"
  | "enterprise";

export type ApprovedPlan = {
  code: ApprovedPlanCode;
  name: string;
  category: ApprovedPlanCategory;
  kind: "individual" | "firm";
  /** Monthly base price in paise (0 = free). */
  priceMinor: number;
  /** How the base price is charged. */
  billingUnit: "per_user" | "per_firm";
  /** Billable users included in the base price (null = individual tier). */
  includedUsers: number | null;
  /** Extra user per month beyond the included users (null = N/A). */
  extraUserMinor: number | null;
  /** Enterprise only: the paid-user floor. */
  minPaidUsers: number | null;
  /** AI entitlement as approved. */
  aiEnabled: boolean;
  /** Enterprise is contact-sales (never self-serve checkout). */
  contactSales: boolean;
};

export const APPROVED_PLANS: ApprovedPlan[] = [
  {
    code: "free",
    name: "Free",
    category: "practice",
    kind: "individual",
    priceMinor: MINOR.free,
    billingUnit: "per_user",
    includedUsers: null,
    extraUserMinor: null,
    minPaidUsers: null,
    aiEnabled: false,
    contactSales: false,
  },
  {
    code: "solo",
    name: "Solo",
    category: "practice",
    kind: "individual",
    priceMinor: MINOR.solo,
    billingUnit: "per_firm",
    includedUsers: null,
    extraUserMinor: null,
    minPaidUsers: null,
    aiEnabled: false,
    contactSales: false,
  },
  {
    code: "advocate_ai",
    name: "Advocate AI",
    category: "practice_ai",
    kind: "individual",
    priceMinor: MINOR.advocateAi,
    billingUnit: "per_firm",
    includedUsers: null,
    extraUserMinor: null,
    minPaidUsers: null,
    aiEnabled: true,
    contactSales: false,
  },
  {
    code: "chamber_ai",
    name: "Chamber / Small Firm with AI",
    category: "practice_ai",
    kind: "firm",
    priceMinor: MINOR.chamberAi,
    billingUnit: "per_firm",
    includedUsers: CHAMBER_INCLUDED_USERS,
    extraUserMinor: 99_900, // ₹999/user/month
    minPaidUsers: null,
    aiEnabled: true,
    contactSales: false,
  },
  {
    code: "chamber_noai",
    name: "Chamber / Small Firm without AI",
    category: "practice",
    kind: "firm",
    priceMinor: MINOR.chamberNoAi,
    billingUnit: "per_firm",
    includedUsers: CHAMBER_INCLUDED_USERS,
    extraUserMinor: 44_900, // ₹449/user/month
    minPaidUsers: null,
    aiEnabled: false,
    contactSales: false,
  },
  {
    code: "enterprise",
    name: "Big Firms / Enterprise with AI",
    category: "enterprise",
    kind: "firm",
    priceMinor: ENTERPRISE_MIN_MONTHLY_MINOR,
    billingUnit: "per_user",
    includedUsers: null,
    extraUserMinor: MINOR.enterprisePerUser,
    minPaidUsers: ENTERPRISE_MIN_USERS,
    aiEnabled: true,
    contactSales: true,
  },
];

export function approvedPlan(code: string): ApprovedPlan | null {
  return APPROVED_PLANS.find((p) => p.code === code) ?? null;
}

// ---------------------------------------------------------------------
// Seat math — the SERVER-enforced charge model.
// ---------------------------------------------------------------------

/**
 * Monthly charge in paise for a plan at a billable-user count.
 * Rejects invalid seat counts per the approved rules.
 */
export function monthlyChargeMinor(
  plan: ApprovedPlan,
  paidUsers: number,
): number {
  const users = Math.floor(paidUsers);
  if (!Number.isFinite(paidUsers) || users < 1) {
    throw new Error("At least one paid user is required.");
  }

  if (plan.code === "enterprise") {
    if (users < ENTERPRISE_MIN_USERS) {
      throw new Error(
        `The Enterprise plan requires a minimum of ${ENTERPRISE_MIN_USERS} paid users.`,
      );
    }
    return users * MINOR.enterprisePerUser;
  }

  if (plan.includedUsers == null) {
    // Individual / per-firm plans: one flat price regardless of users.
    return plan.priceMinor;
  }

  // Chamber bundles: base price includes up to four users.
  if (users <= plan.includedUsers) return plan.priceMinor;
  return plan.priceMinor + (users - plan.includedUsers) * (plan.extraUserMinor ?? 0);
}

/** Does this seat count satisfy the plan's seat rules? (no throw) */
export function seatCountValid(plan: ApprovedPlan, paidUsers: number): boolean {
  const users = Math.floor(paidUsers);
  if (!Number.isFinite(paidUsers) || users < 1) return false;
  if (plan.code === "enterprise") return users >= ENTERPRISE_MIN_USERS;
  return true;
}

/** Do chamber extra seats hit the right per-user rate? (diagnostic) */
export function extraSeatsFor(
  plan: ApprovedPlan,
  paidUsers: number,
): number {
  if (plan.includedUsers == null) return 0;
  return Math.max(0, Math.floor(paidUsers) - plan.includedUsers);
}
