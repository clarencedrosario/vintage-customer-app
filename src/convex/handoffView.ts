// =====================================================================
// CJ GLOBAL — AI-handoff materialized view: PURE rules.
//
// `aiHandoffStats` is a write-maintained materialized view: one row per
// chamber holding pre-computed counters of that chamber's OPEN
// AI-to-human escalation tickets (open / unclaimed / high-priority) and
// forward-only last-handoff / last-resolution timestamps.
//
// The view is bumped INSIDE the same transaction as the ticket write
// that caused the change, so a read can never observe a ticket state
// without its matching view row. No scheduler maintains this view.
// Keeping this module free of `ctx` lets the delta rules be unit-tested
// without a deployment (same pattern as accessPolicy.ts / payrollMath.ts).
//
// Delta model: every caller passes a BEFORE and AFTER snapshot of the
// ticket (before = null on creation). Counters are recomputed as
// row − before-contribution + after-contribution, which uniformly covers
// create, claim (open→in_progress moves unclaimed), priority changes on
// live tickets, resolve, close and reopen — there is exactly one rule.
// "Open" mirrors the operator queue: open + in_progress.
// =====================================================================

export type HandoffTicketSnapshot = {
  kind: string;
  orgId: string | undefined;
  status: string;
  priority: string;
  assignedToId?: string | null;
};

export type HandoffViewRow = {
  orgId: string;
  openCount: number;
  unclaimedCount: number;
  highPriorityCount: number;
  lastHandoffAt: number | null;
  lastResolvedAt: number | null;
  updatedAt: number;
};

export function isHandoffOpen(status: string): boolean {
  return status === "open" || status === "in_progress";
}

export function isHandoffHighPriority(priority: string): boolean {
  return priority === "high" || priority === "urgent";
}

/** Which of the row's counters one live ticket contributes to. */
function contribution(s: HandoffTicketSnapshot): {
  open: number;
  unclaimed: number;
  high: number;
} {
  const open = isHandoffOpen(s.status) ? 1 : 0;
  return {
    open,
    unclaimed: open && !s.assignedToId ? 1 : 0,
    high: open && isHandoffHighPriority(s.priority) ? 1 : 0,
  };
}

/**
 * Merge one snapshot change into the view row and return its next state.
 * Pure: no reads, no writes, no clock — `at` is passed in.
 *
 * before = null means creation (the ticket did not exist). Counters are
 * floored at zero so a buggy replay can never drive them negative.
 * lastHandoffAt advances only on creation; lastResolvedAt advances only
 * when the ticket LANDS on resolved (not on resolve→reopen replays);
 * both are forward-only so out-of-order writes cannot move them back.
 */
export function mergeHandoffSnapshotChange(
  row: HandoffViewRow | null,
  before: HandoffTicketSnapshot | null,
  after: HandoffTicketSnapshot,
  at: number,
): HandoffViewRow {
  const base: HandoffViewRow = row ?? {
    orgId: after.orgId as string,
    openCount: 0,
    unclaimedCount: 0,
    highPriorityCount: 0,
    lastHandoffAt: null,
    lastResolvedAt: null,
    updatedAt: 0,
  };

  const sub = before ? contribution(before) : { open: 0, unclaimed: 0, high: 0 };
  const add = contribution(after);

  return {
    orgId: after.orgId as string,
    openCount: Math.max(0, base.openCount - sub.open + add.open),
    unclaimedCount: Math.max(0, base.unclaimedCount - sub.unclaimed + add.unclaimed),
    highPriorityCount: Math.max(0, base.highPriorityCount - sub.high + add.high),
    lastHandoffAt: before === null ? Math.max(base.lastHandoffAt ?? 0, at) || null : base.lastHandoffAt,
    lastResolvedAt:
      after.status === "resolved" && before?.status !== "resolved"
        ? Math.max(base.lastResolvedAt ?? 0, at) || null
        : base.lastResolvedAt,
    updatedAt: Math.max(base.updatedAt, at),
  };
}

/**
 * Deterministic rebuild from a chamber's full AI-handoff ticket scan.
 * `now` is injected so the function stays pure; the result is the
 * authoritative row state (timestamps included).
 */
export function rebuildHandoffRow(
  orgId: string,
  tickets: {
    status: string;
    priority: string;
    assignedToId?: string | null;
    createdAt: number;
    resolvedAt?: number | null;
  }[],
  now: number,
): HandoffViewRow {
  const open = tickets.filter((t) => isHandoffOpen(t.status));
  const lastHandoffAt = tickets.reduce<number | null>(
    (acc, t) => (t.createdAt > (acc ?? 0) ? t.createdAt : acc),
    null,
  );
  const lastResolvedAt = tickets.reduce<number | null>(
    (acc, t) => (t.resolvedAt && t.resolvedAt > (acc ?? 0) ? t.resolvedAt : acc),
    null,
  );
  return {
    orgId,
    openCount: open.length,
    unclaimedCount: open.filter((t) => !t.assignedToId).length,
    highPriorityCount: open.filter((t) => isHandoffHighPriority(t.priority)).length,
    lastHandoffAt,
    lastResolvedAt,
    updatedAt: now,
  };
}

/**
 * Drift check between the maintained view row and a freshly rebuilt row:
 * every counter must match exactly. Timestamps may legitimately differ
 * (the view is forward-only, a rebuild is authoritative), so they are
 * not compared. `rebuildAiHandoffStats` reports rows that fail this.
 */
export function handoffCountersMatch(
  view: Pick<HandoffViewRow, "openCount" | "unclaimedCount" | "highPriorityCount">,
  rebuilt: Pick<HandoffViewRow, "openCount" | "unclaimedCount" | "highPriorityCount">,
): boolean {
  return (
    view.openCount === rebuilt.openCount &&
    view.unclaimedCount === rebuilt.unclaimedCount &&
    view.highPriorityCount === rebuilt.highPriorityCount
  );
}
