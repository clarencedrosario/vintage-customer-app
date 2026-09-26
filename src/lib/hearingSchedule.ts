/**
 * Hearing scheduling — pure, testable scheduling logic.
 *
 * Extracted so the server (`src/convex/matters.ts`) enforces exactly what
 * these functions decide, and the unit suite can exercise the rules without
 * a live deployment. All day arithmetic uses the fixed IST offset used
 * across the codebase (`src/convex/calendar.ts`, `src/convex/ai.ts`).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** YYYY-MM-DD of an epoch-ms timestamp in Asia/Kolkata. */
export function istDay(ts: number): string {
  return new Date(ts + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** IST day for an epoch-ms timestamp, rejecting bad input. */
export function istDayOrThrow(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid hearing time.");
  return istDay(ts);
}

/** Start/end epoch-ms for a YYYY-MM-DD IST day. */
export function istDayBounds(day: string): { start: number; end: number } {
  const start = new Date(`${day}T00:00:00+05:30`).getTime();
  const end = new Date(`${day}T23:59:59.999+05:30`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error("Date must be in YYYY-MM-DD format.");
  }
  return { start, end };
}

/** Default warning window around a candidate hearing time. */
export const MAX_CLASH_BUFFER_MS = 30 * 60 * 1000;

/** An existing hearing considered for clash detection. */
export type ClashCandidate = {
  hearingId: string;
  matterId: string;
  title: string;
  at: number;
  courtroom?: string;
  appearingAdvocateId?: string;
};

/** One detected clash. */
export type Clash = {
  hearingId: string;
  matterId: string;
  title: string;
  at: number;
  courtroom?: string;
  appearingAdvocateId?: string;
  /** Overlap type: same courtroom, same advocate, or time-adjacent. */
  reason: "same_courtroom" | "same_advocate" | "adjacent";
};

/**
 * The advocate whose diary a clash would disrupt: the appearing advocate
 * if named, otherwise the fallback (the matter's lead lawyer) supplied
 * by the caller.
 */
export function effectiveAdvocate(
  appearingAdvocateId: string | undefined,
  fallbackAdvocateId: string | undefined,
): string | undefined {
  return appearingAdvocateId || fallbackAdvocateId;
}

/**
 * Detect clashes between a candidate hearing time and existing hearings.
 *
 * A clash requires TIME overlap (same IST day, within the buffer window)
 * AND either the same courtroom or the same effective advocate. A shared
 * courtroom alone at a distant time is not a clash; different courtrooms
 * at the same minute with different advocates are not a clash either.
 * `candidate.hearingId` (when rescheduling) excludes the hearing itself.
 */
export function detectClashes(
  candidate: {
    hearingId?: string;
    at: number;
    courtroom?: string;
    appearingAdvocateId?: string;
    fallbackAdvocateId?: string;
  },
  others: ClashCandidate[],
  bufferMs: number = MAX_CLASH_BUFFER_MS,
): Clash[] {
  const day = istDay(candidate.at);
  const effective = effectiveAdvocate(
    candidate.appearingAdvocateId,
    candidate.fallbackAdvocateId,
  );
  const out: Clash[] = [];
  for (const o of others) {
    if (candidate.hearingId && o.hearingId === candidate.hearingId) continue;
    if (istDay(o.at) !== day) continue;
    if (Math.abs(o.at - candidate.at) > bufferMs) continue;
    const sameCourtroom =
      candidate.courtroom !== undefined &&
      o.courtroom !== undefined &&
      candidate.courtroom === o.courtroom;
    const sameAdvocate =
      effective !== undefined && o.appearingAdvocateId === effective;
    let reason: Clash["reason"] | undefined;
    if (sameCourtroom && sameAdvocate) reason = "same_courtroom";
    else if (sameAdvocate) reason = "same_advocate";
    else if (sameCourtroom) reason = "same_courtroom";
    else if (
      // Sparse data on BOTH sides (no courtroom, no advocate known for
      // either hearing): the firm diary cannot rule out a resource clash,
      // so surface a weak "adjacent" warning instead of staying silent.
      candidate.courtroom === undefined &&
      candidate.appearingAdvocateId === undefined &&
      candidate.fallbackAdvocateId === undefined &&
      o.courtroom === undefined &&
      o.appearingAdvocateId === undefined
    ) {
      reason = "adjacent";
    }
    if (reason && !out.some((c) => c.hearingId === o.hearingId)) {
      out.push({ ...o, reason });
    }
  }
  return out;
}

/** Human-readable sentence for a clash, used in warnings and audit text. */
export function describeClash(c: Clash): string {
  const when = new Date(c.at).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const why =
    c.reason === "same_advocate"
      ? "same advocate"
      : c.reason === "same_courtroom"
        ? "same courtroom"
        : "overlapping time";
  return `${c.title} — ${when} (${why})`;
}

/** Reschedule transition validation — pure rules the mutation enforces. */
export type RescheduleInput = {
  currentStatus: "scheduled" | "held" | "adjourned" | "cancelled";
  currentAt: number;
  newAt: number;
  now: number;
};

/**
 * Validate a reschedule request. Returns the rejection reason or null.
 * Rules: only scheduled/adjourned hearings may move; the new time must be
 * in the future; the new time must actually differ from the old one.
 */
export function rescheduleRejection(
  input: RescheduleInput,
): string | null {
  if (input.currentStatus === "held") {
    return "A held hearing cannot be rescheduled — record a fresh hearing instead.";
  }
  if (input.currentStatus === "cancelled") {
    return "A cancelled hearing cannot be rescheduled — schedule a new one.";
  }
  if (input.newAt === input.currentAt) {
    return "Pick a different time — the hearing is already scheduled then.";
  }
  if (input.newAt < input.now - 24 * 60 * 60 * 1000) {
    return "Pick a future date for the hearing.";
  }
  return null;
}

/**
 * The audit-trail record appended to the hearing when it is rescheduled.
 * Previous values are preserved, never overwritten. Generic over the
 * caller's branded id type so Convex `Id<"users">` values flow through
 * without casts.
 */
export type RescheduleAudit<IdType = string> = {
  at: number;
  byId: IdType;
  byName: string;
  reason: string;
  oldAt: number;
  newAt: number;
};

export function buildRescheduleAudit<IdType extends string>(
  byId: IdType,
  byName: string,
  reason: string,
  oldAt: number,
  newAt: number,
  now: number,
): RescheduleAudit<IdType> {
  return {
    at: now,
    byId,
    byName,
    reason: reason.trim().slice(0, 500) || "No reason recorded.",
    oldAt,
    newAt,
  };
}

/** Reminder lead-times survive a reschedule unchanged (they re-anchor to at). */
export function carryReminderDays(
  reminderDays: number[] | undefined,
): number[] | undefined {
  return reminderDays && reminderDays.length ? reminderDays : undefined;
}
