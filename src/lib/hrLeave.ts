/**
 * HR leave math — pure helpers shared by hr.ts (server) and the UI.
 *
 * Conventions (matching the codebase): dates are IST calendar days as
 * YYYY-MM-DD strings; leave balances are day counts with one decimal
 * (half-days supported); money never appears here. Nothing touches
 * Convex or I/O, so the unit suite exercises exactly what the server
 * runs.
 */

export type LeaveBalance = {
  leaveType: string;
  balance: number; // days, one decimal
  asOf: string; // YYYY-MM-DD
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive day count between two YYYY-MM-DD dates (same day = 1). */
export function daysBetweenInclusive(start: string, end: string): number {
  if (!DATE_RE.test(start) || !DATE_RE.test(end))
    throw new Error("Leave dates must be YYYY-MM-DD.");
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const a = Date.UTC(sy!, sm! - 1, sd!);
  const b = Date.UTC(ey!, em! - 1, ed!);
  return Math.round((b - a) / 86_400_000) + 1;
}

export type LeaveApplicationShape = {
  startDate: string;
  endDate: string;
  days: number;
};

/** Validation errors for a leave application, or null when acceptable. */
export function leaveApplicationError(
  app: LeaveApplicationShape,
): string | null {
  if (!DATE_RE.test(app.startDate) || !DATE_RE.test(app.endDate))
    return "Leave dates must be YYYY-MM-DD.";
  if (app.endDate < app.startDate)
    return "Leave cannot end before it starts.";
  if (!Number.isFinite(app.days) || app.days <= 0)
    return "Leave must be at least half a day.";
  const expected = daysBetweenInclusive(app.startDate, app.endDate);
  if (Math.abs(app.days - expected) > 0.5)
    return `Days (${app.days}) do not match the date range (${expected} day(s)).`;
  return null;
}

/** Current balance for a leave type (0 when never granted). */
export function balanceFor(
  balances: LeaveBalance[] | undefined,
  leaveType: string,
): number {
  return (
    balances?.find((b) => b.leaveType === leaveType)?.balance ?? 0
  );
}

/**
 * Decrement a leave balance when a request is marked taken. Refuses to
 * go negative — insufficient balance is an explicit error the caller
 * surfaces, never a silently overdrawn ledger. Returns a NEW array
 * (inputs are treated as immutable); the touched row carries the
 * `asOf` stamp.
 */
export function decrementBalance(
  balances: LeaveBalance[] | undefined,
  leaveType: string,
  days: number,
  asOf: string,
): LeaveBalance[] {
  if (!Number.isFinite(days) || days <= 0)
    throw new Error("Days to decrement must be positive.");
  if (!DATE_RE.test(asOf)) throw new Error("asOf must be YYYY-MM-DD.");
  const current = balanceFor(balances, leaveType);
  if (current < days)
    throw new Error(
      `Insufficient ${leaveType} balance: ${current} day(s) available, ${days} requested.`,
    );
  const exists = (balances ?? []).some((b) => b.leaveType === leaveType);
  if (!exists) {
    return [
      ...(balances ?? []),
      { leaveType, balance: current - days, asOf },
    ];
  }
  return (balances ?? []).map((b) =>
    b.leaveType === leaveType ? { ...b, balance: b.balance - days, asOf } : b,
  );
}

/**
 * Unpaid split for an approval: how many of `days` exceed the current
 * balance and must flow to payroll as LOP (loss of pay). The approver
 * decides explicitly; this helper only computes the honest number.
 */
export function unpaidDaysFor(
  balances: LeaveBalance[] | undefined,
  leaveType: string,
  days: number,
): number {
  const available = balanceFor(balances, leaveType);
  return Math.max(days - Math.max(available, 0), 0);
}
