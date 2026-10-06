// =====================================================================
// Plan catalog + entitlement evaluation — PURE functions only (no I/O),
// so tests exercise the exact rules the server and UI apply.
//
// COMMERCIAL HONESTY RULES (requirements 1–3):
//  - Prices, discounts and savings are COMPUTED from configured prices
//    or not shown at all. Nothing here invents an amount or percentage.
//  - A plan is never labelled "unlimited": allowances are numbers or
//    they are absent — and absent means "not configured", never ∞.
//  - Enterprise is a contact-sales category only; it is never
//    self-serve-purchasable and never advertises capabilities (SSO,
//    residency, dedicated hosting) that do not exist.
// =====================================================================

// ---------------------------------------------------------------------
// Plan categories (A–D). Structural labels for grouping the catalog;
// display names of individual plans remain operator configuration.
// ---------------------------------------------------------------------
export const PLAN_CATEGORIES = [
  {
    id: "practice",
    label: "Practice Management",
    blurb:
      "The complete practice platform without generative AI: matters, tasks, calendars, documents, drafting by hand, client communication and billing tools.",
  },
  {
    id: "practice_ai",
    label: "Practice Management + AI",
    blurb:
      "Everything in Practice Management plus a defined monthly AI allowance: supported legal research, document and matter analysis, drafting and replies — always marked as drafts for lawyer review.",
  },
  {
    id: "firm_ai",
    label: "Firm / Advanced AI",
    blurb:
      "Team administration with configurable seats, higher AI allowances, and access to advanced AI options when they are configured for your firm.",
  },
  {
    id: "enterprise",
    label: "Enterprise",
    blurb:
      "Custom requirements handled by our team. Contact sales — capabilities are agreed for your deployment, not advertised in advance.",
  },
] as const;

export type PlanCategoryId = (typeof PLAN_CATEGORIES)[number]["id"];

export function categoryLabel(id: string | null | undefined): string {
  return PLAN_CATEGORIES.find((c) => c.id === id)?.label ?? "Plan";
}

export type BillingUnit = "per_user" | "per_firm";

// ---------------------------------------------------------------------
// Pricing display math — computed from CONFIGURED prices only.
// ---------------------------------------------------------------------

/** Full annual charge shown prominently; the monthly figure is derived. */
export function monthlyEquivalent(yearlyMinor: number | null | undefined): number | null {
  if (yearlyMinor == null || yearlyMinor <= 0) return null;
  return Math.round(yearlyMinor / 12);
}

/**
 * Savings from configured prices. Returns null unless BOTH prices exist
 * and the yearly price is genuinely cheaper than 12 × monthly — a
 * missing price or an equal price yields NO discount claim, ever.
 */
export function annualSavings(
  monthlyMinor: number | null | undefined,
  yearlyMinor: number | null | undefined,
): { amountMinor: number; percent: number } | null {
  if (monthlyMinor == null || yearlyMinor == null) return null;
  if (monthlyMinor <= 0 || yearlyMinor <= 0) return null;
  const full = monthlyMinor * 12;
  if (yearlyMinor >= full) return null;
  const amountMinor = full - yearlyMinor;
  const percent = Math.round((amountMinor / full) * 100);
  return { amountMinor, percent };
}

// ---------------------------------------------------------------------
// AI access evaluation — the exact gate the server enforces.
// ---------------------------------------------------------------------
export type SubscriptionGateStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "grace"
  | "read_only"
  | "cancelled"
  | "closed"
  | "none"; // no subscription row at all

export type AiAccessInput = {
  aiEnabled: boolean;
  status: SubscriptionGateStatus;
  /** True when the plan was explicitly configured to allow the advanced tier. */
  advancedTierPlan: boolean;
  allowanceTokens: number;
  usedTokens: number;
  reservedTokens: number;
  runningJobs: number;
  maxConcurrentJobs: number;
};

export type AiAccessResult = {
  allowed: boolean;
  /** Always present when allowed is false — the honest, specific reason. */
  reason: string | null;
  tier: "none" | "standard" | "advanced";
  usage: {
    used: number;
    reserved: number;
    allowance: number | null; // null = no AI plan (never displayed as ∞)
    remaining: number; // ≥ 0
  };
};

const STATUS_REASONS: Record<Exclude<SubscriptionGateStatus, "active" | "trialing">, string> = {
  none: "This chamber has no subscription yet. AI is part of paid plans only — choose a plan that includes AI to enable it.",
  past_due:
    "Your subscription payment is outstanding, so new AI requests are paused. Pay the outstanding invoice to resume — saved drafts and research records are untouched.",
  grace:
    "Your subscription has ended and the grace period is active in read-focused mode. New AI requests are paused; your saved work remains available.",
  read_only:
    "This subscription is closed and the workspace is read-only. AI is unavailable; export of your data remains possible.",
  cancelled:
    "This subscription has been cancelled. AI is unavailable; your saved work remains available.",
  closed: "This subscription is closed. AI is unavailable.",
};

/**
 * The single decision function used by every AI entry point (requests,
 * retries, briefings, background research). Server code must call THIS
 * logic — never a re-implementation.
 */
export function evaluateAiAccess(input: AiAccessInput): AiAccessResult {
  const used = Math.max(0, Math.round(input.usedTokens));
  const reserved = Math.max(0, Math.round(input.reservedTokens));
  const allowance = input.aiEnabled ? Math.max(0, Math.round(input.allowanceTokens)) : null;
  const remaining = allowance == null ? 0 : Math.max(0, allowance - used - reserved);

  const base = (tier: AiAccessResult["tier"], allowed: boolean, reason: string | null = null): AiAccessResult => ({
    allowed,
    reason,
    tier,
    usage: { used, reserved, allowance, remaining },
  });

  if (input.status !== "active" && input.status !== "trialing") {
    return base("none", false, STATUS_REASONS[input.status]);
  }
  if (!input.aiEnabled) {
    return base(
      "none",
      false,
      "Your current plan does not include AI. The full operational workspace — manual drafting, documents, tasks, communication — remains available; upgrade to a plan with AI to enable analysis and drafting assistance.",
    );
  }
  if (allowance == null || allowance === 0) {
    return base(
      "none",
      false,
      "AI is enabled on this plan but its allowance has not been configured yet. Ask the platform operator to set the allowance — nothing can be charged meanwhile.",
    );
  }
  if (remaining <= 0) {
    return base(
      input.advancedTierPlan ? "advanced" : "standard",
      false,
      `The monthly AI allowance is exhausted (${used.toLocaleString("en-IN")} of ${allowance.toLocaleString("en-IN")} tokens used this month). It resets next month; nothing is charged automatically. Options: wait for the reset, or ask the firm owner to upgrade to a plan with a higher allowance.`,
    );
  }
  if (input.runningJobs >= input.maxConcurrentJobs) {
    return base(
      input.advancedTierPlan ? "advanced" : "standard",
      false,
      `This plan runs up to ${input.maxConcurrentJobs} AI request(s) at a time and that limit is in use. Wait for a request to finish, then try again — the allowance is not consumed by queued requests.`,
    );
  }
  return base(input.advancedTierPlan ? "advanced" : "standard", true);
}

/**
 * Tokens reserved for one pending job: an ESTIMATE reconciled to actual
 * usage when the job finishes. Failed/expired jobs release it without
 * consuming allowance (reservation is held only while the job is
 * pending — see ai.ts/aiRunner.ts wiring).
 */
export const AI_RESERVE_ESTIMATE_TOKENS = 6_000;
